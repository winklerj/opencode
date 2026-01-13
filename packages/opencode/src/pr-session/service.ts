import z from "zod"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"

/**
 * PR Session Service
 *
 * Manages sessions associated with GitHub Pull Requests.
 * Enables tracking PR comments and responding to them.
 */
export namespace PRSessionService {
  const log = Log.create({ service: "pr-session" })

  /**
   * PR comment status
   */
  export const CommentStatus = z.enum(["pending", "addressed", "rejected", "outdated"])
  export type CommentStatus = z.infer<typeof CommentStatus>

  /**
   * PR comment info
   */
  export const Comment = z.object({
    id: z.string(),
    prNumber: z.number(),
    author: z.string(),
    body: z.string(),
    path: z.string().optional(),
    line: z.number().optional(),
    status: CommentStatus,
    createdAt: z.number(),
    addressedAt: z.number().optional(),
    response: z.string().optional(),
  })
  export type Comment = z.infer<typeof Comment>

  /**
   * PR session info
   */
  export const PRSession = z.object({
    prNumber: z.number(),
    sessionID: z.string(),
    repository: z.string(),
    title: z.string(),
    author: z.string(),
    baseBranch: z.string(),
    headBranch: z.string(),
    status: z.enum(["open", "closed", "merged"]),
    comments: z.array(Comment),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  export type PRSession = z.infer<typeof PRSession>

  /**
   * Input for creating a PR session
   */
  export const CreateInput = z.object({
    prNumber: z.number(),
    repository: z.string().describe("Repository in owner/repo format"),
    sessionID: z.string().optional().describe("Existing session ID to associate, or create new"),
  })
  export type CreateInput = z.infer<typeof CreateInput>

  /**
   * Input for responding to a comment
   */
  export const RespondInput = z.object({
    commentID: z.string(),
    response: z.string(),
    status: CommentStatus.optional(),
  })
  export type RespondInput = z.infer<typeof RespondInput>

  // Events
  export const Event = {
    Created: BusEvent.define(
      "pr-session.created",
      z.object({
        prNumber: z.number(),
        sessionID: z.string(),
        repository: z.string(),
      }),
    ),
    CommentAddressed: BusEvent.define(
      "pr-session.comment.addressed",
      z.object({
        prNumber: z.number(),
        commentID: z.string(),
        response: z.string(),
      }),
    ),
  }

  // Errors
  export const NotFoundError = NamedError.create(
    "PRSessionNotFoundError",
    z.object({
      prNumber: z.number(),
    }),
  )

  export const CommentNotFoundError = NamedError.create(
    "PRCommentNotFoundError",
    z.object({
      prNumber: z.number(),
      commentID: z.string(),
    }),
  )

  export const AlreadyExistsError = NamedError.create(
    "PRSessionAlreadyExistsError",
    z.object({
      prNumber: z.number(),
    }),
  )

  // In-memory state for PR sessions
  const prSessions = new Map<number, PRSession>()

  /**
   * Create a new PR session
   */
  export async function create(input: CreateInput): Promise<PRSession> {
    log.info("creating PR session", { prNumber: input.prNumber, repository: input.repository })

    // Check if session already exists
    if (prSessions.has(input.prNumber)) {
      throw new AlreadyExistsError({ prNumber: input.prNumber })
    }

    // In production, this would fetch PR details from GitHub
    // For now, create a placeholder session
    const sessionID = input.sessionID ?? `pr-${input.prNumber}-${Date.now()}`
    const now = Date.now()

    const session: PRSession = {
      prNumber: input.prNumber,
      sessionID,
      repository: input.repository,
      title: `PR #${input.prNumber}`, // Would be fetched from GitHub
      author: "unknown", // Would be fetched from GitHub
      baseBranch: "main",
      headBranch: `pr-${input.prNumber}`,
      status: "open",
      comments: [],
      createdAt: now,
      updatedAt: now,
    }

    prSessions.set(input.prNumber, session)

    await Bus.publish(Event.Created, {
      prNumber: input.prNumber,
      sessionID,
      repository: input.repository,
    })

    log.info("PR session created", { prNumber: input.prNumber, sessionID })
    return session
  }

  /**
   * Get PR session by PR number
   */
  export function get(prNumber: number): PRSession | undefined {
    return prSessions.get(prNumber)
  }

  /**
   * Get all comments for a PR
   */
  export function getComments(prNumber: number, status?: CommentStatus): Comment[] {
    const session = prSessions.get(prNumber)
    if (!session) {
      throw new NotFoundError({ prNumber })
    }

    if (status) {
      return session.comments.filter((c) => c.status === status)
    }
    return session.comments
  }

  /**
   * Add a comment to a PR session
   */
  export function addComment(prNumber: number, comment: Omit<Comment, "prNumber">): Comment {
    const session = prSessions.get(prNumber)
    if (!session) {
      throw new NotFoundError({ prNumber })
    }

    const fullComment: Comment = {
      ...comment,
      prNumber,
    }

    session.comments.push(fullComment)
    session.updatedAt = Date.now()

    log.info("comment added to PR session", { prNumber, commentID: comment.id })
    return fullComment
  }

  /**
   * Respond to a PR comment
   */
  export async function respond(prNumber: number, input: RespondInput): Promise<Comment> {
    log.info("responding to PR comment", { prNumber, commentID: input.commentID })

    const session = prSessions.get(prNumber)
    if (!session) {
      throw new NotFoundError({ prNumber })
    }

    const comment = session.comments.find((c) => c.id === input.commentID)
    if (!comment) {
      throw new CommentNotFoundError({ prNumber, commentID: input.commentID })
    }

    // Update comment
    comment.response = input.response
    comment.status = input.status ?? "addressed"
    comment.addressedAt = Date.now()
    session.updatedAt = Date.now()

    // In production, this would post the response to GitHub
    await Bus.publish(Event.CommentAddressed, {
      prNumber,
      commentID: input.commentID,
      response: input.response,
    })

    log.info("PR comment responded", { prNumber, commentID: input.commentID })
    return comment
  }

  /**
   * Delete a PR session
   */
  export function remove(prNumber: number): boolean {
    const existed = prSessions.has(prNumber)
    prSessions.delete(prNumber)
    if (existed) {
      log.info("PR session removed", { prNumber })
    }
    return existed
  }

  /**
   * List all PR sessions
   */
  export function list(): PRSession[] {
    return Array.from(prSessions.values())
  }

  /**
   * Get PR session by session ID
   */
  export function getBySessionID(sessionID: string): PRSession | undefined {
    for (const session of prSessions.values()) {
      if (session.sessionID === sessionID) {
        return session
      }
    }
    return undefined
  }
}

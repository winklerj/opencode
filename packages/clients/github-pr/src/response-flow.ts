import { z } from "zod"
import { Octokit } from "@octokit/rest"
import type { GitHubPREvent, GitHubPRClientConfig, CommentContext } from "./types"
import { SessionManager } from "./session-manager"

/**
 * Response configuration
 */
export const ResponseConfig = z.object({
  /** Template for response header */
  headerTemplate: z.string().default("<!-- OpenCode Response -->"),
  /** Include commit SHA in response */
  includeCommitSha: z.boolean().default(true),
  /** Maximum response length before truncation */
  maxLength: z.number().default(65536),
  /** Footer template */
  footerTemplate: z.string().optional(),
})
export type ResponseConfig = z.input<typeof ResponseConfig>

/**
 * Response input
 */
export const ResponseInput = z.object({
  /** Comment ID to respond to */
  commentID: z.number(),
  /** Response body */
  body: z.string(),
  /** Commit SHA for the changes */
  commitSha: z.string().optional(),
  /** Whether this is an inline reply (vs new comment) */
  asReply: z.boolean().default(true),
  /** Summary for the response */
  summary: z.string().optional(),
})
export type ResponseInput = z.input<typeof ResponseInput>

/**
 * Response result
 */
export interface ResponseResult {
  success: boolean
  responseID?: number
  htmlUrl?: string
  error?: string
}

/**
 * ResponseFlow handles posting responses back to GitHub.
 *
 * Responsibilities:
 * - Format responses according to templates
 * - Post comments via GitHub API
 * - Track response history
 * - Handle rate limiting
 */
export class ResponseFlow {
  private octokit: Octokit
  private sessionManager: SessionManager
  private config: z.output<typeof ResponseConfig>
  private listeners: Set<(event: GitHubPREvent) => void> = new Set()

  constructor(
    token: string,
    sessionManager: SessionManager,
    config: ResponseConfig = {},
  ) {
    this.octokit = new Octokit({ auth: token })
    this.sessionManager = sessionManager
    this.config = ResponseConfig.parse(config)
  }

  /**
   * Post a response to a PR comment
   */
  async respond(input: ResponseInput): Promise<ResponseResult> {
    const parsed = ResponseInput.parse(input)

    // Get comment context
    const context = this.sessionManager.getCommentContext(parsed.commentID)
    if (!context) {
      return { success: false, error: "Comment context not found" }
    }

    const [owner, repo] = context.repository.split("/")
    if (!owner || !repo) {
      return { success: false, error: "Invalid repository format" }
    }

    // Format the response body
    const body = this.formatResponse(parsed.body, parsed.commitSha, parsed.summary)

    try {
      if (parsed.asReply && context.path) {
        // Reply to inline comment
        const result = await this.replyToReviewComment(
          owner,
          repo,
          context.prNumber,
          parsed.commentID,
          body,
        )
        return result
      } else {
        // Post as new issue comment
        const result = await this.postIssueComment(owner, repo, context.prNumber, body)
        return result
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to post response",
      }
    }
  }

  /**
   * Reply to an inline review comment
   */
  private async replyToReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentID: number,
    body: string,
  ): Promise<ResponseResult> {
    const { data } = await this.octokit.pulls.createReplyForReviewComment({
      owner,
      repo,
      pull_number: prNumber,
      comment_id: commentID,
      body,
    })

    const event: GitHubPREvent = {
      type: "response.posted",
      commentID,
      responseID: data.id,
    }
    this.emit(event)

    return {
      success: true,
      responseID: data.id,
      htmlUrl: data.html_url,
    }
  }

  /**
   * Post a new issue comment
   */
  private async postIssueComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<ResponseResult> {
    const { data } = await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    })

    const event: GitHubPREvent = {
      type: "response.posted",
      commentID: 0, // Issue comment doesn't have a parent
      responseID: data.id,
    }
    this.emit(event)

    return {
      success: true,
      responseID: data.id,
      htmlUrl: data.html_url,
    }
  }

  /**
   * Format response body with templates
   */
  private formatResponse(body: string, commitSha?: string, summary?: string): string {
    const parts: string[] = []

    // Header
    if (this.config.headerTemplate) {
      parts.push(this.config.headerTemplate)
    }

    // Summary if provided
    if (summary) {
      parts.push(`**Summary:** ${summary}`)
      parts.push("")
    }

    // Main body
    parts.push(body)

    // Commit reference
    if (this.config.includeCommitSha && commitSha) {
      parts.push("")
      parts.push(`*Changes in commit: \`${commitSha.slice(0, 7)}\`*`)
    }

    // Footer
    if (this.config.footerTemplate) {
      parts.push("")
      parts.push(this.config.footerTemplate)
    }

    let result = parts.join("\n")

    // Truncate if too long
    if (result.length > this.config.maxLength) {
      result = result.slice(0, this.config.maxLength - 100) + "\n\n*[Response truncated]*"
    }

    return result
  }

  /**
   * Get PR details from GitHub
   */
  async getPR(repository: string, prNumber: number): Promise<{
    title: string
    body: string | null
    author: string
    headSha: string
    headBranch: string
    baseBranch: string
    state: "open" | "closed" | "merged"
  }> {
    const parts = repository.split("/")
    const owner = parts[0] ?? ""
    const repo = parts[1] ?? ""
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    })

    return {
      title: data.title,
      body: data.body,
      author: data.user?.login ?? "unknown",
      headSha: data.head.sha,
      headBranch: data.head.ref,
      baseBranch: data.base.ref,
      state: data.merged ? "merged" : (data.state as "open" | "closed"),
    }
  }

  /**
   * Get file content at a specific commit
   */
  async getFileContent(
    repository: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    const parts = repository.split("/")
    const owner = parts[0] ?? ""
    const repo = parts[1] ?? ""
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      })

      if ("content" in data && data.encoding === "base64") {
        return Buffer.from(data.content, "base64").toString("utf-8")
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Get diff for a file in a PR
   */
  async getFileDiff(repository: string, prNumber: number, path: string): Promise<string | null> {
    const parts = repository.split("/")
    const owner = parts[0] ?? ""
    const repo = parts[1] ?? ""
    try {
      const { data: files } = await this.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      })

      const file = files.find((f) => f.filename === path)
      return file?.patch ?? null
    } catch {
      return null
    }
  }

  /**
   * Subscribe to events
   */
  subscribe(listener: (event: GitHubPREvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Emit an event
   */
  private emit(event: GitHubPREvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }
}

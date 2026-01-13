import { z } from "zod"

/**
 * Types for the GitHub PR Client.
 *
 * This client handles:
 * - Receiving PR webhooks and routing to appropriate handlers
 * - Managing PR-to-session mappings
 * - Posting responses back to PR comments
 */

/**
 * GitHub PR information
 */
export const GitHubPR = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().optional(),
  htmlUrl: z.string(),
  author: z.string(),
  headBranch: z.string(),
  baseBranch: z.string(),
  headSha: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  repository: z.string(), // owner/repo format
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type GitHubPR = z.infer<typeof GitHubPR>

/**
 * GitHub PR comment (inline or issue-level)
 */
export const GitHubComment = z.object({
  id: z.number(),
  body: z.string(),
  author: z.string(),
  htmlUrl: z.string(),
  path: z.string().optional(), // For inline comments
  line: z.number().optional(), // For inline comments
  side: z.enum(["LEFT", "RIGHT"]).optional(), // For inline comments
  commitId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type GitHubComment = z.infer<typeof GitHubComment>

/**
 * PR-session mapping
 */
export const PRSessionMapping = z.object({
  prNumber: z.number(),
  repository: z.string(),
  sessionID: z.string(),
  createdAt: z.number(),
  lastActivityAt: z.number(),
})
export type PRSessionMapping = z.infer<typeof PRSessionMapping>

/**
 * Comment-specific session context
 */
export const CommentContext = z.object({
  commentID: z.number(),
  prNumber: z.number(),
  repository: z.string(),
  path: z.string().optional(),
  line: z.number().optional(),
  quotedCode: z.string().optional(),
  sessionID: z.string().optional(),
})
export type CommentContext = z.infer<typeof CommentContext>

/**
 * Configuration for the GitHub PR client
 */
export const GitHubPRClientConfig = z.object({
  /** GitHub API token */
  token: z.string(),
  /** Webhook secret for signature verification */
  webhookSecret: z.string().optional(),
  /** Whether to automatically create sessions for new PRs */
  autoCreateSessions: z.boolean().default(false),
  /** Pattern for bot username to ignore self-mentions */
  botUsername: z.string().optional(),
  /** Label to trigger agent attention */
  triggerLabel: z.string().optional().default("opencode"),
  /** Enable debug logging */
  debug: z.boolean().default(false),
})
export type GitHubPRClientConfig = z.input<typeof GitHubPRClientConfig>

/**
 * Events emitted by the GitHub PR client
 */
export type GitHubPREvent =
  | { type: "pr.opened"; pr: GitHubPR }
  | { type: "pr.updated"; pr: GitHubPR }
  | { type: "pr.closed"; pr: GitHubPR }
  | { type: "pr.merged"; pr: GitHubPR }
  | { type: "comment.created"; pr: GitHubPR; comment: GitHubComment }
  | { type: "comment.updated"; pr: GitHubPR; comment: GitHubComment }
  | { type: "review.submitted"; pr: GitHubPR; reviewId: number; state: string }
  | { type: "session.created"; mapping: PRSessionMapping }
  | { type: "session.connected"; mapping: PRSessionMapping }
  | { type: "response.posted"; commentID: number; responseID: number }

/**
 * Webhook payload types matching GitHub's format
 */
export namespace GitHubWebhook {
  export const PullRequestPayload = z.object({
    action: z.enum([
      "opened",
      "edited",
      "closed",
      "reopened",
      "synchronize",
      "labeled",
      "unlabeled",
      "ready_for_review",
    ]),
    number: z.number(),
    pull_request: z.object({
      number: z.number(),
      title: z.string(),
      body: z.string().nullable(),
      html_url: z.string(),
      user: z.object({ login: z.string() }),
      head: z.object({
        ref: z.string(),
        sha: z.string(),
      }),
      base: z.object({ ref: z.string() }),
      state: z.enum(["open", "closed"]),
      merged: z.boolean().optional(),
      created_at: z.string(),
      updated_at: z.string(),
    }),
    repository: z.object({
      full_name: z.string(),
    }),
    sender: z.object({ login: z.string() }),
  })
  export type PullRequestPayload = z.infer<typeof PullRequestPayload>

  export const IssueCommentPayload = z.object({
    action: z.enum(["created", "edited", "deleted"]),
    issue: z.object({
      number: z.number(),
      pull_request: z.object({ url: z.string() }).optional(),
    }),
    comment: z.object({
      id: z.number(),
      body: z.string(),
      html_url: z.string(),
      user: z.object({ login: z.string() }),
      created_at: z.string(),
      updated_at: z.string(),
    }),
    repository: z.object({
      full_name: z.string(),
    }),
    sender: z.object({ login: z.string() }),
  })
  export type IssueCommentPayload = z.infer<typeof IssueCommentPayload>

  export const PullRequestReviewCommentPayload = z.object({
    action: z.enum(["created", "edited", "deleted"]),
    pull_request: z.object({
      number: z.number(),
      title: z.string(),
      html_url: z.string(),
      user: z.object({ login: z.string() }),
      head: z.object({ sha: z.string() }),
    }),
    comment: z.object({
      id: z.number(),
      body: z.string(),
      html_url: z.string(),
      path: z.string(),
      line: z.number().nullable(),
      side: z.enum(["LEFT", "RIGHT"]).optional(),
      commit_id: z.string(),
      user: z.object({ login: z.string() }),
      created_at: z.string(),
      updated_at: z.string(),
    }),
    repository: z.object({
      full_name: z.string(),
    }),
    sender: z.object({ login: z.string() }),
  })
  export type PullRequestReviewCommentPayload = z.infer<typeof PullRequestReviewCommentPayload>

  export const PullRequestReviewPayload = z.object({
    action: z.enum(["submitted", "edited", "dismissed"]),
    pull_request: z.object({
      number: z.number(),
      title: z.string(),
      html_url: z.string(),
      user: z.object({ login: z.string() }),
    }),
    review: z.object({
      id: z.number(),
      state: z.enum(["approved", "changes_requested", "commented", "dismissed", "pending"]),
      body: z.string().nullable(),
      user: z.object({ login: z.string() }),
    }),
    repository: z.object({
      full_name: z.string(),
    }),
    sender: z.object({ login: z.string() }),
  })
  export type PullRequestReviewPayload = z.infer<typeof PullRequestReviewPayload>
}

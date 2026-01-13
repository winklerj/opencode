import { z } from "zod"
import { createHmac, timingSafeEqual } from "crypto"
import {
  type GitHubPR,
  type GitHubComment,
  type GitHubPREvent,
  type GitHubPRClientConfig,
  GitHubWebhook,
} from "./types"
import { SessionManager } from "./session-manager"

/**
 * Webhook handler configuration
 */
interface WebhookHandlerConfig {
  webhookSecret?: string
  botUsername?: string
  autoCreateSessions: boolean
}

/**
 * WebhookHandler processes incoming GitHub webhook events.
 *
 * Supported events:
 * - pull_request: PR opened, updated, closed, merged
 * - pull_request_review_comment: Inline code comments
 * - issue_comment: PR-level comments
 * - pull_request_review: Review submissions
 */
export class WebhookHandler {
  private config: WebhookHandlerConfig
  private sessionManager: SessionManager
  private listeners: Set<(event: GitHubPREvent) => void> = new Set()

  constructor(
    config: Pick<GitHubPRClientConfig, "webhookSecret" | "botUsername" | "autoCreateSessions">,
    sessionManager: SessionManager,
  ) {
    this.config = {
      webhookSecret: config.webhookSecret,
      botUsername: config.botUsername,
      autoCreateSessions: config.autoCreateSessions ?? false,
    }
    this.sessionManager = sessionManager
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload: string, signature: string): boolean {
    if (!this.config.webhookSecret) {
      // No secret configured, skip verification
      return true
    }

    if (!signature) return false

    const expected = `sha256=${createHmac("sha256", this.config.webhookSecret).update(payload).digest("hex")}`

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    } catch {
      return false
    }
  }

  /**
   * Handle incoming webhook event
   */
  async handle(
    eventType: string,
    payload: unknown,
  ): Promise<{ handled: boolean; event?: GitHubPREvent; error?: string }> {
    try {
      switch (eventType) {
        case "pull_request":
          return this.handlePullRequest(payload)
        case "pull_request_review_comment":
          return this.handlePullRequestReviewComment(payload)
        case "issue_comment":
          return this.handleIssueComment(payload)
        case "pull_request_review":
          return this.handlePullRequestReview(payload)
        case "ping":
          return { handled: true }
        default:
          return { handled: false, error: `Unsupported event type: ${eventType}` }
      }
    } catch (err) {
      return { handled: false, error: err instanceof Error ? err.message : "Unknown error" }
    }
  }

  /**
   * Handle pull_request webhook
   */
  private handlePullRequest(
    payload: unknown,
  ): { handled: boolean; event?: GitHubPREvent; error?: string } {
    const parsed = GitHubWebhook.PullRequestPayload.safeParse(payload)
    if (!parsed.success) {
      return { handled: false, error: `Invalid payload: ${parsed.error.message}` }
    }

    const data = parsed.data
    const pr = this.extractPR(data.pull_request, data.repository.full_name)

    let event: GitHubPREvent | undefined

    switch (data.action) {
      case "opened":
        event = { type: "pr.opened", pr }
        if (this.config.autoCreateSessions) {
          this.sessionManager.createOrGet(pr)
        }
        break
      case "edited":
      case "synchronize":
      case "ready_for_review":
        event = { type: "pr.updated", pr }
        this.sessionManager.touch(pr.repository, pr.number)
        break
      case "closed":
        if (data.pull_request.merged) {
          event = { type: "pr.merged", pr: { ...pr, state: "merged" } }
        } else {
          event = { type: "pr.closed", pr: { ...pr, state: "closed" } }
        }
        break
      case "labeled":
      case "unlabeled":
        event = { type: "pr.updated", pr }
        break
      case "reopened":
        event = { type: "pr.opened", pr }
        break
    }

    if (event) {
      this.emit(event)
      return { handled: true, event }
    }

    return { handled: false }
  }

  /**
   * Handle pull_request_review_comment webhook (inline comments)
   */
  private handlePullRequestReviewComment(
    payload: unknown,
  ): { handled: boolean; event?: GitHubPREvent; error?: string } {
    const parsed = GitHubWebhook.PullRequestReviewCommentPayload.safeParse(payload)
    if (!parsed.success) {
      return { handled: false, error: `Invalid payload: ${parsed.error.message}` }
    }

    const data = parsed.data

    // Ignore comments from the bot itself
    if (this.config.botUsername && data.comment.user.login === this.config.botUsername) {
      return { handled: true }
    }

    const pr: GitHubPR = {
      number: data.pull_request.number,
      title: data.pull_request.title,
      htmlUrl: data.pull_request.html_url,
      author: data.pull_request.user.login,
      headBranch: "",
      baseBranch: "",
      headSha: data.pull_request.head.sha,
      state: "open",
      repository: data.repository.full_name,
      createdAt: "",
      updatedAt: "",
    }

    const comment: GitHubComment = {
      id: data.comment.id,
      body: data.comment.body,
      author: data.comment.user.login,
      htmlUrl: data.comment.html_url,
      path: data.comment.path,
      line: data.comment.line ?? undefined,
      side: data.comment.side,
      commitId: data.comment.commit_id,
      createdAt: data.comment.created_at,
      updatedAt: data.comment.updated_at,
    }

    let event: GitHubPREvent | undefined

    switch (data.action) {
      case "created":
        event = { type: "comment.created", pr, comment }
        this.sessionManager.addCommentContext({
          commentID: comment.id,
          prNumber: pr.number,
          repository: pr.repository,
          path: comment.path,
          line: comment.line,
        })
        this.sessionManager.touch(pr.repository, pr.number)
        break
      case "edited":
        event = { type: "comment.updated", pr, comment }
        break
    }

    if (event) {
      this.emit(event)
      return { handled: true, event }
    }

    return { handled: false }
  }

  /**
   * Handle issue_comment webhook (PR-level comments)
   */
  private handleIssueComment(
    payload: unknown,
  ): { handled: boolean; event?: GitHubPREvent; error?: string } {
    const parsed = GitHubWebhook.IssueCommentPayload.safeParse(payload)
    if (!parsed.success) {
      return { handled: false, error: `Invalid payload: ${parsed.error.message}` }
    }

    const data = parsed.data

    // Only handle comments on PRs (not issues)
    if (!data.issue.pull_request) {
      return { handled: false, error: "Comment is on an issue, not a PR" }
    }

    // Ignore comments from the bot itself
    if (this.config.botUsername && data.comment.user.login === this.config.botUsername) {
      return { handled: true }
    }

    const pr: GitHubPR = {
      number: data.issue.number,
      title: "",
      htmlUrl: "",
      author: "",
      headBranch: "",
      baseBranch: "",
      headSha: "",
      state: "open",
      repository: data.repository.full_name,
      createdAt: "",
      updatedAt: "",
    }

    const comment: GitHubComment = {
      id: data.comment.id,
      body: data.comment.body,
      author: data.comment.user.login,
      htmlUrl: data.comment.html_url,
      createdAt: data.comment.created_at,
      updatedAt: data.comment.updated_at,
    }

    let event: GitHubPREvent | undefined

    switch (data.action) {
      case "created":
        event = { type: "comment.created", pr, comment }
        this.sessionManager.addCommentContext({
          commentID: comment.id,
          prNumber: pr.number,
          repository: pr.repository,
        })
        this.sessionManager.touch(pr.repository, pr.number)
        break
      case "edited":
        event = { type: "comment.updated", pr, comment }
        break
    }

    if (event) {
      this.emit(event)
      return { handled: true, event }
    }

    return { handled: false }
  }

  /**
   * Handle pull_request_review webhook
   */
  private handlePullRequestReview(
    payload: unknown,
  ): { handled: boolean; event?: GitHubPREvent; error?: string } {
    const parsed = GitHubWebhook.PullRequestReviewPayload.safeParse(payload)
    if (!parsed.success) {
      return { handled: false, error: `Invalid payload: ${parsed.error.message}` }
    }

    const data = parsed.data

    // Ignore reviews from the bot itself
    if (this.config.botUsername && data.review.user.login === this.config.botUsername) {
      return { handled: true }
    }

    const pr: GitHubPR = {
      number: data.pull_request.number,
      title: data.pull_request.title,
      htmlUrl: data.pull_request.html_url,
      author: data.pull_request.user.login,
      headBranch: "",
      baseBranch: "",
      headSha: "",
      state: "open",
      repository: data.repository.full_name,
      createdAt: "",
      updatedAt: "",
    }

    if (data.action === "submitted") {
      const event: GitHubPREvent = {
        type: "review.submitted",
        pr,
        reviewId: data.review.id,
        state: data.review.state,
      }
      this.emit(event)
      this.sessionManager.touch(pr.repository, pr.number)
      return { handled: true, event }
    }

    return { handled: false }
  }

  /**
   * Extract PR info from GitHub API response format
   */
  private extractPR(
    data: GitHubWebhook.PullRequestPayload["pull_request"],
    repository: string,
  ): GitHubPR {
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? undefined,
      htmlUrl: data.html_url,
      author: data.user.login,
      headBranch: data.head.ref,
      baseBranch: data.base.ref,
      headSha: data.head.sha,
      state: data.merged ? "merged" : data.state,
      repository,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
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

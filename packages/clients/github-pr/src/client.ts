import { z } from "zod"
import {
  GitHubPRClientConfig,
  type GitHubPR,
  type GitHubComment,
  type GitHubPREvent,
  type PRSessionMapping,
} from "./types"
import { SessionManager, type SessionManagerConfig } from "./session-manager"
import { WebhookHandler } from "./webhook-handler"
import { ResponseFlow, type ResponseConfig, type ResponseInput } from "./response-flow"

/**
 * Full client configuration
 */
export const ClientConfig = GitHubPRClientConfig.extend({
  /** Session manager configuration */
  sessionManager: z
    .object({
      idleTimeout: z.number().optional(),
      maxSessions: z.number().optional(),
    })
    .optional(),
  /** Response configuration */
  response: z
    .object({
      headerTemplate: z.string().optional(),
      includeCommitSha: z.boolean().optional(),
      maxLength: z.number().optional(),
      footerTemplate: z.string().optional(),
    })
    .optional(),
})
export type ClientConfig = z.input<typeof ClientConfig>

/**
 * GitHubPRClient is the main entry point for the GitHub PR integration.
 *
 * Features:
 * - Webhook handling for PR events
 * - Session management for PR-to-session mapping
 * - Response posting back to GitHub
 * - Event subscription for integration
 *
 * Usage:
 * ```typescript
 * const client = new GitHubPRClient({
 *   token: process.env.GITHUB_TOKEN,
 *   webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
 *   autoCreateSessions: true,
 * })
 *
 * // Subscribe to events
 * client.on((event) => {
 *   if (event.type === 'comment.created') {
 *     // Handle new comment
 *   }
 * })
 *
 * // Handle webhook
 * const result = await client.handleWebhook(eventType, payload, signature)
 *
 * // Respond to comment
 * await client.respond({
 *   commentID: 123,
 *   body: 'Fixed the issue',
 *   commitSha: 'abc123',
 * })
 * ```
 */
export class GitHubPRClient {
  private config: z.output<typeof ClientConfig>
  private sessionManager: SessionManager
  private webhookHandler: WebhookHandler
  private responseFlow: ResponseFlow
  private listeners: Set<(event: GitHubPREvent) => void> = new Set()

  constructor(config: ClientConfig) {
    this.config = ClientConfig.parse(config)

    // Initialize components
    this.sessionManager = new SessionManager(this.config.sessionManager)

    this.webhookHandler = new WebhookHandler(
      {
        webhookSecret: this.config.webhookSecret,
        botUsername: this.config.botUsername,
        autoCreateSessions: this.config.autoCreateSessions,
      },
      this.sessionManager,
    )

    this.responseFlow = new ResponseFlow(
      this.config.token,
      this.sessionManager,
      this.config.response,
    )

    // Forward events from components
    this.sessionManager.subscribe((e) => this.emit(e))
    this.webhookHandler.subscribe((e) => this.emit(e))
    this.responseFlow.subscribe((e) => this.emit(e))
  }

  /**
   * Handle an incoming webhook
   */
  async handleWebhook(
    eventType: string,
    payload: unknown,
    signature?: string,
  ): Promise<{ handled: boolean; event?: GitHubPREvent; error?: string }> {
    // Verify signature if provided
    if (signature && this.config.webhookSecret) {
      const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload)
      if (!this.webhookHandler.verifySignature(payloadStr, signature)) {
        return { handled: false, error: "Invalid webhook signature" }
      }
    }

    return this.webhookHandler.handle(eventType, payload)
  }

  /**
   * Create or get session for a PR
   */
  getOrCreateSession(pr: GitHubPR, sessionID?: string): PRSessionMapping {
    return this.sessionManager.createOrGet(pr, sessionID)
  }

  /**
   * Get session for a PR
   */
  getSession(repository: string, prNumber: number): PRSessionMapping | undefined {
    return this.sessionManager.get(repository, prNumber)
  }

  /**
   * Get session by session ID
   */
  getSessionByID(sessionID: string): PRSessionMapping | undefined {
    return this.sessionManager.getBySessionID(sessionID)
  }

  /**
   * List all active sessions
   */
  listSessions(): PRSessionMapping[] {
    return this.sessionManager.all()
  }

  /**
   * Respond to a PR comment
   */
  async respond(input: ResponseInput): Promise<{
    success: boolean
    responseID?: number
    htmlUrl?: string
    error?: string
  }> {
    return this.responseFlow.respond(input)
  }

  /**
   * Get PR details from GitHub
   */
  async getPR(repository: string, prNumber: number) {
    return this.responseFlow.getPR(repository, prNumber)
  }

  /**
   * Get file content at a specific commit
   */
  async getFileContent(repository: string, path: string, ref: string) {
    return this.responseFlow.getFileContent(repository, path, ref)
  }

  /**
   * Get diff for a file in a PR
   */
  async getFileDiff(repository: string, prNumber: number, path: string) {
    return this.responseFlow.getFileDiff(repository, prNumber, path)
  }

  /**
   * Start automatic session cleanup
   */
  startCleanup(intervalMs?: number): void {
    this.sessionManager.startCleanup(intervalMs)
  }

  /**
   * Stop automatic session cleanup
   */
  stopCleanup(): void {
    this.sessionManager.stopCleanup()
  }

  /**
   * Subscribe to events
   */
  on(listener: (event: GitHubPREvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Subscribe with event type filter
   */
  onEvent<T extends GitHubPREvent["type"]>(
    type: T,
    listener: (event: Extract<GitHubPREvent, { type: T }>) => void,
  ): () => void {
    const wrapper = (event: GitHubPREvent) => {
      if (event.type === type) {
        listener(event as Extract<GitHubPREvent, { type: T }>)
      }
    }
    this.listeners.add(wrapper)
    return () => this.listeners.delete(wrapper)
  }

  /**
   * Get statistics
   */
  getStats(): {
    activeSessions: number
    commentContexts: number
  } {
    return {
      activeSessions: this.sessionManager.count,
      commentContexts: 0, // Would need to expose this from session manager
    }
  }

  /**
   * Emit an event
   */
  private emit(event: GitHubPREvent): void {
    if (this.config.debug) {
      console.log("[GitHubPRClient]", event.type, event)
    }

    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }
}

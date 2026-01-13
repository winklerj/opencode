import { z } from "zod"
import type { PRSessionMapping, GitHubPR, CommentContext, GitHubPREvent } from "./types"

/**
 * Configuration for the session manager
 */
export const SessionManagerConfig = z.object({
  /** Session idle timeout in milliseconds before cleanup */
  idleTimeout: z.number().default(24 * 60 * 60 * 1000), // 24 hours
  /** Maximum sessions to track */
  maxSessions: z.number().default(1000),
})
export type SessionManagerConfig = z.input<typeof SessionManagerConfig>

/**
 * SessionManager handles PR-to-session mappings.
 *
 * Responsibilities:
 * - Create and track session mappings for PRs
 * - Associate comments with sessions
 * - Clean up stale sessions
 * - Provide session lookup by PR or comment
 */
export class SessionManager {
  private mappings = new Map<string, PRSessionMapping>()
  private commentContexts = new Map<number, CommentContext>()
  private config: z.output<typeof SessionManagerConfig>
  private listeners: Set<(event: GitHubPREvent) => void> = new Set()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: SessionManagerConfig = {}) {
    this.config = SessionManagerConfig.parse(config)
  }

  /**
   * Generate a unique key for PR mapping
   */
  private prKey(repository: string, prNumber: number): string {
    return `${repository}#${prNumber}`
  }

  /**
   * Create or get a session mapping for a PR
   */
  createOrGet(pr: GitHubPR, sessionID?: string): PRSessionMapping {
    const key = this.prKey(pr.repository, pr.number)
    const existing = this.mappings.get(key)

    if (existing) {
      existing.lastActivityAt = Date.now()
      return existing
    }

    // Enforce max sessions
    if (this.mappings.size >= this.config.maxSessions) {
      this.cleanupOldest()
    }

    const mapping: PRSessionMapping = {
      prNumber: pr.number,
      repository: pr.repository,
      sessionID: sessionID ?? `github-pr-${pr.repository.replace("/", "-")}-${pr.number}`,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    }

    this.mappings.set(key, mapping)
    this.emit({ type: "session.created", mapping })

    return mapping
  }

  /**
   * Get session mapping for a PR
   */
  get(repository: string, prNumber: number): PRSessionMapping | undefined {
    const key = this.prKey(repository, prNumber)
    return this.mappings.get(key)
  }

  /**
   * Get session mapping by session ID
   */
  getBySessionID(sessionID: string): PRSessionMapping | undefined {
    for (const mapping of this.mappings.values()) {
      if (mapping.sessionID === sessionID) {
        return mapping
      }
    }
    return undefined
  }

  /**
   * Update activity timestamp
   */
  touch(repository: string, prNumber: number): boolean {
    const key = this.prKey(repository, prNumber)
    const mapping = this.mappings.get(key)
    if (mapping) {
      mapping.lastActivityAt = Date.now()
      return true
    }
    return false
  }

  /**
   * Associate a comment with a PR session
   */
  addCommentContext(context: CommentContext): void {
    this.commentContexts.set(context.commentID, context)
  }

  /**
   * Get comment context
   */
  getCommentContext(commentID: number): CommentContext | undefined {
    return this.commentContexts.get(commentID)
  }

  /**
   * Remove comment context
   */
  removeCommentContext(commentID: number): boolean {
    return this.commentContexts.delete(commentID)
  }

  /**
   * Get all comment contexts for a PR
   */
  getCommentContextsForPR(repository: string, prNumber: number): CommentContext[] {
    const contexts: CommentContext[] = []
    for (const context of this.commentContexts.values()) {
      if (context.repository === repository && context.prNumber === prNumber) {
        contexts.push(context)
      }
    }
    return contexts
  }

  /**
   * Delete a session mapping
   */
  delete(repository: string, prNumber: number): boolean {
    const key = this.prKey(repository, prNumber)

    // Remove associated comment contexts
    for (const [id, context] of this.commentContexts) {
      if (context.repository === repository && context.prNumber === prNumber) {
        this.commentContexts.delete(id)
      }
    }

    return this.mappings.delete(key)
  }

  /**
   * Get all mappings
   */
  all(): PRSessionMapping[] {
    return Array.from(this.mappings.values())
  }

  /**
   * Get mappings for a repository
   */
  forRepository(repository: string): PRSessionMapping[] {
    return this.all().filter((m) => m.repository === repository)
  }

  /**
   * Count of active mappings
   */
  get count(): number {
    return this.mappings.size
  }

  /**
   * Start automatic cleanup of stale sessions
   */
  startCleanup(intervalMs: number = 60 * 60 * 1000): void {
    if (this.cleanupTimer) return

    this.cleanupTimer = setInterval(() => {
      this.cleanupStale()
    }, intervalMs)
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Remove stale sessions based on idle timeout
   */
  cleanupStale(): number {
    const cutoff = Date.now() - this.config.idleTimeout
    let removed = 0

    for (const [key, mapping] of this.mappings) {
      if (mapping.lastActivityAt < cutoff) {
        this.mappings.delete(key)
        removed++
      }
    }

    return removed
  }

  /**
   * Remove the oldest session when at capacity
   */
  private cleanupOldest(): void {
    let oldest: { key: string; time: number } | null = null

    for (const [key, mapping] of this.mappings) {
      if (!oldest || mapping.lastActivityAt < oldest.time) {
        oldest = { key, time: mapping.lastActivityAt }
      }
    }

    if (oldest) {
      this.mappings.delete(oldest.key)
    }
  }

  /**
   * Clear all mappings (for testing)
   */
  clear(): void {
    this.mappings.clear()
    this.commentContexts.clear()
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

import type { ThreadConversation, RepositoryContext } from "./types"

/**
 * Input for creating a new thread
 */
export interface CreateThreadInput {
  threadTs: string
  channelID: string
  initiatorUserID: string
  repository?: RepositoryContext
  sessionID?: string
}

/**
 * ThreadManager tracks conversation threads and their OpenCode sessions.
 *
 * Features:
 * - Create/get/update threads
 * - Track message count and activity
 * - Manage session associations
 * - Auto-cleanup stale threads
 */
export class ThreadManager {
  /** Map of channelID:threadTs -> ThreadConversation */
  private threads: Map<string, ThreadConversation> = new Map()

  /** TTL for inactive threads in milliseconds (default 24 hours) */
  private ttlMs: number

  /** Cleanup interval */
  private cleanupInterval?: ReturnType<typeof setInterval>

  constructor(config?: { ttlMs?: number; cleanupIntervalMs?: number }) {
    this.ttlMs = config?.ttlMs ?? 24 * 60 * 60 * 1000

    // Start cleanup interval (default every hour)
    const intervalMs = config?.cleanupIntervalMs ?? 60 * 60 * 1000
    this.cleanupInterval = setInterval(() => this.cleanup(), intervalMs)
  }

  /**
   * Get thread key from channel and timestamp
   */
  private getKey(channelID: string, threadTs: string): string {
    return `${channelID}:${threadTs}`
  }

  /**
   * Create a new thread
   */
  create(input: CreateThreadInput): ThreadConversation {
    const now = Date.now()
    const thread: ThreadConversation = {
      threadTs: input.threadTs,
      channelID: input.channelID,
      sessionID: input.sessionID,
      repository: input.repository,
      initiatorUserID: input.initiatorUserID,
      startedAt: now,
      lastActivityAt: now,
      messageCount: 1,
      status: "active",
    }

    const key = this.getKey(input.channelID, input.threadTs)
    this.threads.set(key, thread)

    return thread
  }

  /**
   * Get a thread by channel and timestamp
   */
  get(channelID: string, threadTs: string): ThreadConversation | undefined {
    const key = this.getKey(channelID, threadTs)
    return this.threads.get(key)
  }

  /**
   * Update thread's last activity timestamp
   */
  touch(channelID: string, threadTs: string): ThreadConversation | undefined {
    const key = this.getKey(channelID, threadTs)
    const thread = this.threads.get(key)
    if (thread) {
      thread.lastActivityAt = Date.now()
      return thread
    }
    return undefined
  }

  /**
   * Add a message to the thread count
   */
  addMessage(channelID: string, threadTs: string): ThreadConversation | undefined {
    const key = this.getKey(channelID, threadTs)
    const thread = this.threads.get(key)
    if (thread) {
      thread.messageCount++
      thread.lastActivityAt = Date.now()
      return thread
    }
    return undefined
  }

  /**
   * Associate a session with a thread
   */
  setSession(channelID: string, threadTs: string, sessionID: string): ThreadConversation | undefined {
    const key = this.getKey(channelID, threadTs)
    const thread = this.threads.get(key)
    if (thread) {
      thread.sessionID = sessionID
      thread.lastActivityAt = Date.now()
      return thread
    }
    return undefined
  }

  /**
   * Update thread status
   */
  setStatus(
    channelID: string,
    threadTs: string,
    status: ThreadConversation["status"],
    errorMessage?: string,
  ): ThreadConversation | undefined {
    const key = this.getKey(channelID, threadTs)
    const thread = this.threads.get(key)
    if (thread) {
      thread.status = status
      thread.errorMessage = errorMessage
      thread.lastActivityAt = Date.now()
      return thread
    }
    return undefined
  }

  /**
   * Mark thread as processing
   */
  processing(channelID: string, threadTs: string): ThreadConversation | undefined {
    return this.setStatus(channelID, threadTs, "processing")
  }

  /**
   * Mark thread as waiting for user input
   */
  waiting(channelID: string, threadTs: string): ThreadConversation | undefined {
    return this.setStatus(channelID, threadTs, "waiting")
  }

  /**
   * Mark thread as completed
   */
  complete(channelID: string, threadTs: string): ThreadConversation | undefined {
    return this.setStatus(channelID, threadTs, "completed")
  }

  /**
   * Mark thread as errored
   */
  error(channelID: string, threadTs: string, message: string): ThreadConversation | undefined {
    return this.setStatus(channelID, threadTs, "error", message)
  }

  /**
   * Delete a thread
   */
  delete(channelID: string, threadTs: string): boolean {
    const key = this.getKey(channelID, threadTs)
    return this.threads.delete(key)
  }

  /**
   * List all threads for a channel
   */
  listByChannel(channelID: string): ThreadConversation[] {
    const results: ThreadConversation[] = []
    for (const [key, thread] of this.threads) {
      if (key.startsWith(`${channelID}:`)) {
        results.push(thread)
      }
    }
    return results.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }

  /**
   * List all active threads
   */
  listActive(): ThreadConversation[] {
    return Array.from(this.threads.values())
      .filter((t) => t.status === "active" || t.status === "processing" || t.status === "waiting")
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }

  /**
   * Get thread by session ID
   */
  getBySession(sessionID: string): ThreadConversation | undefined {
    for (const thread of this.threads.values()) {
      if (thread.sessionID === sessionID) {
        return thread
      }
    }
    return undefined
  }

  /**
   * Cleanup stale threads
   */
  cleanup(): number {
    const now = Date.now()
    let cleaned = 0

    for (const [key, thread] of this.threads) {
      const age = now - thread.lastActivityAt
      if (age > this.ttlMs) {
        // Don't cleanup threads that are actively processing
        if (thread.status !== "processing") {
          this.threads.delete(key)
          cleaned++
        }
      }
    }

    return cleaned
  }

  /**
   * Get statistics
   */
  stats(): {
    total: number
    active: number
    processing: number
    waiting: number
    completed: number
    error: number
  } {
    const stats = {
      total: 0,
      active: 0,
      processing: 0,
      waiting: 0,
      completed: 0,
      error: 0,
    }

    for (const thread of this.threads.values()) {
      stats.total++
      stats[thread.status]++
    }

    return stats
  }

  /**
   * Stop the cleanup interval
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }
  }
}

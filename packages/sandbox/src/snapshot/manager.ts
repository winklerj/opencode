import { z } from "zod"
import { Sandbox } from "../sandbox"

/**
 * Snapshot record matching TLA+ SnapshotRecord
 */
export const Snapshot = z.object({
  id: z.string(),
  sandboxID: z.string(),
  sessionID: z.string(),
  createdAt: z.number(),
  gitCommit: z.string(),
  hasUncommittedChanges: z.boolean(),
  expired: z.boolean(),
})
export type Snapshot = z.infer<typeof Snapshot>

/**
 * Configuration for the snapshot manager
 */
export const SnapshotManagerConfig = z.object({
  maxSnapshotsPerSession: z.number().default(5),
  snapshotTTL: z.number().default(3600000), // 1 hour in ms
  cleanupInterval: z.number().default(60000), // 1 minute in ms
})
export type SnapshotManagerConfig = z.input<typeof SnapshotManagerConfig>

/**
 * Events emitted by the snapshot manager
 */
export type SnapshotEvent =
  | { type: "created"; snapshot: Snapshot }
  | { type: "restored"; snapshot: Snapshot; sandboxID: string }
  | { type: "expired"; snapshot: Snapshot }
  | { type: "cleaned"; snapshotID: string }

/**
 * Callback for restoring a sandbox from a snapshot
 */
export type RestoreCallback = (snapshot: Snapshot, sessionID: string) => Promise<Sandbox.Info>

/**
 * SnapshotManager manages sandbox snapshots for session continuity.
 *
 * Key behaviors from TLA+ specification:
 * - Snapshots are created when agent completes work
 * - Snapshots are restored when user sends follow-up prompts
 * - Sandboxes can be terminated after snapshot to free resources
 * - Snapshots expire after a TTL and are cleaned up
 * - Git sync must happen after restore to get latest changes
 *
 * Invariants:
 * - AtMostOneActiveSandboxPerSession
 * - SnapshotsReferenceValidSessions
 * - ValidSnapshotCount
 */
export class SnapshotManager {
  private snapshots = new Map<string, Snapshot>()
  private sessionSnapshots = new Map<string, string[]>() // sessionID -> snapshotIDs (newest first)
  private config: z.output<typeof SnapshotManagerConfig>
  private idCounter = 0
  private listeners: Set<(event: SnapshotEvent) => void> = new Set()
  private restoreCallback?: RestoreCallback
  private cleanupTimer?: ReturnType<typeof setInterval>

  constructor(config: SnapshotManagerConfig = {}) {
    this.config = SnapshotManagerConfig.parse(config)
  }

  /**
   * Start automatic cleanup of expired snapshots
   */
  startCleanup(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired()
    }, this.config.cleanupInterval)
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }

  /**
   * Set the callback for restoring sandboxes from snapshots
   */
  onRestore(callback: RestoreCallback): void {
    this.restoreCallback = callback
  }

  /**
   * Generate a unique snapshot ID
   */
  private generateId(): string {
    return `snapshot_${Date.now()}_${++this.idCounter}`
  }

  /**
   * Create a snapshot from a sandbox.
   * Implements TLA+ CreateSnapshot action.
   *
   * @param sandboxID - ID of the sandbox to snapshot
   * @param sessionID - Session that owns this sandbox
   * @param gitCommit - Current git commit hash
   * @param hasUncommittedChanges - Whether there are uncommitted changes
   * @returns The created snapshot, or null if max snapshots reached
   */
  create(
    sandboxID: string,
    sessionID: string,
    gitCommit: string,
    hasUncommittedChanges: boolean = false,
  ): Snapshot | null {
    // Get session's snapshot list
    const sessionSnaps = this.sessionSnapshots.get(sessionID) || []

    // Check max snapshots per session
    if (sessionSnaps.length >= this.config.maxSnapshotsPerSession) {
      // Remove oldest snapshot to make room
      const oldestID = sessionSnaps[sessionSnaps.length - 1]
      this.remove(oldestID)
    }

    const snapshot: Snapshot = {
      id: this.generateId(),
      sandboxID,
      sessionID,
      createdAt: Date.now(),
      gitCommit,
      hasUncommittedChanges,
      expired: false,
    }

    this.snapshots.set(snapshot.id, snapshot)

    // Add to session list (newest first)
    const updatedSessionSnaps = [snapshot.id, ...(this.sessionSnapshots.get(sessionID) || [])]
    this.sessionSnapshots.set(sessionID, updatedSessionSnaps)

    this.emit({ type: "created", snapshot })
    return snapshot
  }

  /**
   * Get the latest valid snapshot for a session.
   * Implements TLA+ GetLatestSnapshot helper.
   *
   * @param sessionID - Session to get snapshot for
   * @returns The latest non-expired snapshot, or undefined
   */
  getLatest(sessionID: string): Snapshot | undefined {
    const sessionSnaps = this.sessionSnapshots.get(sessionID)
    if (!sessionSnaps || sessionSnaps.length === 0) {
      return undefined
    }

    // Iterate through snapshots (newest first) to find first valid one
    for (const snapshotID of sessionSnaps) {
      const snapshot = this.snapshots.get(snapshotID)

      if (!snapshot) {
        continue
      }

      if (snapshot.expired) {
        continue
      }

      // Check TTL
      if (Date.now() - snapshot.createdAt >= this.config.snapshotTTL) {
        this.expire(snapshotID)
        continue
      }

      return snapshot
    }

    return undefined
  }

  /**
   * Check if session has a valid (non-expired) snapshot.
   * Implements TLA+ HasValidSnapshot helper.
   *
   * @param sessionID - Session to check
   * @returns true if session has a valid snapshot
   */
  hasValidSnapshot(sessionID: string): boolean {
    return this.getLatest(sessionID) !== undefined
  }

  /**
   * Restore a sandbox from the latest snapshot.
   * Implements TLA+ RestoreFromSnapshot action.
   *
   * @param sessionID - Session to restore for
   * @returns The restored sandbox info, or null if no valid snapshot or no restore callback
   */
  async restore(sessionID: string): Promise<Sandbox.Info | null> {
    const snapshot = this.getLatest(sessionID)
    if (!snapshot) {
      return null
    }

    if (!this.restoreCallback) {
      return null
    }

    const sandbox = await this.restoreCallback(snapshot, sessionID)
    this.emit({ type: "restored", snapshot, sandboxID: sandbox.id })
    return sandbox
  }

  /**
   * Get a snapshot by ID
   */
  get(snapshotID: string): Snapshot | undefined {
    return this.snapshots.get(snapshotID)
  }

  /**
   * Get all snapshots for a session
   */
  bySession(sessionID: string): Snapshot[] {
    const snapIDs = this.sessionSnapshots.get(sessionID) || []
    return snapIDs.map((id) => this.snapshots.get(id)).filter((s): s is Snapshot => s !== undefined)
  }

  /**
   * Get all snapshots
   */
  all(): Snapshot[] {
    return Array.from(this.snapshots.values())
  }

  /**
   * Mark a snapshot as expired.
   * Implements TLA+ ExpireSnapshot action.
   *
   * @param snapshotID - ID of snapshot to expire
   * @returns true if expired, false if not found or already expired
   */
  expire(snapshotID: string): boolean {
    const snapshot = this.snapshots.get(snapshotID)
    if (!snapshot || snapshot.expired) {
      return false
    }

    snapshot.expired = true
    this.emit({ type: "expired", snapshot })
    return true
  }

  /**
   * Remove a snapshot.
   * Implements TLA+ CleanupExpiredSnapshot action.
   *
   * @param snapshotID - ID of snapshot to remove
   * @returns true if removed
   */
  remove(snapshotID: string): boolean {
    const snapshot = this.snapshots.get(snapshotID)
    if (!snapshot) {
      return false
    }

    // Remove from session list
    const sessionSnaps = this.sessionSnapshots.get(snapshot.sessionID)
    if (sessionSnaps) {
      const updated = sessionSnaps.filter((id) => id !== snapshotID)
      if (updated.length > 0) {
        this.sessionSnapshots.set(snapshot.sessionID, updated)
      } else {
        this.sessionSnapshots.delete(snapshot.sessionID)
      }
    }

    this.snapshots.delete(snapshotID)
    this.emit({ type: "cleaned", snapshotID })
    return true
  }

  /**
   * Clean up all expired snapshots
   */
  cleanupExpired(): number {
    const now = Date.now()
    let cleaned = 0

    for (const [id, snapshot] of this.snapshots) {
      // Check if expired by TTL
      if (now - snapshot.createdAt >= this.config.snapshotTTL) {
        if (!snapshot.expired) {
          this.expire(id)
        }
        this.remove(id)
        cleaned++
      } else if (snapshot.expired) {
        // Already expired but not removed
        this.remove(id)
        cleaned++
      }
    }

    return cleaned
  }

  /**
   * Get count of valid (non-expired) snapshots for a session
   */
  validCount(sessionID: string): number {
    const now = Date.now()
    return this.bySession(sessionID).filter(
      (s) => !s.expired && now - s.createdAt < this.config.snapshotTTL,
    ).length
  }

  /**
   * Get total snapshot count
   */
  get count(): number {
    return this.snapshots.size
  }

  /**
   * Subscribe to snapshot events
   */
  subscribe(listener: (event: SnapshotEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: SnapshotEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Clear all snapshots (for testing)
   */
  clear(): void {
    this.snapshots.clear()
    this.sessionSnapshots.clear()
  }
}

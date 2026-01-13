import { z } from "zod"

/**
 * Conflict resolution for multiplayer sessions.
 *
 * The conflict resolver handles concurrent state updates using optimistic
 * concurrency control with version numbers. When clients submit updates
 * with stale versions, conflicts are detected and resolved according to
 * the configured strategy.
 *
 * Strategies:
 * - last-write-wins: Most recent update always wins (default)
 * - reject: Reject conflicting updates, client must refresh and retry
 * - merge: Attempt to merge non-conflicting changes (for compatible updates)
 */

/**
 * Conflict resolution strategy
 */
export const ConflictStrategy = z.enum(["last-write-wins", "reject", "merge"])
export type ConflictStrategy = z.infer<typeof ConflictStrategy>

/**
 * Result of a conflict resolution attempt
 */
export const ConflictResult = z.object({
  resolved: z.boolean(),
  strategy: ConflictStrategy,
  acceptedVersion: z.number(),
  rejectedUpdates: z.array(z.string()).optional(),
  mergedFields: z.array(z.string()).optional(),
})
export type ConflictResult = z.infer<typeof ConflictResult>

/**
 * A versioned update submitted by a client
 */
export interface VersionedUpdate<T = Record<string, unknown>> {
  /** Client's expected version (base version they read) */
  baseVersion: number
  /** Updated fields */
  updates: Partial<T>
  /** Client ID submitting the update */
  clientID: string
  /** Timestamp of the update */
  timestamp: number
}

/**
 * Conflict information when an update cannot be applied
 */
export interface ConflictInfo {
  /** The update that conflicted */
  update: VersionedUpdate
  /** Current server version */
  currentVersion: number
  /** Fields that conflicted */
  conflictingFields: string[]
  /** Strategy that was attempted */
  strategy: ConflictStrategy
}

/**
 * Configuration for the conflict resolver
 */
export const ConflictResolverConfig = z.object({
  strategy: ConflictStrategy.default("last-write-wins"),
  /** Fields that cannot be merged (always conflict) */
  nonMergeableFields: z.array(z.string()).default(["editLock"]),
  /** Max version drift before forcing refresh */
  maxVersionDrift: z.number().default(10),
})
export type ConflictResolverConfig = z.input<typeof ConflictResolverConfig>

/**
 * Event emitted when a conflict occurs
 */
export type ConflictEvent =
  | { type: "conflict.detected"; info: ConflictInfo }
  | { type: "conflict.resolved"; result: ConflictResult; update: VersionedUpdate }
  | { type: "conflict.rejected"; info: ConflictInfo }

/**
 * ConflictResolver handles concurrent state updates in multiplayer sessions.
 *
 * Based on optimistic concurrency control:
 * 1. Each state has a version number
 * 2. Clients include baseVersion when submitting updates
 * 3. If baseVersion != currentVersion, a conflict exists
 * 4. Resolution depends on strategy and conflicting fields
 */
export class ConflictResolver<T extends object = Record<string, unknown>> {
  private config: z.output<typeof ConflictResolverConfig>
  private listeners: Set<(event: ConflictEvent) => void> = new Set()

  constructor(config: ConflictResolverConfig = {}) {
    this.config = ConflictResolverConfig.parse(config)
  }

  /**
   * Attempt to apply a versioned update to the current state.
   *
   * @param currentState - Current state with version
   * @param update - Update to apply
   * @returns Result with new state if resolved, or conflict info
   */
  resolve(
    currentState: T & { version: number },
    update: VersionedUpdate<T>,
  ): { success: true; newState: T & { version: number }; result: ConflictResult } | { success: false; conflict: ConflictInfo } {
    const currentVersion = currentState.version
    const { baseVersion, updates, clientID, timestamp } = update

    // No conflict if versions match
    if (baseVersion === currentVersion) {
      const newState = this.applyUpdate(currentState, updates)
      const result: ConflictResult = {
        resolved: true,
        strategy: "last-write-wins",
        acceptedVersion: newState.version,
      }
      this.emit({ type: "conflict.resolved", result, update })
      return { success: true, newState, result }
    }

    // Version mismatch - conflict detected
    const conflictingFields = this.findConflictingFields(currentState, updates)
    const conflictInfo: ConflictInfo = {
      update,
      currentVersion,
      conflictingFields,
      strategy: this.config.strategy,
    }

    this.emit({ type: "conflict.detected", info: conflictInfo })

    // Check version drift
    const drift = currentVersion - baseVersion
    if (drift > this.config.maxVersionDrift) {
      // Too far behind, force refresh
      this.emit({ type: "conflict.rejected", info: conflictInfo })
      return { success: false, conflict: conflictInfo }
    }

    // Apply resolution strategy
    switch (this.config.strategy) {
      case "last-write-wins":
        return this.resolveLastWriteWins(currentState, update, conflictInfo)

      case "reject":
        this.emit({ type: "conflict.rejected", info: conflictInfo })
        return { success: false, conflict: conflictInfo }

      case "merge":
        return this.resolveMerge(currentState, update, conflictInfo)

      default:
        return { success: false, conflict: conflictInfo }
    }
  }

  /**
   * Last-write-wins: Accept the update regardless of conflicts
   */
  private resolveLastWriteWins(
    currentState: T & { version: number },
    update: VersionedUpdate<T>,
    _conflictInfo: ConflictInfo,
  ): { success: true; newState: T & { version: number }; result: ConflictResult } {
    const newState = this.applyUpdate(currentState, update.updates)
    const result: ConflictResult = {
      resolved: true,
      strategy: "last-write-wins",
      acceptedVersion: newState.version,
    }
    this.emit({ type: "conflict.resolved", result, update })
    return { success: true, newState, result }
  }

  /**
   * Merge: Apply non-conflicting changes, reject if non-mergeable fields conflict
   */
  private resolveMerge(
    currentState: T & { version: number },
    update: VersionedUpdate<T>,
    conflictInfo: ConflictInfo,
  ): { success: true; newState: T & { version: number }; result: ConflictResult } | { success: false; conflict: ConflictInfo } {
    const { updates } = update

    // Check if any non-mergeable fields conflict
    const nonMergeableConflicts = conflictInfo.conflictingFields.filter((f) =>
      this.config.nonMergeableFields.includes(f),
    )

    if (nonMergeableConflicts.length > 0) {
      // Cannot merge - reject
      this.emit({ type: "conflict.rejected", info: conflictInfo })
      return { success: false, conflict: conflictInfo }
    }

    // Apply only non-conflicting updates
    const mergeableUpdates: Partial<T> = {}
    const mergedFields: string[] = []
    const rejectedFields: string[] = []

    for (const [key, value] of Object.entries(updates)) {
      if (conflictInfo.conflictingFields.includes(key)) {
        // Skip conflicting fields (keep server value)
        rejectedFields.push(key)
      } else {
        // Apply non-conflicting field
        ;(mergeableUpdates as Record<string, unknown>)[key] = value
        mergedFields.push(key)
      }
    }

    const newState = this.applyUpdate(currentState, mergeableUpdates as Partial<T>)
    const result: ConflictResult = {
      resolved: true,
      strategy: "merge",
      acceptedVersion: newState.version,
      mergedFields,
      rejectedUpdates: rejectedFields.length > 0 ? rejectedFields : undefined,
    }
    this.emit({ type: "conflict.resolved", result, update })
    return { success: true, newState, result }
  }

  /**
   * Find fields that have been modified since the base version.
   *
   * Since we don't track per-field version history, we use a heuristic:
   * - Fields that exist in both update and current state are potentially conflicting
   * - New fields (not in current state) are not considered conflicting
   * - This allows optimistic merging of new data while being conservative
   *   about existing data that may have changed
   */
  private findConflictingFields(currentState: T & { version: number }, updates: Partial<T>): string[] {
    const conflicting: string[] = []
    for (const key of Object.keys(updates)) {
      // A field is potentially conflicting if it exists in the current state
      // (excluding 'version' which is always present)
      if (key !== "version" && key in currentState) {
        conflicting.push(key)
      }
    }
    return conflicting
  }

  /**
   * Apply updates to state and increment version
   */
  private applyUpdate(state: T & { version: number }, updates: Partial<T>): T & { version: number } {
    return {
      ...state,
      ...updates,
      version: state.version + 1,
    }
  }

  /**
   * Check if an update would conflict
   */
  wouldConflict(currentVersion: number, baseVersion: number): boolean {
    return baseVersion !== currentVersion
  }

  /**
   * Get the current strategy
   */
  get strategy(): ConflictStrategy {
    return this.config.strategy
  }

  /**
   * Update the resolution strategy
   */
  setStrategy(strategy: ConflictStrategy): void {
    this.config.strategy = strategy
  }

  /**
   * Subscribe to conflict events
   */
  subscribe(listener: (event: ConflictEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Emit an event
   */
  private emit(event: ConflictEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }
}

/**
 * Create a versioned update helper
 */
export function createUpdate<T>(
  baseVersion: number,
  updates: Partial<T>,
  clientID: string,
): VersionedUpdate<T> {
  return {
    baseVersion,
    updates,
    clientID,
    timestamp: Date.now(),
  }
}

/**
 * Helper to apply optimistic updates on the client side
 */
export class OptimisticUpdater<T extends object> {
  private pendingUpdates: Map<string, VersionedUpdate<T>> = new Map()
  private updateCounter = 0

  /**
   * Create a pending update (before server confirmation)
   */
  createPending(baseVersion: number, updates: Partial<T>, clientID: string): string {
    const updateID = `update_${Date.now()}_${++this.updateCounter}`
    const update = createUpdate<T>(baseVersion, updates, clientID)
    this.pendingUpdates.set(updateID, update)
    return updateID
  }

  /**
   * Confirm an update was accepted
   */
  confirm(updateID: string): void {
    this.pendingUpdates.delete(updateID)
  }

  /**
   * Rollback a rejected update
   */
  rollback(updateID: string): VersionedUpdate<T> | undefined {
    const update = this.pendingUpdates.get(updateID)
    this.pendingUpdates.delete(updateID)
    return update
  }

  /**
   * Get all pending updates (for resubmission after reconnect)
   */
  getPending(): VersionedUpdate<T>[] {
    return Array.from(this.pendingUpdates.values())
  }

  /**
   * Clear all pending updates
   */
  clear(): void {
    this.pendingUpdates.clear()
  }

  /**
   * Number of pending updates
   */
  get pendingCount(): number {
    return this.pendingUpdates.size
  }
}

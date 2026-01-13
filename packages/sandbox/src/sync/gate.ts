import { z } from "zod"
import type { Sandbox } from "../sandbox"

/**
 * Read-only tools that can execute during git sync.
 * These tools don't modify the filesystem so they're safe to run
 * even if git sync is in progress.
 */
export const READONLY_TOOLS = ["read", "glob", "grep", "ls", "codesearch", "tree", "find"] as const

/**
 * Write tools that must wait for git sync to complete.
 * These tools modify files and could conflict with ongoing git operations.
 */
export const WRITE_TOOLS = ["edit", "write", "patch", "bash", "multiedit", "mv", "rm", "mkdir"] as const

export type ReadonlyTool = (typeof READONLY_TOOLS)[number]
export type WriteTool = (typeof WRITE_TOOLS)[number]

/**
 * Configuration for the sync gate
 */
export const SyncGateConfig = z.object({
  enabled: z.boolean().default(true),
  retryInterval: z.number().default(1000), // ms to wait before retry
  maxWaitTime: z.number().default(120000), // max time to wait for sync (2 min)
})
export type SyncGateConfig = z.input<typeof SyncGateConfig>

/**
 * Result of checking whether a tool can execute
 */
export interface GateCheckResult {
  allowed: boolean
  reason?: string
  retryAfter?: number // ms to wait before retrying
}

/**
 * Pending edit that was blocked by sync gate
 */
export interface PendingEdit {
  sandboxID: string
  tool: string
  file?: string
  timestamp: number
  callID: string
}

/**
 * SyncGate manages the gating of tool execution based on git sync status.
 *
 * Key behaviors from TLA+ specification:
 * - Read tools (read, glob, grep, ls) always proceed immediately
 * - Write tools (edit, write, patch, bash) are blocked until sync completes
 * - Blocked edits are tracked in pendingEdits set
 * - When sync completes, pending edits can proceed
 *
 * This implements the critical invariant: no filesystem writes until
 * git sync is complete, preventing conflicts between pulled changes
 * and user edits.
 */
export class SyncGate {
  private config: z.output<typeof SyncGateConfig>
  private pendingEdits = new Map<string, PendingEdit>() // callID -> PendingEdit
  private syncWaiters = new Map<string, Set<(synced: boolean) => void>>() // sandboxID -> waiters

  constructor(config: SyncGateConfig = {}) {
    this.config = SyncGateConfig.parse(config)
  }

  /**
   * Check if a tool can execute given the current sync status.
   *
   * @param tool - The tool name
   * @param sandboxID - The sandbox ID
   * @param syncStatus - Current git sync status
   * @param file - Optional file being operated on
   * @returns Whether the tool can proceed and any blocking reason
   */
  check(
    tool: string,
    sandboxID: string,
    syncStatus: Sandbox.GitSyncStatus,
    file?: string,
  ): GateCheckResult {
    if (!this.config.enabled) {
      return { allowed: true }
    }

    // Read-only tools always allowed
    if (this.isReadonly(tool)) {
      return { allowed: true }
    }

    // Write tools need sync to be complete
    if (this.isWrite(tool)) {
      if (syncStatus === "synced") {
        return { allowed: true }
      }

      return {
        allowed: false,
        reason: `Waiting for git sync (${syncStatus})`,
        retryAfter: this.config.retryInterval,
      }
    }

    // Unknown tools default to allowed
    return { allowed: true }
  }

  /**
   * Wait for sync to complete before allowing a write operation.
   * This is the blocking version of check() that waits for sync.
   *
   * @param tool - The tool name
   * @param sandboxID - The sandbox ID
   * @param callID - Unique ID for this tool call
   * @param getSyncStatus - Callback to get current sync status
   * @param file - Optional file being operated on
   * @returns Whether the operation can proceed after waiting
   */
  async wait(
    tool: string,
    sandboxID: string,
    callID: string,
    getSyncStatus: () => Promise<Sandbox.GitSyncStatus>,
    file?: string,
  ): Promise<GateCheckResult> {
    if (!this.config.enabled) {
      return { allowed: true }
    }

    // Read-only tools don't need to wait
    if (this.isReadonly(tool)) {
      return { allowed: true }
    }

    // Check current status
    const initialStatus = await getSyncStatus()
    if (initialStatus === "synced") {
      return { allowed: true }
    }

    // Track as pending
    const pending: PendingEdit = {
      sandboxID,
      tool,
      file,
      timestamp: Date.now(),
      callID,
    }
    this.pendingEdits.set(callID, pending)

    try {
      // Wait for sync with timeout
      const startTime = Date.now()
      while (Date.now() - startTime < this.config.maxWaitTime) {
        const status = await getSyncStatus()

        if (status === "synced") {
          return { allowed: true }
        }

        if (status === "error") {
          return {
            allowed: false,
            reason: "Git sync failed - cannot proceed with write operation",
          }
        }

        // Wait before checking again
        await new Promise((resolve) => setTimeout(resolve, this.config.retryInterval))
      }

      // Timeout
      return {
        allowed: false,
        reason: `Git sync did not complete within ${this.config.maxWaitTime}ms`,
      }
    } finally {
      // Remove from pending
      this.pendingEdits.delete(callID)
    }
  }

  /**
   * Notify that sync has completed for a sandbox.
   * This releases any waiters for that sandbox.
   *
   * @param sandboxID - The sandbox that completed sync
   */
  notifySyncComplete(sandboxID: string): void {
    const waiters = this.syncWaiters.get(sandboxID)
    if (waiters) {
      for (const waiter of waiters) {
        waiter(true)
      }
      this.syncWaiters.delete(sandboxID)
    }

    // Clear pending edits for this sandbox
    for (const [callID, pending] of this.pendingEdits) {
      if (pending.sandboxID === sandboxID) {
        this.pendingEdits.delete(callID)
      }
    }
  }

  /**
   * Notify that sync has failed for a sandbox.
   *
   * @param sandboxID - The sandbox that failed sync
   */
  notifySyncFailed(sandboxID: string): void {
    const waiters = this.syncWaiters.get(sandboxID)
    if (waiters) {
      for (const waiter of waiters) {
        waiter(false)
      }
      this.syncWaiters.delete(sandboxID)
    }
  }

  /**
   * Get all pending edits for a sandbox
   */
  getPendingEdits(sandboxID: string): PendingEdit[] {
    return Array.from(this.pendingEdits.values()).filter((p) => p.sandboxID === sandboxID)
  }

  /**
   * Get count of pending edits across all sandboxes
   */
  getPendingCount(): number {
    return this.pendingEdits.size
  }

  /**
   * Check if a tool is read-only
   */
  isReadonly(tool: string): tool is ReadonlyTool {
    return (READONLY_TOOLS as readonly string[]).includes(tool)
  }

  /**
   * Check if a tool is a write tool
   */
  isWrite(tool: string): tool is WriteTool {
    return (WRITE_TOOLS as readonly string[]).includes(tool)
  }

  /**
   * Classify a tool as read, write, or unknown
   */
  classify(tool: string): "readonly" | "write" | "unknown" {
    if (this.isReadonly(tool)) return "readonly"
    if (this.isWrite(tool)) return "write"
    return "unknown"
  }
}

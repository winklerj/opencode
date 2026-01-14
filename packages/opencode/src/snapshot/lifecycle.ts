import { SandboxService } from "../sandbox/service"
import { SessionStatus } from "../session/status"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { TelemetryLog, EventNames } from "../telemetry/log"

const log = Log.create({ service: "snapshot-lifecycle" })

/**
 * SnapshotLifecycle orchestrates snapshot creation and restoration
 * for session continuity.
 *
 * Key behaviors from SPECIFICATION.md section 8.6:
 * - Create snapshot when agent completes work (session goes idle)
 * - Restore from snapshot when user sends follow-up prompts
 * - Terminate sandbox after snapshot to free resources
 * - Auto-expire old snapshots
 *
 * Integration points:
 * - Listens to session.idle events to trigger snapshot creation
 * - Provides onFollowUpPrompt for session prompt handling
 * - Manages sandbox termination after snapshot
 */
export namespace SnapshotLifecycle {
  /**
   * Configuration for the snapshot lifecycle
   */
  export interface Config {
    /** Whether to auto-terminate sandboxes after snapshot */
    autoTerminate: boolean
    /** Minimum work duration (ms) before creating snapshot */
    minWorkDuration: number
    /** Whether to sync latest changes on restore */
    syncOnRestore: boolean
  }

  const defaultConfig: Config = {
    autoTerminate: true,
    minWorkDuration: 5000, // 5 seconds
    syncOnRestore: true,
  }

  /**
   * Session work tracking for snapshot decisions
   */
  interface SessionWork {
    sandboxID: string | undefined
    startedAt: number
    hasChanges: boolean
  }

  /**
   * Initialize the snapshot lifecycle manager.
   * This sets up event listeners for session state changes.
   */
  export const initialize = Instance.state((config: Partial<Config> = {}) => {
    const mergedConfig = { ...defaultConfig, ...config }
    const sessionWork = new Map<string, SessionWork>()

    log.info("Initializing snapshot lifecycle manager")

    // Listen for session status changes
    const unsubscribe = Bus.subscribe(SessionStatus.Event.Status, async (event) => {
      const { sessionID, status } = event.properties

      if (status.type === "busy") {
        // Session started work - track start time
        const existing = sessionWork.get(sessionID)
        if (!existing) {
          sessionWork.set(sessionID, {
            sandboxID: undefined,
            startedAt: Date.now(),
            hasChanges: false,
          })
          log.info("Session started work", { sessionID })
        }
      } else if (status.type === "idle") {
        // Session finished work - consider snapshot
        const work = sessionWork.get(sessionID)
        if (work) {
          sessionWork.delete(sessionID)

          const duration = Date.now() - work.startedAt
          log.info("Session finished work", {
            sessionID,
            duration,
            hasChanges: work.hasChanges,
            sandboxID: work.sandboxID,
          })

          // Only create snapshot if work was substantial
          if (duration >= mergedConfig.minWorkDuration && work.sandboxID) {
            await onAgentComplete(
              work.sandboxID,
              sessionID,
              work.hasChanges,
              mergedConfig,
            )
          }
        }
      }
    })

    return {
      config: mergedConfig,
      sessionWork,
      stop: () => {
        unsubscribe()
        sessionWork.clear()
        log.info("Snapshot lifecycle manager stopped")
      },
    }
  })

  /**
   * Associate a sandbox with a session for tracking.
   * Should be called when a session starts using a sandbox.
   */
  export async function trackSandbox(sessionID: string, sandboxID: string): Promise<void> {
    const manager = await initialize()
    const work = manager.sessionWork.get(sessionID)
    if (work) {
      work.sandboxID = sandboxID
    } else {
      manager.sessionWork.set(sessionID, {
        sandboxID,
        startedAt: Date.now(),
        hasChanges: false,
      })
    }
    log.info("Tracking sandbox for session", { sessionID, sandboxID })
  }

  /**
   * Mark a session as having made changes.
   * Should be called when edit operations occur.
   */
  export async function markChanged(sessionID: string): Promise<void> {
    const manager = await initialize()
    const work = manager.sessionWork.get(sessionID)
    if (work) {
      work.hasChanges = true
    }
  }

  /**
   * Create snapshot when agent completes work.
   * Implements SPECIFICATION.md section 8.6 SnapshotLifecycle.onAgentComplete.
   *
   * @param sandboxID - ID of the sandbox to snapshot
   * @param sessionID - Session that completed work
   * @param hasChanges - Whether changes were made that are worth preserving
   * @param config - Lifecycle configuration
   * @returns The snapshot ID if created, null otherwise
   */
  async function onAgentComplete(
    sandboxID: string,
    sessionID: string,
    hasChanges: boolean,
    config: Config,
  ): Promise<string | null> {
    // Only snapshot if there are changes worth preserving
    if (!hasChanges) {
      log.info("No changes to snapshot", { sessionID, sandboxID })
      return null
    }

    try {
      // Get current git state
      const gitStatus = await SandboxService.getGitStatus(sandboxID)

      // Create snapshot
      const snapshot = await SandboxService.createSnapshot(
        sandboxID,
        sessionID,
        gitStatus.commit,
        gitStatus.syncStatus !== "synced",
      )

      if (!snapshot) {
        log.warn("Failed to create snapshot", { sessionID, sandboxID })
        return null
      }

      TelemetryLog.info("Created snapshot on agent complete", {
        "event.name": EventNames.SANDBOX_SNAPSHOT_CREATED,
        "event.domain": "sandbox",
        "opencode.session.id": sessionID,
        "opencode.sandbox.id": sandboxID,
        "opencode.snapshot.id": snapshot.id,
      })

      // Terminate sandbox to free resources if configured
      if (config.autoTerminate) {
        try {
          await SandboxService.terminate(sandboxID)
          log.info("Terminated sandbox after snapshot", {
            sessionID,
            sandboxID,
            snapshotID: snapshot.id,
          })
        } catch (err) {
          log.warn("Failed to terminate sandbox after snapshot", {
            sessionID,
            sandboxID,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      return snapshot.id
    } catch (err) {
      log.error("Error creating snapshot", {
        sessionID,
        sandboxID,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  /**
   * Handle follow-up prompt by restoring from snapshot or creating new sandbox.
   * Implements SPECIFICATION.md section 8.6 SnapshotLifecycle.onFollowUpPrompt.
   *
   * @param sessionID - Session sending the follow-up
   * @param repository - Repository for the session
   * @param branch - Branch to use
   * @param projectID - Project identifier
   * @returns The sandbox ID to use
   */
  export async function onFollowUpPrompt(
    sessionID: string,
    repository: string,
    branch: string = "main",
    projectID: string,
  ): Promise<string> {
    const manager = await initialize()
    const config = manager.config

    // Check for existing snapshot
    const hasSnapshot = await SandboxService.hasValidSnapshot(sessionID)

    if (hasSnapshot) {
      // Restore from snapshot
      const sandbox = await SandboxService.restoreSnapshot(sessionID)

      if (sandbox) {
        TelemetryLog.info("Restored sandbox from snapshot", {
          "event.name": EventNames.SANDBOX_SNAPSHOT_RESTORED,
          "event.domain": "sandbox",
          "opencode.session.id": sessionID,
          "opencode.sandbox.id": sandbox.id,
        })

        // Sync any new changes since snapshot
        if (config.syncOnRestore) {
          try {
            await SandboxService.syncGit(sandbox.id)
            log.info("Synced git after snapshot restore", {
              sessionID,
              sandboxID: sandbox.id,
            })
          } catch (err) {
            log.warn("Failed to sync git after restore", {
              sessionID,
              sandboxID: sandbox.id,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        // Track the new sandbox
        await trackSandbox(sessionID, sandbox.id)

        return sandbox.id
      }

      log.warn("Snapshot restore returned null, falling back to cold start", { sessionID })
    }

    // Cold start - try warm pool first
    const claimResult = await SandboxService.claimFromPool(repository, projectID)

    if (claimResult.sandbox) {
      TelemetryLog.info("Claimed sandbox from warm pool for follow-up", {
        "event.name": EventNames.WARMPOOL_SANDBOX_CLAIMED,
        "event.domain": "warmpool",
        "opencode.session.id": sessionID,
        "opencode.sandbox.id": claimResult.sandbox.id,
      })

      await trackSandbox(sessionID, claimResult.sandbox.id)
      return claimResult.sandbox.id
    }

    // Fall back to creating new sandbox
    const sandbox = await SandboxService.create({
      projectID,
      repository,
      branch,
    })

    TelemetryLog.info("Created new sandbox for follow-up (cold start)", {
      "event.name": EventNames.SANDBOX_CREATED,
      "event.domain": "sandbox",
      "opencode.session.id": sessionID,
      "opencode.sandbox.id": sandbox.id,
    })

    await trackSandbox(sessionID, sandbox.id)
    return sandbox.id
  }

  /**
   * Clean up expired snapshots.
   * Implements SPECIFICATION.md section 8.6 SnapshotLifecycle.cleanupExpiredSnapshots.
   *
   * @param maxAge - Maximum age in milliseconds (default: 24 hours)
   * @returns Number of snapshots cleaned up
   */
  export async function cleanupExpiredSnapshots(
    maxAge: number = 24 * 60 * 60 * 1000,
  ): Promise<number> {
    const snapshots = await SandboxService.listSnapshots()
    const cutoff = Date.now() - maxAge
    let cleaned = 0

    for (const snapshot of snapshots) {
      if (snapshot.createdAt < cutoff || snapshot.expired) {
        await SandboxService.deleteSnapshot(snapshot.id)
        cleaned++

        TelemetryLog.info("Cleaned up expired snapshot", {
          "event.name": EventNames.SANDBOX_SNAPSHOT_CLEANED,
          "event.domain": "sandbox",
          "opencode.snapshot.id": snapshot.id,
          "opencode.session.id": snapshot.sessionID,
        })
      }
    }

    if (cleaned > 0) {
      log.info("Cleaned up expired snapshots", { count: cleaned })
    }

    return cleaned
  }

  /**
   * Get lifecycle statistics
   */
  export async function stats(): Promise<{
    activeSessions: number
    totalSnapshots: number
  }> {
    const manager = await initialize()
    const snapshots = await SandboxService.listSnapshots()

    return {
      activeSessions: manager.sessionWork.size,
      totalSnapshots: snapshots.length,
    }
  }
}

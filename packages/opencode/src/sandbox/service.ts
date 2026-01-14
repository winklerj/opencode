import { Instance } from "../project/instance"
import {
  LocalProvider,
  ModalProvider,
  type Provider,
  Sandbox,
  WarmPoolManager,
  SnapshotManager,
  type Snapshot,
  type ClaimResult,
} from "@opencode-ai/sandbox"
import { Plugin } from "../plugin"
import { Config } from "../config/config"

/**
 * SandboxService provides sandbox orchestration for the project.
 *
 * This service manages sandbox lifecycle, warm pool, and snapshots,
 * providing a unified interface for the Sandbox API.
 */
export namespace SandboxService {
  /**
   * Get the sandbox provider for the current project.
   * Reads from hosted.sandbox.provider config to determine which provider to use.
   * Defaults to LocalProvider for development.
   */
  export const getProvider = Instance.state(async (): Promise<Provider> => {
    const config = await Config.get()
    const providerType = config.hosted?.sandbox?.provider ?? "local"
    const resources = config.hosted?.sandbox?.resources

    switch (providerType) {
      case "modal":
        return new ModalProvider({
          defaultCpu: resources?.cpu,
          defaultMemory: resources?.memory,
        })
      case "local":
      default:
        return new LocalProvider()
    }
  })

  /**
   * Get the warm pool manager for the current project
   */
  export const getWarmPool = Instance.state(async () => {
    const config = await Config.get()
    const warmPoolConfig = config.hosted?.sandbox?.warmPool
    const provider = await getProvider()
    const pool = new WarmPoolManager(provider, {
      size: warmPoolConfig?.size ?? 5,
      ttl: (warmPoolConfig?.ttl ?? 1800) * 1000, // Convert seconds to milliseconds
    })
    return pool
  })

  /**
   * Get the snapshot manager for the current project
   */
  export const getSnapshotManager = Instance.state(async () => {
    const manager = new SnapshotManager({
      maxSnapshotsPerSession: 100,
      snapshotTTL: 86400000, // 24 hours
    })
    return manager
  })

  /**
   * Create a new sandbox.
   * Triggers sandbox.create.before hook to allow modification of input.
   * Triggers sandbox.ready hook when sandbox reaches ready status.
   */
  export async function create(input: Sandbox.CreateInput): Promise<Sandbox.Info> {
    const parsed = Sandbox.CreateInput.parse(input)

    // Allow plugins to modify sandbox configuration before creation
    const hookOutput = await Plugin.trigger(
      "sandbox.create.before",
      {
        projectID: parsed.projectID,
        repository: parsed.repository,
        branch: parsed.branch,
        services: parsed.services,
        imageTag: parsed.imageTag,
      },
      {
        services: parsed.services,
        imageTag: parsed.imageTag,
      },
    )

    // Apply hook modifications
    const modifiedInput: Sandbox.CreateInput = {
      ...parsed,
      services: hookOutput.services,
      imageTag: hookOutput.imageTag,
    }

    const provider = await getProvider()
    const sandbox = await provider.create(modifiedInput)

    // Trigger ready hook if sandbox is ready
    if (sandbox.status === "ready") {
      await Plugin.trigger(
        "sandbox.ready",
        {
          sandboxID: sandbox.id,
          projectID: sandbox.projectID,
          status: "ready" as const,
          services: sandbox.services.map((s) => ({
            name: s.name,
            status: s.status,
            port: s.port,
            url: s.url,
          })),
        },
        {},
      )
    }

    return sandbox
  }

  /**
   * Get a sandbox by ID
   */
  export async function get(sandboxID: string): Promise<Sandbox.Info | undefined> {
    const provider = await getProvider()
    return provider.get(sandboxID)
  }

  /**
   * List all sandboxes
   */
  export async function list(projectID?: string): Promise<Sandbox.Info[]> {
    const provider = await getProvider()
    return provider.list(projectID)
  }

  /**
   * Start a sandbox
   */
  export async function start(sandboxID: string): Promise<void> {
    const provider = await getProvider()
    return provider.start(sandboxID)
  }

  /**
   * Stop a sandbox
   */
  export async function stop(sandboxID: string): Promise<void> {
    const provider = await getProvider()
    return provider.stop(sandboxID)
  }

  /**
   * Terminate a sandbox
   */
  export async function terminate(sandboxID: string): Promise<void> {
    const provider = await getProvider()
    return provider.terminate(sandboxID)
  }

  /**
   * Create a snapshot of a sandbox
   */
  export async function snapshot(sandboxID: string): Promise<string> {
    const provider = await getProvider()
    return provider.snapshot(sandboxID)
  }

  /**
   * Restore a sandbox from a snapshot
   */
  export async function restore(snapshotID: string): Promise<Sandbox.Info> {
    const provider = await getProvider()
    return provider.restore(snapshotID)
  }

  /**
   * Execute a command in a sandbox
   */
  export async function execute(
    sandboxID: string,
    command: string[],
    options?: { cwd?: string; env?: Record<string, string>; timeout?: number },
  ): Promise<Sandbox.ExecuteResult> {
    const provider = await getProvider()
    return provider.execute(sandboxID, command, options)
  }

  /**
   * Stream logs from a sandbox service
   */
  export async function* streamLogs(sandboxID: string, service: string): AsyncIterable<string> {
    const provider = await getProvider()
    yield* provider.streamLogs(sandboxID, service)
  }

  /**
   * Get git sync status
   */
  export async function getGitStatus(sandboxID: string): Promise<Sandbox.Git> {
    const provider = await getProvider()
    return provider.getGitStatus(sandboxID)
  }

  /**
   * Trigger git sync
   */
  export async function syncGit(sandboxID: string): Promise<void> {
    const provider = await getProvider()
    return provider.syncGit(sandboxID)
  }

  /**
   * Claim a sandbox from the warm pool
   */
  export async function claimFromPool(
    repository: string,
    projectID: string,
    imageTag?: string,
  ): Promise<ClaimResult> {
    const pool = await getWarmPool()
    return pool.claim(repository, projectID, imageTag)
  }

  /**
   * Release a sandbox back to the warm pool
   */
  export async function releaseToPool(sandboxID: string): Promise<boolean> {
    const pool = await getWarmPool()
    return pool.release(sandboxID)
  }

  /**
   * Trigger warmup on typing.
   * This also triggers the prompt.typing hook to allow plugins to provide warmup hints.
   */
  export async function onTyping(
    repository: string,
    projectID: string,
    sessionID: string,
    partialPrompt: string = "",
    imageTag?: string,
  ): Promise<void> {
    // Trigger the prompt.typing hook to allow plugins to provide warmup hints
    const hookOutput = await Plugin.trigger(
      "prompt.typing",
      {
        sessionID,
        partialPrompt,
        keystrokeTimestamp: Date.now(),
      },
      {
        warmupHints: {
          services: [],
          estimatedRepo: repository,
        },
      },
    )

    // Use warmup hints from hook if provided
    const estimatedRepo = hookOutput.warmupHints?.estimatedRepo ?? repository

    const pool = await getWarmPool()
    return pool.onTyping(estimatedRepo, projectID, imageTag)
  }

  /**
   * Check if a file edit operation is allowed based on git sync status.
   * This triggers the sandbox.edit.before hook.
   *
   * @returns Object with allowed flag and optional reason if blocked
   */
  export async function checkEditAllowed(
    sandboxID: string,
    file: string,
    tool: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const hookOutput = await Plugin.trigger(
      "sandbox.edit.before",
      {
        sandboxID,
        file,
        tool,
      },
      {
        allowed: true,
        reason: undefined,
      },
    )

    return {
      allowed: hookOutput.allowed,
      reason: hookOutput.reason,
    }
  }

  /**
   * Get warm pool statistics
   */
  export async function poolStats(): Promise<{ total: number; byTag: Record<string, number> }> {
    const pool = await getWarmPool()
    return {
      total: pool.getTotalPoolSize(),
      byTag: {}, // WarmPoolManager doesn't expose per-tag stats directly
    }
  }

  /**
   * Create a managed snapshot
   *
   * Note: To use this, you should first get the git status from the sandbox
   * to provide the git commit hash and uncommitted changes status.
   */
  export async function createSnapshot(
    sandboxID: string,
    sessionID: string,
    gitCommit: string,
    hasUncommittedChanges: boolean = false,
  ): Promise<Snapshot | null> {
    const manager = await getSnapshotManager()
    return manager.create(sandboxID, sessionID, gitCommit, hasUncommittedChanges)
  }

  /**
   * Restore from a managed snapshot for a session
   */
  export async function restoreSnapshot(sessionID: string): Promise<Sandbox.Info | null> {
    const manager = await getSnapshotManager()
    return manager.restore(sessionID)
  }

  /**
   * Get latest snapshot for a session
   */
  export async function getLatestSnapshot(sessionID: string): Promise<Snapshot | undefined> {
    const manager = await getSnapshotManager()
    return manager.getLatest(sessionID)
  }

  /**
   * List all managed snapshots for a session
   */
  export async function listSnapshots(sessionID?: string): Promise<Snapshot[]> {
    const manager = await getSnapshotManager()
    if (sessionID) {
      return manager.bySession(sessionID)
    }
    return manager.all()
  }

  /**
   * Delete a managed snapshot
   */
  export async function deleteSnapshot(snapshotID: string): Promise<boolean> {
    const manager = await getSnapshotManager()
    return manager.remove(snapshotID)
  }

  /**
   * Check if session has a valid snapshot
   */
  export async function hasValidSnapshot(sessionID: string): Promise<boolean> {
    const manager = await getSnapshotManager()
    return manager.hasValidSnapshot(sessionID)
  }
}

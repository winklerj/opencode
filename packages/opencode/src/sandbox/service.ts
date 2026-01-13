import { Instance } from "../project/instance"
import { LocalProvider, type Provider, Sandbox, WarmPoolManager, SnapshotManager } from "@opencode-ai/sandbox"

/**
 * SandboxService provides sandbox orchestration for the project.
 *
 * This service manages sandbox lifecycle, warm pool, and snapshots,
 * providing a unified interface for the Sandbox API.
 */
export namespace SandboxService {
  /**
   * Get the sandbox provider for the current project.
   * Currently uses LocalProvider for development.
   */
  export const getProvider = Instance.state(async (): Promise<Provider> => {
    // TODO: Support configurable providers (Modal, Kubernetes)
    const provider = new LocalProvider()
    return provider
  })

  /**
   * Get the warm pool manager for the current project
   */
  export const getWarmPool = Instance.state(async () => {
    const provider = await getProvider()
    const pool = new WarmPoolManager(provider, {
      maxSize: 5,
      ttl: 1800000, // 30 minutes
      warmTimeout: 120000,
    })
    return pool
  })

  /**
   * Get the snapshot manager for the current project
   */
  export const getSnapshotManager = Instance.state(async () => {
    const provider = await getProvider()
    const manager = new SnapshotManager(provider, {
      maxSnapshots: 100,
      defaultTTL: 86400000, // 24 hours
    })
    return manager
  })

  /**
   * Create a new sandbox
   */
  export async function create(input: Sandbox.CreateInput): Promise<Sandbox.Info> {
    const provider = await getProvider()
    return provider.create(input)
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
  export async function claimFromPool(projectID: string): Promise<Sandbox.Info | null> {
    const pool = await getWarmPool()
    return pool.claim(projectID)
  }

  /**
   * Release a sandbox back to the warm pool
   */
  export async function releaseToPool(sandbox: Sandbox.Info): Promise<void> {
    const pool = await getWarmPool()
    return pool.release(sandbox)
  }

  /**
   * Trigger warmup on typing
   */
  export async function onTyping(projectID: string): Promise<void> {
    const pool = await getWarmPool()
    return pool.onTyping(projectID)
  }

  /**
   * Get warm pool statistics
   */
  export async function poolStats() {
    const pool = await getWarmPool()
    return pool.stats()
  }

  /**
   * Create a managed snapshot
   */
  export async function createSnapshot(
    sandboxID: string,
    options?: { ttl?: number },
  ): Promise<{ id: string; expiresAt: number }> {
    const manager = await getSnapshotManager()
    const snapshot = await manager.create(sandboxID, options)
    return { id: snapshot.id, expiresAt: snapshot.expiresAt }
  }

  /**
   * Restore from a managed snapshot
   */
  export async function restoreSnapshot(snapshotID: string): Promise<Sandbox.Info> {
    const manager = await getSnapshotManager()
    return manager.restore(snapshotID)
  }

  /**
   * List all managed snapshots
   */
  export async function listSnapshots(): Promise<Array<{ id: string; sandboxID: string; expiresAt: number }>> {
    const manager = await getSnapshotManager()
    return manager.list()
  }

  /**
   * Delete a managed snapshot
   */
  export async function deleteSnapshot(snapshotID: string): Promise<boolean> {
    const manager = await getSnapshotManager()
    return manager.delete(snapshotID)
  }
}

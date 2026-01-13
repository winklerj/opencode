import { z } from "zod"
import type { Provider } from "../provider"
import type { Sandbox } from "../sandbox"

/**
 * Configuration for the warm pool
 */
export const WarmPoolConfig = z.object({
  enabled: z.boolean().default(true),
  size: z.number().default(3),
  ttl: z.number().default(1800000), // 30 minutes in milliseconds
  typingTrigger: z.boolean().default(true),
  replenishInterval: z.number().default(5000), // Check every 5 seconds
})
export type WarmPoolConfig = z.input<typeof WarmPoolConfig>

/**
 * Entry in the warm pool
 */
interface PoolEntry {
  sandboxID: string
  repository: string
  imageTag: string
  addedAt: number
}

/**
 * Result of a claim operation
 */
export interface ClaimResult {
  sandbox: Sandbox.Info
  fromWarmPool: boolean
}

/**
 * WarmPoolManager maintains a pool of pre-warmed sandboxes for fast startup.
 *
 * Key behaviors from TLA+ specification:
 * - INVARIANT: WarmPoolSandboxesReady - All sandboxes in pool must be "ready"
 * - INVARIANT: warmPool ⊆ DOMAIN sandboxes - All entries must exist
 * - LIVENESS: WarmPoolEventuallyReplenished - Pool replenished when depleted
 *
 * Key features:
 * - Maintains pool per repository/imageTag combination
 * - Claims sandbox from pool on typing trigger (before prompt submit)
 * - Automatically replenishes pool in background
 * - Handles TTL expiration of stale sandboxes
 */
export class WarmPoolManager {
  private pool = new Map<string, PoolEntry[]>() // imageTag -> entries
  private config: z.output<typeof WarmPoolConfig>
  private replenishTimer: ReturnType<typeof setInterval> | null = null
  private pendingReplenish = new Set<string>() // imageTag currently being replenished

  constructor(
    private provider: Provider,
    config: WarmPoolConfig = {},
  ) {
    this.config = WarmPoolConfig.parse(config)
  }

  /**
   * Start the warm pool manager.
   * Begins background replenishment process.
   */
  start(): void {
    if (!this.config.enabled) return
    if (this.replenishTimer) return

    this.replenishTimer = setInterval(() => {
      this.cleanupExpired()
    }, this.config.replenishInterval)
  }

  /**
   * Stop the warm pool manager.
   * Stops background processes but doesn't terminate sandboxes.
   */
  stop(): void {
    if (this.replenishTimer) {
      clearInterval(this.replenishTimer)
      this.replenishTimer = null
    }
  }

  /**
   * Claim a sandbox from the warm pool for the given repository.
   * If no warm sandbox is available, creates a new one (cold start).
   *
   * @param repository - Repository URL
   * @param projectID - Project ID for the sandbox
   * @param imageTag - Optional specific image tag
   * @returns The claimed sandbox and whether it came from the warm pool
   */
  async claim(repository: string, projectID: string, imageTag?: string): Promise<ClaimResult> {
    const tag = imageTag ?? this.getDefaultTag(repository)

    // Try to get from warm pool first
    const entry = this.popEntry(tag)
    if (entry) {
      const sandbox = await this.provider.get(entry.sandboxID)
      if (sandbox && sandbox.status === "ready") {
        // Mark as running and return
        await this.provider.start(entry.sandboxID)
        const updated = await this.provider.get(entry.sandboxID)
        if (updated) {
          // Trigger replenishment in background
          this.replenishIfNeeded(tag, repository, projectID)
          return { sandbox: updated, fromWarmPool: true }
        }
      }
      // Sandbox was not valid, fall through to cold start
    }

    // Cold start: create new sandbox
    const sandbox = await this.provider.create({
      projectID,
      repository,
      imageTag: tag,
    })

    // Wait for it to be ready
    const ready = await this.waitForReady(sandbox.id)

    // Start the sandbox
    await this.provider.start(sandbox.id)
    const started = await this.provider.get(sandbox.id)

    // Trigger replenishment in background
    this.replenishIfNeeded(tag, repository, projectID)

    return { sandbox: started ?? ready, fromWarmPool: false }
  }

  /**
   * Return a sandbox to the warm pool.
   * Only accepts sandboxes in "ready" or "suspended" state.
   *
   * @param sandboxID - ID of sandbox to return
   * @returns true if sandbox was added to pool, false otherwise
   */
  async release(sandboxID: string): Promise<boolean> {
    if (!this.config.enabled) return false

    const sandbox = await this.provider.get(sandboxID)
    if (!sandbox) return false

    // Stop the sandbox if running
    if (sandbox.status === "running") {
      await this.provider.stop(sandboxID)
    }

    // Verify it's in a valid state for pooling
    const updated = await this.provider.get(sandboxID)
    if (!updated || (updated.status !== "ready" && updated.status !== "suspended")) {
      return false
    }

    const tag = sandbox.image.tag
    const entry: PoolEntry = {
      sandboxID,
      repository: sandbox.git.repo,
      imageTag: tag,
      addedAt: Date.now(),
    }

    this.addEntry(tag, entry)
    return true
  }

  /**
   * Pre-warm the pool for a specific repository.
   * Creates sandboxes up to the configured pool size.
   *
   * @param repository - Repository URL to warm
   * @param projectID - Project ID for the sandboxes
   * @param imageTag - Optional specific image tag
   * @param count - Number of sandboxes to warm (default: config.size)
   */
  async warm(repository: string, projectID: string, imageTag?: string, count?: number): Promise<void> {
    if (!this.config.enabled) return

    const tag = imageTag ?? this.getDefaultTag(repository)
    const targetCount = count ?? this.config.size
    const currentCount = this.getPoolSize(tag)
    const toCreate = Math.max(0, targetCount - currentCount)

    const promises = Array.from({ length: toCreate }, async () => {
      const sandbox = await this.provider.create({
        projectID,
        repository,
        imageTag: tag,
      })

      await this.waitForReady(sandbox.id)

      const entry: PoolEntry = {
        sandboxID: sandbox.id,
        repository,
        imageTag: tag,
        addedAt: Date.now(),
      }
      this.addEntry(tag, entry)
    })

    await Promise.all(promises)
  }

  /**
   * Get the current pool size for an image tag
   */
  getPoolSize(imageTag: string): number {
    return this.pool.get(imageTag)?.length ?? 0
  }

  /**
   * Get total pool size across all tags
   */
  getTotalPoolSize(): number {
    let total = 0
    for (const entries of this.pool.values()) {
      total += entries.length
    }
    return total
  }

  /**
   * Check if a warm sandbox is available for the given tag
   */
  hasAvailable(imageTag: string): boolean {
    return this.getPoolSize(imageTag) > 0
  }

  /**
   * Trigger warmup based on user typing.
   * This is called when the typing trigger is enabled and user starts typing.
   *
   * @param repository - Repository URL
   * @param projectID - Project ID
   * @param imageTag - Optional specific image tag
   */
  async onTyping(repository: string, projectID: string, imageTag?: string): Promise<void> {
    if (!this.config.enabled || !this.config.typingTrigger) return

    const tag = imageTag ?? this.getDefaultTag(repository)

    // If pool is empty for this tag, start warming
    if (!this.hasAvailable(tag)) {
      this.replenishIfNeeded(tag, repository, projectID)
    }
  }

  /**
   * Cleanup expired entries from the pool
   */
  private cleanupExpired(): void {
    const now = Date.now()
    const cutoff = now - this.config.ttl

    for (const [tag, entries] of this.pool.entries()) {
      const valid = entries.filter((e) => e.addedAt > cutoff)
      const expired = entries.filter((e) => e.addedAt <= cutoff)

      // Terminate expired sandboxes
      for (const entry of expired) {
        this.provider.terminate(entry.sandboxID).catch(() => {
          // Ignore termination errors
        })
      }

      if (valid.length > 0) {
        this.pool.set(tag, valid)
      } else {
        this.pool.delete(tag)
      }
    }
  }

  /**
   * Add an entry to the pool
   */
  private addEntry(tag: string, entry: PoolEntry): void {
    const entries = this.pool.get(tag) ?? []
    entries.push(entry)
    this.pool.set(tag, entries)
  }

  /**
   * Pop an entry from the pool (LIFO for freshness)
   */
  private popEntry(tag: string): PoolEntry | undefined {
    const entries = this.pool.get(tag)
    if (!entries || entries.length === 0) return undefined

    return entries.pop()
  }

  /**
   * Trigger replenishment if pool is below target size
   */
  private replenishIfNeeded(tag: string, repository: string, projectID: string): void {
    if (!this.config.enabled) return
    if (this.pendingReplenish.has(tag)) return

    const currentSize = this.getPoolSize(tag)
    if (currentSize >= this.config.size) return

    this.pendingReplenish.add(tag)

    // Replenish in background
    this.warm(repository, projectID, tag)
      .catch(() => {
        // Ignore replenish errors
      })
      .finally(() => {
        this.pendingReplenish.delete(tag)
      })
  }

  /**
   * Wait for a sandbox to become ready
   */
  private async waitForReady(sandboxID: string, timeout = 120000): Promise<Sandbox.Info> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const sandbox = await this.provider.get(sandboxID)
      if (!sandbox) throw new Error(`Sandbox ${sandboxID} not found`)
      if (sandbox.status === "ready") return sandbox
      if (sandbox.status === "terminated") throw new Error(`Sandbox ${sandboxID} was terminated`)

      // Wait before checking again
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`Sandbox ${sandboxID} did not become ready within timeout`)
  }

  /**
   * Get default image tag for a repository
   */
  private getDefaultTag(repository: string): string {
    // Extract org/repo from URL and use as tag base
    const match = repository.match(/([^/]+\/[^/]+?)(?:\.git)?$/)
    const repoName = match?.[1] ?? "default"
    return `${repoName}:latest`
  }
}

import { z } from "zod"
import { AgentSpawner, SpawnerConfig } from "./spawner"
import { type Agent, type AgentEvent, isTerminal, SpawnInput } from "./agent"

/**
 * Resource limits for the scheduler
 */
export const ResourceLimits = z.object({
  maxConcurrent: z.number().default(5), // Max agents running at once
  maxQueued: z.number().default(100), // Max agents waiting in queue
  maxPerSession: z.number().default(10), // Max agents per parent session
})
export type ResourceLimits = z.input<typeof ResourceLimits>

/**
 * Full scheduler configuration
 */
export const FullSchedulerConfig = z.object({
  limits: ResourceLimits.default({}),
  spawner: SpawnerConfig.default({}),
  initTimeout: z.number().default(120000), // 2 min to initialize
  runTimeout: z.number().default(3600000), // 1 hour max run time
  autoProcess: z.boolean().default(false), // Auto-process queue on spawn
})
export type FullSchedulerConfig = z.input<typeof FullSchedulerConfig>

/**
 * Result of a spawn request
 */
export interface SpawnResult {
  success: boolean
  agent?: Agent
  error?: string
}

/**
 * Callback for initializing an agent's sandbox
 */
export type InitializeCallback = (agent: Agent) => Promise<{ sandboxID: string } | { error: string }>

/**
 * Callback for running an agent's task
 */
export type RunCallback = (agent: Agent) => Promise<{ output: unknown } | { error: string }>

/**
 * AgentScheduler manages resource allocation for background agents.
 *
 * Key behaviors from TLA+ specification:
 * - Respects MaxBackgroundAgents limit
 * - Manages agent lifecycle: queued -> initializing -> running -> completed/failed
 * - Provides resource scheduling and limits
 *
 * Invariants:
 * - MaxBackgroundAgents: Never exceed configured limits
 * - Agents transition through valid states only
 */
export class AgentScheduler {
  private config: z.output<typeof FullSchedulerConfig>
  private spawner: AgentSpawner
  private listeners: Set<(event: AgentEvent) => void> = new Set()
  private initializeCallback?: InitializeCallback
  private runCallback?: RunCallback
  private processing = false

  constructor(config: FullSchedulerConfig = {}) {
    this.config = FullSchedulerConfig.parse(config)
    this.spawner = new AgentSpawner(this.config.spawner)

    // Forward spawner events
    this.spawner.subscribe((event) => {
      for (const listener of this.listeners) {
        try {
          listener(event)
        } catch {
          // Ignore
        }
      }
    })
  }

  /**
   * Set the callback for initializing agent sandboxes
   */
  onInitialize(callback: InitializeCallback): void {
    this.initializeCallback = callback
  }

  /**
   * Set the callback for running agent tasks
   */
  onRun(callback: RunCallback): void {
    this.runCallback = callback
  }

  /**
   * Request to spawn a new background agent.
   * The agent will be queued and processed based on available resources.
   *
   * @param input - Spawn configuration
   * @returns Result with the created agent or error
   */
  spawn(input: SpawnInput): SpawnResult {
    const parsed = SpawnInput.parse(input)

    // Check queued limit
    const queuedCount = this.spawner.byStatus("queued").length
    if (queuedCount >= this.config.limits.maxQueued) {
      return { success: false, error: `Queue full (max ${this.config.limits.maxQueued})` }
    }

    // Check per-session limit
    const sessionAgents = this.spawner.byParentSession(parsed.parentSessionID)
    const activeSessionAgents = sessionAgents.filter((a) => !isTerminal(a.status))
    if (activeSessionAgents.length >= this.config.limits.maxPerSession) {
      return { success: false, error: `Session limit reached (max ${this.config.limits.maxPerSession})` }
    }

    try {
      const agent = this.spawner.spawn(input)

      // Trigger processing if autoProcess is enabled
      if (this.config.autoProcess) {
        this.processQueue()
      }

      return { success: true, agent }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * Manually trigger queue processing.
   * Use this when autoProcess is disabled.
   */
  process(): void {
    this.processQueue()
  }

  /**
   * Cancel an agent
   */
  cancel(agentID: string): boolean {
    return this.spawner.cancel(agentID)
  }

  /**
   * Get an agent by ID
   */
  get(agentID: string): Agent | undefined {
    return this.spawner.get(agentID)
  }

  /**
   * Get all agents
   */
  all(): Agent[] {
    return this.spawner.all()
  }

  /**
   * Get agents by parent session
   */
  byParentSession(parentSessionID: string): Agent[] {
    return this.spawner.byParentSession(parentSessionID)
  }

  /**
   * Get count of running agents
   */
  runningCount(): number {
    return this.spawner.byStatus("running").length + this.spawner.byStatus("initializing").length
  }

  /**
   * Get count of queued agents
   */
  queuedCount(): number {
    return this.spawner.byStatus("queued").length
  }

  /**
   * Check if scheduler can accept more agents
   */
  canSpawn(): boolean {
    return this.spawner.byStatus("queued").length < this.config.limits.maxQueued
  }

  /**
   * Check if scheduler has capacity to run more agents
   */
  hasCapacity(): boolean {
    return this.runningCount() < this.config.limits.maxConcurrent
  }

  /**
   * Subscribe to agent events
   */
  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Process the queue - start queued agents if capacity available
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      while (this.hasCapacity()) {
        const queued = this.spawner.queued()
        if (queued.length === 0) break

        // Get the first queued agent (FIFO)
        const agent = queued[0]

        // Start initialization
        await this.initializeAgent(agent)
      }
    } finally {
      this.processing = false
    }
  }

  /**
   * Initialize an agent (get sandbox, setup environment)
   */
  private async initializeAgent(agent: Agent): Promise<void> {
    // First transition to initializing - required before callback errors can fail the agent
    // (queued -> failed is not valid, but initializing -> failed is valid)
    if (!this.spawner.transition(agent.id, "initializing")) {
      // Couldn't transition, agent was probably already cancelled
      return
    }

    if (!this.initializeCallback) {
      // Auto-transition without callback - set placeholder sandboxID
      const agentData = this.spawner.get(agent.id)
      if (agentData) {
        agentData.sandboxID = `sandbox_${agent.id}`
      }
      this.spawner.startRunning(agent.id)
      await this.runAgent(agent)
      return
    }

    try {
      // Call the initialization callback
      const result = await Promise.race([
        this.initializeCallback(agent),
        this.timeout(this.config.initTimeout, "Initialization timeout"),
      ])

      if ("error" in result) {
        this.spawner.fail(agent.id, result.error)
        this.processQueue()
        return
      }

      // Set sandboxID and transition to running
      const agentData = this.spawner.get(agent.id)
      if (agentData) {
        agentData.sandboxID = result.sandboxID
      }
      this.spawner.startRunning(agent.id)

      // Run the agent
      await this.runAgent(agent)
    } catch (err) {
      this.spawner.fail(agent.id, err instanceof Error ? err.message : String(err))
      this.processQueue()
    }
  }

  /**
   * Run an agent's task
   */
  private async runAgent(agent: Agent): Promise<void> {
    if (!this.runCallback) {
      // Auto-complete without callback
      this.spawner.complete(agent.id)
      this.processQueue()
      return
    }

    try {
      const result = await Promise.race([
        this.runCallback(agent),
        this.timeout(this.config.runTimeout, "Run timeout"),
      ])

      if ("error" in result) {
        this.spawner.fail(agent.id, result.error)
      } else {
        this.spawner.complete(agent.id, result.output)
      }
    } catch (err) {
      this.spawner.fail(agent.id, err instanceof Error ? err.message : String(err))
    }

    // Process more queued agents
    this.processQueue()
  }

  /**
   * Create a timeout promise
   */
  private timeout(ms: number, message: string): Promise<{ error: string }> {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ error: message }), ms)
    })
  }

  /**
   * Clean up terminated agents
   */
  cleanup(): number {
    return this.spawner.clearTerminated()
  }

  /**
   * Get scheduler statistics
   */
  stats(): SchedulerStats {
    const all = this.spawner.all()
    return {
      total: all.length,
      queued: this.spawner.byStatus("queued").length,
      initializing: this.spawner.byStatus("initializing").length,
      running: this.spawner.byStatus("running").length,
      completed: this.spawner.byStatus("completed").length,
      failed: this.spawner.byStatus("failed").length,
      cancelled: this.spawner.byStatus("cancelled").length,
      capacity: this.config.limits.maxConcurrent - this.runningCount(),
      queueSpace: this.config.limits.maxQueued - this.queuedCount(),
    }
  }
}

/**
 * Scheduler statistics
 */
export interface SchedulerStats {
  total: number
  queued: number
  initializing: number
  running: number
  completed: number
  failed: number
  cancelled: number
  capacity: number
  queueSpace: number
}

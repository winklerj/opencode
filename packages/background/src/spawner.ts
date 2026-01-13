import { z } from "zod"
import {
  Agent,
  AgentStatus,
  SpawnInput,
  type AgentEvent,
  isValidTransition,
  isTerminal,
  VALID_TRANSITIONS,
} from "./agent"

/**
 * Configuration for the AgentSpawner
 */
export const SpawnerConfig = z.object({
  maxAgents: z.number().default(100),
})
export type SpawnerConfig = z.input<typeof SpawnerConfig>

/**
 * AgentSpawner manages the creation and lifecycle of background agents.
 *
 * Key behaviors from TLA+ specification:
 * - Spawn new agents with SpawnBackgroundAgent action
 * - Track agent status transitions
 * - Enforce valid status transitions
 * - Maintain agent counter for unique IDs
 *
 * Invariants:
 * - ValidAgentStatusTransitions: All agent statuses are valid
 * - Status can only transition according to VALID_TRANSITIONS
 */
export class AgentSpawner {
  private agents = new Map<string, Agent>()
  private config: z.output<typeof SpawnerConfig>
  private idCounter = 0
  private sessionCounter = 0
  private listeners: Set<(event: AgentEvent) => void> = new Set()

  constructor(config: SpawnerConfig = {}) {
    this.config = SpawnerConfig.parse(config)
  }

  /**
   * Generate a unique agent ID
   */
  private generateAgentId(): string {
    return `agent_${Date.now()}_${++this.idCounter}`
  }

  /**
   * Generate a unique session ID for the agent
   */
  private generateSessionId(): string {
    return `agent_session_${Date.now()}_${++this.sessionCounter}`
  }

  /**
   * Spawn a new background agent.
   * Implements TLA+ SpawnBackgroundAgent action.
   *
   * @param input - Spawn configuration
   * @returns The created agent in "queued" status
   */
  spawn(input: SpawnInput): Agent {
    const parsed = SpawnInput.parse(input)

    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(`Maximum agents limit reached (${this.config.maxAgents})`)
    }

    const agent: Agent = {
      id: this.generateAgentId(),
      parentSessionID: parsed.parentSessionID,
      sessionID: this.generateSessionId(),
      sandboxID: undefined, // Will be assigned during initialization
      status: "queued",
      task: parsed.task,
      createdAt: Date.now(),
    }

    this.agents.set(agent.id, agent)
    this.emit({ type: "spawned", agent })

    return agent
  }

  /**
   * Transition an agent to a new status.
   * Enforces valid transitions according to TLA+ spec.
   *
   * @param agentID - ID of the agent
   * @param newStatus - Target status
   * @param options - Additional options (error message, output)
   * @returns true if transition succeeded
   */
  transition(
    agentID: string,
    newStatus: AgentStatus,
    options?: { error?: string; output?: unknown; sandboxID?: string },
  ): boolean {
    const agent = this.agents.get(agentID)
    if (!agent) {
      return false
    }

    if (!isValidTransition(agent.status, newStatus)) {
      return false
    }

    const oldStatus = agent.status
    agent.status = newStatus

    // Update timestamps
    if (newStatus === "initializing") {
      agent.startedAt = Date.now()
    }
    if (isTerminal(newStatus)) {
      agent.completedAt = Date.now()
    }

    // Set sandbox ID if provided (during initialization)
    if (options?.sandboxID) {
      agent.sandboxID = options.sandboxID
    }

    // Set error if failed
    if (newStatus === "failed" && options?.error) {
      agent.error = options.error
    }

    // Set output if completed
    if (newStatus === "completed" && options?.output !== undefined) {
      agent.output = options.output
    }

    // Emit appropriate event
    switch (newStatus) {
      case "initializing":
        this.emit({ type: "initializing", agent })
        break
      case "running":
        this.emit({ type: "running", agent })
        break
      case "completed":
        this.emit({ type: "completed", agent })
        break
      case "failed":
        this.emit({ type: "failed", agent, error: agent.error || "Unknown error" })
        break
      case "cancelled":
        this.emit({ type: "cancelled", agent })
        break
    }

    return true
  }

  /**
   * Start initializing an agent.
   * Implements TLA+ AgentStartInitializing action.
   *
   * @param agentID - ID of the agent
   * @param sandboxID - Sandbox assigned to this agent
   * @returns true if transition succeeded
   */
  startInitializing(agentID: string, sandboxID: string): boolean {
    return this.transition(agentID, "initializing", { sandboxID })
  }

  /**
   * Start running an agent.
   * Implements TLA+ AgentStartRunning action.
   *
   * @param agentID - ID of the agent
   * @returns true if transition succeeded
   */
  startRunning(agentID: string): boolean {
    return this.transition(agentID, "running")
  }

  /**
   * Mark an agent as completed.
   * Implements TLA+ AgentComplete action.
   *
   * @param agentID - ID of the agent
   * @param output - Optional output from the agent
   * @returns true if transition succeeded
   */
  complete(agentID: string, output?: unknown): boolean {
    return this.transition(agentID, "completed", { output })
  }

  /**
   * Mark an agent as failed.
   * Implements TLA+ AgentFail action.
   *
   * @param agentID - ID of the agent
   * @param error - Error message
   * @returns true if transition succeeded
   */
  fail(agentID: string, error: string): boolean {
    return this.transition(agentID, "failed", { error })
  }

  /**
   * Cancel an agent.
   * Implements TLA+ CancelAgent action.
   *
   * @param agentID - ID of the agent
   * @returns true if transition succeeded
   */
  cancel(agentID: string): boolean {
    return this.transition(agentID, "cancelled")
  }

  /**
   * Get an agent by ID
   */
  get(agentID: string): Agent | undefined {
    return this.agents.get(agentID)
  }

  /**
   * Get all agents
   */
  all(): Agent[] {
    return Array.from(this.agents.values())
  }

  /**
   * Get agents by status
   */
  byStatus(status: AgentStatus): Agent[] {
    return Array.from(this.agents.values()).filter((a) => a.status === status)
  }

  /**
   * Get agents by parent session
   */
  byParentSession(parentSessionID: string): Agent[] {
    return Array.from(this.agents.values()).filter((a) => a.parentSessionID === parentSessionID)
  }

  /**
   * Get queued agents (ready to be initialized)
   */
  queued(): Agent[] {
    return this.byStatus("queued")
  }

  /**
   * Get running agents (currently executing)
   */
  running(): Agent[] {
    return this.byStatus("running")
  }

  /**
   * Get count of active agents (queued, initializing, or running)
   */
  activeCount(): number {
    return Array.from(this.agents.values()).filter((a) => !isTerminal(a.status)).length
  }

  /**
   * Get total agent count
   */
  get count(): number {
    return this.agents.size
  }

  /**
   * Subscribe to agent events
   */
  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Remove a terminated agent from tracking (cleanup)
   */
  remove(agentID: string): boolean {
    const agent = this.agents.get(agentID)
    if (!agent || !isTerminal(agent.status)) {
      return false
    }
    return this.agents.delete(agentID)
  }

  /**
   * Clear all terminated agents
   */
  clearTerminated(): number {
    let count = 0
    for (const [id, agent] of this.agents) {
      if (isTerminal(agent.status)) {
        this.agents.delete(id)
        count++
      }
    }
    return count
  }
}

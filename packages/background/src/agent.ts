import { z } from "zod"

/**
 * Status of a background agent
 * Matches TLA+ AgentStatus from specification
 */
export const AgentStatus = z.enum(["queued", "initializing", "running", "completed", "failed", "cancelled"])
export type AgentStatus = z.infer<typeof AgentStatus>

/**
 * A background agent record
 * Matches TLA+ AgentRecord from specification
 */
export const Agent = z.object({
  id: z.string(),
  parentSessionID: z.string(),
  sessionID: z.string(),
  sandboxID: z.string().optional(), // "pending" initially
  status: AgentStatus,
  task: z.string(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  error: z.string().optional(),
  output: z.unknown().optional(),
})
export type Agent = z.infer<typeof Agent>

/**
 * Input for spawning a background agent
 */
export const SpawnInput = z.object({
  parentSessionID: z.string(),
  task: z.string(),
  sandboxConfig: z
    .object({
      repository: z.string(),
      branch: z.string().optional(),
      imageTag: z.string().optional(),
    })
    .optional(),
})
export type SpawnInput = z.input<typeof SpawnInput>

/**
 * Configuration for the agent scheduler
 */
export const SchedulerConfig = z.object({
  maxConcurrent: z.number().default(5),
  maxQueued: z.number().default(100),
  initTimeout: z.number().default(120000), // 2 min to initialize
  runTimeout: z.number().default(3600000), // 1 hour max run time
})
export type SchedulerConfig = z.input<typeof SchedulerConfig>

/**
 * Events emitted by the agent system
 */
export type AgentEvent =
  | { type: "spawned"; agent: Agent }
  | { type: "initializing"; agent: Agent }
  | { type: "running"; agent: Agent }
  | { type: "completed"; agent: Agent }
  | { type: "failed"; agent: Agent; error: string }
  | { type: "cancelled"; agent: Agent }

/**
 * Valid status transitions for background agents.
 * From TLA+ spec:
 *   queued -> initializing -> running -> completed/failed/cancelled
 *   queued -> cancelled
 *   initializing -> failed/cancelled
 *   running -> failed/cancelled
 */
export const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  queued: ["initializing", "cancelled"],
  initializing: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
}

/**
 * Check if a status transition is valid
 */
export function isValidTransition(from: AgentStatus, to: AgentStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to)
}

/**
 * Terminal statuses - agents in these states won't change
 */
export const TERMINAL_STATUSES: AgentStatus[] = ["completed", "failed", "cancelled"]

/**
 * Check if an agent is in a terminal state
 */
export function isTerminal(status: AgentStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

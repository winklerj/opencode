import { z } from "zod"

/**
 * Status of a prompt in the queue
 */
export const PromptStatus = z.enum(["queued", "executing", "completed", "cancelled"])
export type PromptStatus = z.infer<typeof PromptStatus>

/**
 * Priority levels for prompts
 */
export const PromptPriority = z.enum(["normal", "high", "urgent"])
export type PromptPriority = z.infer<typeof PromptPriority>

/**
 * A prompt entry in the queue
 */
export const Prompt = z.object({
  id: z.string(),
  sessionID: z.string(),
  userID: z.string(),
  content: z.string(),
  status: PromptStatus,
  priority: PromptPriority,
  createdAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
})
export type Prompt = z.infer<typeof Prompt>

/**
 * Configuration for the prompt queue
 */
export const PromptQueueConfig = z.object({
  maxPrompts: z.number().default(100),
  allowReorder: z.boolean().default(true),
})
export type PromptQueueConfig = z.input<typeof PromptQueueConfig>

/**
 * PromptQueue manages the queue of prompts for a session.
 *
 * Key behaviors from TLA+ specification:
 * - Follow-up prompts during execution are queued (not inserted mid-stream)
 * - Only one prompt can execute at a time per session
 * - Users can cancel their own queued prompts
 * - Queue is visible to all multiplayer users
 *
 * Invariants:
 * - OnePromptExecutingPerSession: At most one prompt executing at a time
 * - Users can only cancel their own prompts
 * - FIFO ordering within priority levels
 */
export class PromptQueue {
  private queue: Prompt[] = []
  private config: z.output<typeof PromptQueueConfig>
  private idCounter = 0
  private listeners: Set<(event: QueueEvent) => void> = new Set()

  constructor(
    private sessionID: string,
    config: PromptQueueConfig = {},
  ) {
    this.config = PromptQueueConfig.parse(config)
  }

  /**
   * Generate a unique prompt ID
   */
  private generateId(): string {
    return `prompt_${this.sessionID}_${Date.now()}_${++this.idCounter}`
  }

  /**
   * Add a prompt to the queue.
   *
   * @param userID - ID of the user submitting the prompt
   * @param content - The prompt content
   * @param priority - Priority level (default: normal)
   * @returns The created prompt
   */
  add(userID: string, content: string, priority: PromptPriority = "normal"): Prompt {
    if (this.queue.length >= this.config.maxPrompts) {
      throw new Error(`Queue is full (max ${this.config.maxPrompts} prompts)`)
    }

    const prompt: Prompt = {
      id: this.generateId(),
      sessionID: this.sessionID,
      userID,
      content,
      status: "queued",
      priority,
      createdAt: Date.now(),
    }

    // Insert based on priority
    const insertIndex = this.findInsertIndex(priority)
    this.queue.splice(insertIndex, 0, prompt)

    this.emit({ type: "added", prompt })
    return prompt
  }

  /**
   * Start executing the next prompt in the queue.
   * Only one prompt can execute at a time.
   *
   * @returns The prompt that started executing, or undefined if none available
   */
  startNext(): Prompt | undefined {
    // Check if any prompt is already executing
    if (this.hasExecuting()) {
      return undefined
    }

    // Find the first queued prompt
    const prompt = this.queue.find((p) => p.status === "queued")
    if (!prompt) {
      return undefined
    }

    prompt.status = "executing"
    prompt.startedAt = Date.now()

    this.emit({ type: "started", prompt })
    return prompt
  }

  /**
   * Complete the currently executing prompt.
   *
   * @returns The completed prompt, or undefined if none was executing
   */
  complete(): Prompt | undefined {
    const executing = this.queue.find((p) => p.status === "executing")
    if (!executing) {
      return undefined
    }

    executing.status = "completed"
    executing.completedAt = Date.now()

    // Remove completed prompt from queue
    this.queue = this.queue.filter((p) => p.id !== executing.id)

    this.emit({ type: "completed", prompt: executing })
    return executing
  }

  /**
   * Cancel a queued prompt.
   * Users can only cancel their own prompts.
   *
   * @param promptID - ID of the prompt to cancel
   * @param userID - ID of the user requesting cancellation
   * @returns true if cancelled, false otherwise
   */
  cancel(promptID: string, userID: string): boolean {
    const prompt = this.queue.find((p) => p.id === promptID)
    if (!prompt) {
      return false
    }

    // Can only cancel queued prompts (not executing)
    if (prompt.status !== "queued") {
      return false
    }

    // Users can only cancel their own prompts
    if (prompt.userID !== userID) {
      return false
    }

    prompt.status = "cancelled"
    this.queue = this.queue.filter((p) => p.id !== promptID)

    this.emit({ type: "cancelled", prompt })
    return true
  }

  /**
   * Reorder a prompt in the queue.
   * Users can only reorder their own prompts.
   * Cannot reorder executing prompts.
   *
   * @param promptID - ID of the prompt to move
   * @param userID - ID of the user requesting reorder
   * @param newIndex - New position in queue (0-based)
   * @returns true if reordered, false otherwise
   */
  reorder(promptID: string, userID: string, newIndex: number): boolean {
    if (!this.config.allowReorder) {
      return false
    }

    const currentIndex = this.queue.findIndex((p) => p.id === promptID)
    if (currentIndex === -1) {
      return false
    }

    const prompt = this.queue[currentIndex]

    // Can only reorder queued prompts
    if (prompt.status !== "queued") {
      return false
    }

    // Users can only reorder their own prompts
    if (prompt.userID !== userID) {
      return false
    }

    // Can't move before the executing prompt
    const executingIndex = this.queue.findIndex((p) => p.status === "executing")
    const minIndex = executingIndex === -1 ? 0 : executingIndex + 1

    // Clamp to valid range
    const targetIndex = Math.max(minIndex, Math.min(this.queue.length - 1, newIndex))

    if (currentIndex === targetIndex) {
      return false
    }

    // Remove and reinsert
    this.queue.splice(currentIndex, 1)
    this.queue.splice(targetIndex, 0, prompt)

    this.emit({ type: "reordered", prompt, from: currentIndex, to: targetIndex })
    return true
  }

  /**
   * Get the prompt at a specific position
   */
  at(index: number): Prompt | undefined {
    return this.queue[index]
  }

  /**
   * Get prompt by ID
   */
  get(promptID: string): Prompt | undefined {
    return this.queue.find((p) => p.id === promptID)
  }

  /**
   * Get all prompts in the queue
   */
  all(): Prompt[] {
    return [...this.queue]
  }

  /**
   * Get all queued (not executing/completed) prompts
   */
  queued(): Prompt[] {
    return this.queue.filter((p) => p.status === "queued")
  }

  /**
   * Get the currently executing prompt
   */
  executing(): Prompt | undefined {
    return this.queue.find((p) => p.status === "executing")
  }

  /**
   * Get prompts by user
   */
  byUser(userID: string): Prompt[] {
    return this.queue.filter((p) => p.userID === userID)
  }

  /**
   * Check if any prompt is currently executing
   */
  hasExecuting(): boolean {
    return this.queue.some((p) => p.status === "executing")
  }

  /**
   * Get queue length
   */
  get length(): number {
    return this.queue.length
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0
  }

  /**
   * Check if queue is full
   */
  isFull(): boolean {
    return this.queue.length >= this.config.maxPrompts
  }

  /**
   * Get position of a prompt in the queue
   */
  position(promptID: string): number {
    return this.queue.findIndex((p) => p.id === promptID)
  }

  /**
   * Find the insert index based on priority.
   * Higher priority prompts go before lower priority, but after
   * the executing prompt and other higher/equal priority prompts.
   */
  private findInsertIndex(priority: PromptPriority): number {
    const priorityOrder: Record<PromptPriority, number> = {
      urgent: 0,
      high: 1,
      normal: 2,
    }
    const targetPriority = priorityOrder[priority]

    // Find the position after all prompts with higher or equal priority
    for (let i = 0; i < this.queue.length; i++) {
      const prompt = this.queue[i]
      // Never insert before an executing prompt
      if (prompt.status === "executing") continue
      // Insert before lower priority prompts
      if (priorityOrder[prompt.priority] > targetPriority) {
        return i
      }
    }

    return this.queue.length
  }

  /**
   * Subscribe to queue events
   */
  subscribe(listener: (event: QueueEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: QueueEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Clear all prompts from the queue
   */
  clear(): void {
    this.queue = []
    this.emit({ type: "cleared" })
  }
}

/**
 * Events emitted by the queue
 */
export type QueueEvent =
  | { type: "added"; prompt: Prompt }
  | { type: "started"; prompt: Prompt }
  | { type: "completed"; prompt: Prompt }
  | { type: "cancelled"; prompt: Prompt }
  | { type: "reordered"; prompt: Prompt; from: number; to: number }
  | { type: "cleared" }

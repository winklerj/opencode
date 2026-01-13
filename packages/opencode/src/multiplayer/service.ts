import { Instance } from "../project/instance"
import { SessionManager, type SessionManagerConfig } from "@opencode-ai/multiplayer"
import type { Multiplayer } from "@opencode-ai/multiplayer"
import { PromptQueue, type Prompt, type PromptPriority } from "@opencode-ai/background"

/**
 * MultiplayerService provides a singleton SessionManager for the project.
 *
 * This service manages multiplayer sessions for real-time collaboration,
 * ensuring a single session manager instance is shared across all API routes.
 */
export namespace MultiplayerService {
  /**
   * Default configuration for the session manager
   */
  const defaultConfig: SessionManagerConfig = {
    maxUsersPerSession: 10,
    maxClientsPerUser: 5,
    lockTimeout: 300000, // 5 minutes
  }

  /**
   * Get the session manager singleton for the current project
   */
  export const getManager = Instance.state(async () => {
    const manager = new SessionManager(defaultConfig)
    return manager
  })

  /**
   * Create a new multiplayer session
   */
  export async function create(input: Multiplayer.CreateInput): Promise<Multiplayer.Session> {
    const manager = await getManager()
    return manager.create(input)
  }

  /**
   * Get a session by ID
   */
  export async function get(sessionID: string): Promise<Multiplayer.Session | undefined> {
    const manager = await getManager()
    return manager.get(sessionID)
  }

  /**
   * Get all sessions
   */
  export async function all(): Promise<Multiplayer.Session[]> {
    const manager = await getManager()
    return manager.all()
  }

  /**
   * Delete a session
   */
  export async function remove(sessionID: string): Promise<boolean> {
    const manager = await getManager()
    return manager.delete(sessionID)
  }

  /**
   * Join a session
   */
  export async function join(
    sessionID: string,
    input: Multiplayer.JoinInput,
  ): Promise<Multiplayer.User | null> {
    const manager = await getManager()
    return manager.join(sessionID, input)
  }

  /**
   * Leave a session
   */
  export async function leave(sessionID: string, userID: string): Promise<boolean> {
    const manager = await getManager()
    return manager.leave(sessionID, userID)
  }

  /**
   * Connect a client
   */
  export async function connect(
    sessionID: string,
    input: Multiplayer.ConnectInput,
  ): Promise<Multiplayer.Client | null> {
    const manager = await getManager()
    return manager.connect(sessionID, input)
  }

  /**
   * Disconnect a client
   */
  export async function disconnect(sessionID: string, clientID: string): Promise<boolean> {
    const manager = await getManager()
    return manager.disconnect(sessionID, clientID)
  }

  /**
   * Update cursor position
   */
  export async function updateCursor(
    sessionID: string,
    userID: string,
    cursor: Multiplayer.Cursor,
  ): Promise<boolean> {
    const manager = await getManager()
    return manager.updateCursor(sessionID, userID, cursor)
  }

  /**
   * Acquire edit lock
   */
  export async function acquireLock(sessionID: string, userID: string): Promise<boolean> {
    const manager = await getManager()
    return manager.acquireLock(sessionID, userID)
  }

  /**
   * Release edit lock
   */
  export async function releaseLock(sessionID: string, userID: string): Promise<boolean> {
    const manager = await getManager()
    return manager.releaseLock(sessionID, userID)
  }

  /**
   * Check if user can edit
   */
  export async function canEdit(sessionID: string, userID: string): Promise<boolean> {
    const manager = await getManager()
    return manager.canEdit(sessionID, userID)
  }

  /**
   * Get users in a session
   */
  export async function getUsers(sessionID: string): Promise<Multiplayer.User[]> {
    const manager = await getManager()
    return manager.getUsers(sessionID)
  }

  /**
   * Get clients in a session
   */
  export async function getClients(sessionID: string): Promise<Multiplayer.Client[]> {
    const manager = await getManager()
    return manager.getClients(sessionID)
  }

  /**
   * Update session state
   */
  export async function updateState(
    sessionID: string,
    updates: Partial<Omit<Multiplayer.SessionState, "version">>,
  ): Promise<boolean> {
    const manager = await getManager()
    return manager.updateState(sessionID, updates)
  }

  /**
   * Subscribe to session events
   */
  export async function subscribe(
    listener: (event: import("@opencode-ai/multiplayer").MultiplayerEvent) => void,
  ): Promise<() => void> {
    const manager = await getManager()
    return manager.subscribe(listener)
  }

  // ============================================
  // Prompt Queue Management
  // ============================================

  /**
   * Map of session ID to PromptQueue instance
   */
  const promptQueues = new Map<string, PromptQueue>()

  /**
   * Get or create a prompt queue for a session
   */
  function getQueue(sessionID: string): PromptQueue {
    let queue = promptQueues.get(sessionID)
    if (!queue) {
      queue = new PromptQueue(sessionID, {
        maxPrompts: 100,
        allowReorder: true,
      })
      promptQueues.set(sessionID, queue)
    }
    return queue
  }

  /**
   * Add a prompt to the session queue
   */
  export async function addPrompt(
    sessionID: string,
    userID: string,
    content: string,
    priority?: PromptPriority,
  ): Promise<Prompt | null> {
    const session = await get(sessionID)
    if (!session) return null

    // Check if user is in session
    const users = await getUsers(sessionID)
    if (!users.some((u) => u.id === userID)) return null

    const queue = getQueue(sessionID)
    try {
      return queue.add(userID, content, priority)
    } catch {
      return null
    }
  }

  /**
   * Get all prompts in the session queue
   */
  export async function getPrompts(sessionID: string): Promise<Prompt[]> {
    const session = await get(sessionID)
    if (!session) return []

    return getQueue(sessionID).all()
  }

  /**
   * Get a specific prompt by ID
   */
  export async function getPrompt(sessionID: string, promptID: string): Promise<Prompt | undefined> {
    const session = await get(sessionID)
    if (!session) return undefined

    return getQueue(sessionID).get(promptID)
  }

  /**
   * Cancel a prompt in the queue
   */
  export async function cancelPrompt(
    sessionID: string,
    promptID: string,
    userID: string,
  ): Promise<boolean> {
    const session = await get(sessionID)
    if (!session) return false

    return getQueue(sessionID).cancel(promptID, userID)
  }

  /**
   * Reorder a prompt in the queue
   */
  export async function reorderPrompt(
    sessionID: string,
    promptID: string,
    userID: string,
    newIndex: number,
  ): Promise<boolean> {
    const session = await get(sessionID)
    if (!session) return false

    return getQueue(sessionID).reorder(promptID, userID, newIndex)
  }

  /**
   * Start executing the next prompt in the queue
   */
  export async function startNextPrompt(sessionID: string): Promise<Prompt | undefined> {
    const session = await get(sessionID)
    if (!session) return undefined

    return getQueue(sessionID).startNext()
  }

  /**
   * Complete the currently executing prompt
   */
  export async function completePrompt(sessionID: string): Promise<Prompt | undefined> {
    const session = await get(sessionID)
    if (!session) return undefined

    return getQueue(sessionID).complete()
  }

  /**
   * Get the currently executing prompt
   */
  export async function getExecutingPrompt(sessionID: string): Promise<Prompt | undefined> {
    const session = await get(sessionID)
    if (!session) return undefined

    return getQueue(sessionID).executing()
  }

  /**
   * Get queue status
   */
  export async function getQueueStatus(sessionID: string): Promise<{
    length: number
    hasExecuting: boolean
    isFull: boolean
  } | null> {
    const session = await get(sessionID)
    if (!session) return null

    const queue = getQueue(sessionID)
    return {
      length: queue.length,
      hasExecuting: queue.hasExecuting(),
      isFull: queue.isFull(),
    }
  }

  /**
   * Clean up prompt queue when session is deleted
   */
  export function cleanupQueue(sessionID: string): void {
    promptQueues.delete(sessionID)
  }
}

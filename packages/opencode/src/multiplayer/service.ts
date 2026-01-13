import { Instance } from "../project/instance"
import { SessionManager, type SessionManagerConfig } from "@opencode-ai/multiplayer"
import type { Multiplayer } from "@opencode-ai/multiplayer"

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
}

import { z } from "zod"
import { Multiplayer, type MultiplayerEvent } from "./types"

/**
 * Configuration for the session manager
 */
export const SessionManagerConfig = z.object({
  maxUsersPerSession: z.number().default(10),
  maxClientsPerUser: z.number().default(5),
  lockTimeout: z.number().default(300000), // 5 minutes
})
export type SessionManagerConfig = z.input<typeof SessionManagerConfig>

/**
 * Generate a random hex color for user cursors
 */
function generateColor(): string {
  const colors = [
    "#3B82F6", // blue
    "#10B981", // green
    "#F59E0B", // amber
    "#EF4444", // red
    "#8B5CF6", // violet
    "#EC4899", // pink
    "#06B6D4", // cyan
    "#F97316", // orange
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

/**
 * SessionManager manages multiplayer sessions for real-time collaboration.
 *
 * Key behaviors from TLA+ specification:
 * - Users join and leave sessions
 * - Clients connect and disconnect
 * - Edit locks ensure single writer
 * - State versioning for optimistic locking
 *
 * Invariants:
 * - SingleEditLockHolder: Edit lock held by at most one user
 * - ValidSessionUsers: Users must be in the session
 * - ValidClientTypes: Clients have valid types
 */
export class SessionManager {
  private sessions = new Map<string, Multiplayer.Session>()
  private config: z.output<typeof SessionManagerConfig>
  private idCounter = 0
  private listeners: Set<(event: MultiplayerEvent) => void> = new Set()

  constructor(config: SessionManagerConfig = {}) {
    this.config = SessionManagerConfig.parse(config)
  }

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${++this.idCounter}`
  }

  /**
   * Create a new multiplayer session.
   *
   * @param input - Session creation input
   * @returns The created session
   */
  create(input: Multiplayer.CreateInput): Multiplayer.Session {
    const parsed = Multiplayer.CreateInput.parse(input)

    const session: Multiplayer.Session = {
      id: this.generateId("mp"),
      sessionID: parsed.sessionID,
      sandboxID: parsed.sandboxID,
      users: [],
      clients: [],
      promptQueue: [],
      state: {
        gitSyncStatus: "pending",
        agentStatus: "idle",
        version: 0,
      },
      createdAt: Date.now(),
    }

    this.sessions.set(session.id, session)
    this.emit({ type: "session.created", session })
    return session
  }

  /**
   * User joins a session.
   * Implements TLA+ UserJoinSession action.
   *
   * @param sessionID - Session to join
   * @param input - User information
   * @returns The joined user, or null if failed
   */
  join(sessionID: string, input: Multiplayer.JoinInput): Multiplayer.User | null {
    const session = this.sessions.get(sessionID)
    if (!session) {
      return null
    }

    const parsed = Multiplayer.JoinInput.parse(input)

    // Check if user already in session
    if (session.users.some((u) => u.id === parsed.userID)) {
      return session.users.find((u) => u.id === parsed.userID) || null
    }

    // Check max users
    if (session.users.length >= this.config.maxUsersPerSession) {
      return null
    }

    const user: Multiplayer.User = {
      id: parsed.userID,
      name: parsed.name,
      email: parsed.email,
      avatar: parsed.avatar,
      color: parsed.color || generateColor(),
      joinedAt: Date.now(),
    }

    session.users.push(user)
    this.incrementVersion(session)
    this.emit({ type: "user.joined", sessionID, user })

    return user
  }

  /**
   * User leaves a session.
   * Implements TLA+ UserLeaveSession action.
   *
   * @param sessionID - Session to leave
   * @param userID - User leaving
   * @returns true if user left
   */
  leave(sessionID: string, userID: string): boolean {
    const session = this.sessions.get(sessionID)
    if (!session) {
      return false
    }

    const userIndex = session.users.findIndex((u) => u.id === userID)
    if (userIndex === -1) {
      return false
    }

    // Remove user
    session.users.splice(userIndex, 1)

    // Remove user's clients
    session.clients = session.clients.filter((c) => c.userID !== userID)

    // Release edit lock if held by this user
    if (session.state.editLock === userID) {
      session.state.editLock = undefined
      this.emit({ type: "lock.released", sessionID, userID })
    }

    this.incrementVersion(session)
    this.emit({ type: "user.left", sessionID, userID })

    return true
  }

  /**
   * Client connects to a session.
   * Implements TLA+ ClientConnect action.
   *
   * @param sessionID - Session to connect to
   * @param input - Client information
   * @returns The connected client, or null if failed
   */
  connect(sessionID: string, input: Multiplayer.ConnectInput): Multiplayer.Client | null {
    const session = this.sessions.get(sessionID)
    if (!session) {
      return null
    }

    const parsed = Multiplayer.ConnectInput.parse(input)

    // Check if user is in session
    if (!session.users.some((u) => u.id === parsed.userID)) {
      return null
    }

    // Check max clients per user
    const userClients = session.clients.filter((c) => c.userID === parsed.userID)
    if (userClients.length >= this.config.maxClientsPerUser) {
      return null
    }

    const client: Multiplayer.Client = {
      id: this.generateId("client"),
      userID: parsed.userID,
      type: parsed.type,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    }

    session.clients.push(client)
    this.incrementVersion(session)
    this.emit({ type: "client.connected", sessionID, client })

    return client
  }

  /**
   * Client disconnects from a session.
   * Implements TLA+ ClientDisconnect action.
   *
   * @param sessionID - Session to disconnect from
   * @param clientID - Client disconnecting
   * @returns true if client disconnected
   */
  disconnect(sessionID: string, clientID: string): boolean {
    const session = this.sessions.get(sessionID)
    if (!session) {
      return false
    }

    const clientIndex = session.clients.findIndex((c) => c.id === clientID)
    if (clientIndex === -1) {
      return false
    }

    session.clients.splice(clientIndex, 1)
    this.incrementVersion(session)
    this.emit({ type: "client.disconnected", sessionID, clientID })

    return true
  }

  /**
   * Update user's cursor position.
   *
   * @param sessionID - Session ID
   * @param userID - User ID
   * @param cursor - New cursor position
   * @returns true if updated
   */
  updateCursor(sessionID: string, userID: string, cursor: Multiplayer.Cursor): boolean {
    const session = this.sessions.get(sessionID)
    if (!session) {
      return false
    }

    const user = session.users.find((u) => u.id === userID)
    if (!user) {
      return false
    }

    user.cursor = cursor
    this.emit({ type: "cursor.moved", sessionID, userID, cursor })

    return true
  }

  /**
   * Acquire edit lock.
   * Implements TLA+ AcquireEditLock action.
   *
   * @param sessionID - Session ID
   * @param userID - User requesting lock
   * @returns true if lock acquired
   */
  acquireLock(sessionID: string, userID: string): boolean {
    const session = this.sessions.get(sessionID)
    if (!session) {
      return false
    }

    // Check if user is in session
    if (!session.users.some((u) => u.id === userID)) {
      return false
    }

    // Check if lock already held
    if (session.state.editLock !== undefined) {
      return false
    }

    session.state.editLock = userID
    this.incrementVersion(session)
    this.emit({ type: "lock.acquired", sessionID, userID })

    return true
  }

  /**
   * Release edit lock.
   * Implements TLA+ ReleaseEditLock action.
   *
   * @param sessionID - Session ID
   * @param userID - User releasing lock
   * @returns true if lock released
   */
  releaseLock(sessionID: string, userID: string): boolean {
    const session = this.sessions.get(sessionID)
    if (!session) {
      return false
    }

    // Only holder can release
    if (session.state.editLock !== userID) {
      return false
    }

    session.state.editLock = undefined
    this.incrementVersion(session)
    this.emit({ type: "lock.released", sessionID, userID })

    return true
  }

  /**
   * Check if user can edit (has lock or no lock exists).
   * Implements TLA+ CanEdit helper.
   *
   * @param sessionID - Session ID
   * @param userID - User to check
   * @returns true if user can edit
   */
  canEdit(sessionID: string, userID: string): boolean {
    const session = this.sessions.get(sessionID)
    if (!session) {
      return false
    }

    return session.state.editLock === undefined || session.state.editLock === userID
  }

  /**
   * Update session state.
   *
   * @param sessionID - Session ID
   * @param updates - Partial state updates
   * @returns true if updated
   */
  updateState(
    sessionID: string,
    updates: Partial<Omit<Multiplayer.SessionState, "version">>,
  ): boolean {
    const session = this.sessions.get(sessionID)
    if (!session) {
      return false
    }

    Object.assign(session.state, updates)
    this.incrementVersion(session)
    this.emit({ type: "state.changed", sessionID, state: session.state })

    return true
  }

  /**
   * Set sandbox ID for session.
   *
   * @param sessionID - Session ID
   * @param sandboxID - Sandbox ID
   * @returns true if updated
   */
  setSandbox(sessionID: string, sandboxID: string): boolean {
    const session = this.sessions.get(sessionID)
    if (!session) {
      return false
    }

    session.sandboxID = sandboxID
    this.incrementVersion(session)

    return true
  }

  /**
   * Get a session by ID
   */
  get(sessionID: string): Multiplayer.Session | undefined {
    return this.sessions.get(sessionID)
  }

  /**
   * Get all sessions
   */
  all(): Multiplayer.Session[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Get users in a session
   */
  getUsers(sessionID: string): Multiplayer.User[] {
    const session = this.sessions.get(sessionID)
    return session?.users || []
  }

  /**
   * Get clients in a session
   */
  getClients(sessionID: string): Multiplayer.Client[] {
    const session = this.sessions.get(sessionID)
    return session?.clients || []
  }

  /**
   * Get user by ID from a session
   */
  getUser(sessionID: string, userID: string): Multiplayer.User | undefined {
    const session = this.sessions.get(sessionID)
    return session?.users.find((u) => u.id === userID)
  }

  /**
   * Get session count
   */
  get count(): number {
    return this.sessions.size
  }

  /**
   * Delete a session
   */
  delete(sessionID: string): boolean {
    return this.sessions.delete(sessionID)
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.sessions.clear()
  }

  /**
   * Subscribe to events
   */
  subscribe(listener: (event: MultiplayerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Emit an event
   */
  private emit(event: MultiplayerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Increment session state version
   */
  private incrementVersion(session: Multiplayer.Session): void {
    session.state.version++
  }
}

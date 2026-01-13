import { z } from "zod"

/**
 * Multiplayer namespace contains all types for real-time collaboration.
 *
 * Based on TLA+ specification from HostedAgent.tla:
 * - Session users and presence
 * - Edit locks for single writer guarantee
 * - Client sync state for multi-client coordination
 */
export namespace Multiplayer {
  /**
   * Client types that can connect to a session
   */
  export const ClientType = z.enum(["web", "slack", "chrome", "mobile", "voice"])
  export type ClientType = z.infer<typeof ClientType>

  /**
   * Cursor position in a file
   */
  export const Cursor = z.object({
    file: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
  })
  export type Cursor = z.infer<typeof Cursor>

  /**
   * User in a multiplayer session
   */
  export const User = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().optional(),
    avatar: z.string().optional(),
    color: z.string(), // For cursor/highlight color
    cursor: Cursor.optional(),
    joinedAt: z.number(),
  })
  export type User = z.infer<typeof User>

  /**
   * Connected client record
   * Matches TLA+ ClientRecord
   */
  export const Client = z.object({
    id: z.string(),
    userID: z.string(),
    type: ClientType,
    connectedAt: z.number(),
    lastActivity: z.number(),
  })
  export type Client = z.infer<typeof Client>

  /**
   * Agent status in the session
   */
  export const AgentStatus = z.enum(["idle", "thinking", "executing"])
  export type AgentStatus = z.infer<typeof AgentStatus>

  /**
   * Git sync status
   */
  export const GitSyncStatus = z.enum(["pending", "syncing", "synced", "error"])
  export type GitSyncStatus = z.infer<typeof GitSyncStatus>

  /**
   * Session state for real-time sync
   */
  export const SessionState = z.object({
    gitSyncStatus: GitSyncStatus,
    agentStatus: AgentStatus,
    editLock: z.string().optional(), // userID holding lock
    version: z.number(), // For optimistic locking
  })
  export type SessionState = z.infer<typeof SessionState>

  /**
   * Active prompt being executed
   */
  export const ActivePrompt = z.object({
    id: z.string(),
    userID: z.string(),
    content: z.string(),
    startedAt: z.number(),
  })
  export type ActivePrompt = z.infer<typeof ActivePrompt>

  /**
   * Queued prompt waiting for execution
   */
  export const QueuedPrompt = z.object({
    id: z.string(),
    userID: z.string(),
    content: z.string(),
    queuedAt: z.number(),
    priority: z.number(),
  })
  export type QueuedPrompt = z.infer<typeof QueuedPrompt>

  /**
   * Complete multiplayer session information
   */
  export const Session = z.object({
    id: z.string(),
    sessionID: z.string(), // OpenCode session
    sandboxID: z.string().optional(),
    users: z.array(User),
    clients: z.array(Client),
    activePrompt: ActivePrompt.optional(),
    promptQueue: z.array(QueuedPrompt),
    state: SessionState,
    createdAt: z.number(),
  })
  export type Session = z.infer<typeof Session>

  /**
   * Input for creating a new multiplayer session
   */
  export const CreateInput = z.object({
    sessionID: z.string(),
    sandboxID: z.string().optional(),
  })
  export type CreateInput = z.input<typeof CreateInput>

  /**
   * Input for user joining a session
   */
  export const JoinInput = z.object({
    userID: z.string(),
    name: z.string(),
    email: z.string().optional(),
    avatar: z.string().optional(),
    color: z.string().optional(),
  })
  export type JoinInput = z.input<typeof JoinInput>

  /**
   * Input for client connecting
   */
  export const ConnectInput = z.object({
    userID: z.string(),
    type: ClientType,
  })
  export type ConnectInput = z.input<typeof ConnectInput>
}

/**
 * Events emitted by the multiplayer system
 */
export type MultiplayerEvent =
  | { type: "session.created"; session: Multiplayer.Session }
  | { type: "user.joined"; sessionID: string; user: Multiplayer.User }
  | { type: "user.left"; sessionID: string; userID: string }
  | { type: "client.connected"; sessionID: string; client: Multiplayer.Client }
  | { type: "client.disconnected"; sessionID: string; clientID: string }
  | { type: "cursor.moved"; sessionID: string; userID: string; cursor: Multiplayer.Cursor }
  | { type: "lock.acquired"; sessionID: string; userID: string }
  | { type: "lock.released"; sessionID: string; userID: string }
  | { type: "state.changed"; sessionID: string; state: Multiplayer.SessionState }

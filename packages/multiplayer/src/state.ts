import { z } from "zod"
import type { Multiplayer, MultiplayerEvent } from "./types"

/**
 * State store interface for multiplayer session persistence.
 *
 * Implementations:
 * - MemoryStateStore: In-memory storage (default, for testing/local)
 * - SQLiteStateStore: SQLite-backed persistent storage
 * - DurableObjectState: Cloudflare Durable Objects (production)
 */
export interface StateStore {
  /** Get a session by ID */
  get(sessionID: string): Promise<Multiplayer.Session | undefined>

  /** Get all sessions */
  all(): Promise<Multiplayer.Session[]>

  /** Save or update a session */
  set(session: Multiplayer.Session): Promise<void>

  /** Delete a session */
  delete(sessionID: string): Promise<boolean>

  /** Check if a session exists */
  has(sessionID: string): Promise<boolean>

  /** Get total session count */
  count(): Promise<number>

  /** Clear all sessions (for testing) */
  clear(): Promise<void>

  /** Close the store and release resources */
  close(): Promise<void>
}

/**
 * In-memory state store for testing and local development.
 */
export class MemoryStateStore implements StateStore {
  private sessions = new Map<string, Multiplayer.Session>()

  async get(sessionID: string): Promise<Multiplayer.Session | undefined> {
    return this.sessions.get(sessionID)
  }

  async all(): Promise<Multiplayer.Session[]> {
    return Array.from(this.sessions.values())
  }

  async set(session: Multiplayer.Session): Promise<void> {
    this.sessions.set(session.id, session)
  }

  async delete(sessionID: string): Promise<boolean> {
    return this.sessions.delete(sessionID)
  }

  async has(sessionID: string): Promise<boolean> {
    return this.sessions.has(sessionID)
  }

  async count(): Promise<number> {
    return this.sessions.size
  }

  async clear(): Promise<void> {
    this.sessions.clear()
  }

  async close(): Promise<void> {
    // No-op for memory store
  }
}

/**
 * Configuration for SQLite state store
 */
export const SQLiteStateStoreConfig = z.object({
  /** Database file path. Use ":memory:" for in-memory SQLite. */
  path: z.string().default(":memory:"),
  /** Enable WAL mode for better concurrency */
  walMode: z.boolean().default(true),
  /** Sync mode: "off" for speed, "normal" for safety, "full" for durability */
  syncMode: z.enum(["off", "normal", "full"]).default("normal"),
})
export type SQLiteStateStoreConfig = z.input<typeof SQLiteStateStoreConfig>

/**
 * SQLite-backed state store for persistent session storage.
 *
 * Uses Bun's native SQLite support for high performance.
 * Tables:
 * - sessions: Core session data (id, sessionID, sandboxID, createdAt, state JSON)
 * - users: Session users with cursor positions
 * - clients: Connected clients per session
 * - prompt_queue: Queued prompts per session
 */
export class SQLiteStateStore implements StateStore {
  private db: import("bun:sqlite").Database | null = null
  private config: z.output<typeof SQLiteStateStoreConfig>
  private initialized = false

  constructor(config: SQLiteStateStoreConfig = {}) {
    this.config = SQLiteStateStoreConfig.parse(config)
  }

  /**
   * Initialize the database and create tables
   */
  private async init(): Promise<void> {
    if (this.initialized) return

    // Dynamic import to support environments without bun:sqlite
    const { Database } = await import("bun:sqlite")
    this.db = new Database(this.config.path)

    // Configure SQLite for performance
    if (this.config.walMode && this.config.path !== ":memory:") {
      this.db.run("PRAGMA journal_mode = WAL")
    }
    this.db.run(`PRAGMA synchronous = ${this.config.syncMode}`)

    // Create tables
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sandbox_id TEXT,
        state_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)`)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS session_users (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        avatar TEXT,
        color TEXT NOT NULL,
        cursor_json TEXT,
        joined_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `)

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_session ON session_users(session_id)`)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS session_clients (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        connected_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `)

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_clients_session ON session_clients(session_id)`)

    this.db.run(`
      CREATE TABLE IF NOT EXISTS session_prompts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        queued_at INTEGER NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `)

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_prompts_session ON session_prompts(session_id)`)

    this.initialized = true
  }

  async get(sessionID: string): Promise<Multiplayer.Session | undefined> {
    await this.init()
    if (!this.db) return undefined

    // Get session base data
    const row = this.db
      .query<
        {
          id: string
          session_id: string
          sandbox_id: string | null
          state_json: string
          created_at: number
        },
        [string]
      >("SELECT * FROM sessions WHERE id = ?")
      .get(sessionID)

    if (!row) return undefined

    // Get users
    const users = this.db
      .query<
        {
          id: string
          name: string
          email: string | null
          avatar: string | null
          color: string
          cursor_json: string | null
          joined_at: number
        },
        [string]
      >("SELECT * FROM session_users WHERE session_id = ? ORDER BY joined_at")
      .all(sessionID)

    // Get clients
    const clients = this.db
      .query<
        {
          id: string
          user_id: string
          type: string
          connected_at: number
          last_activity: number
        },
        [string]
      >("SELECT * FROM session_clients WHERE session_id = ? ORDER BY connected_at")
      .all(sessionID)

    // Get prompt queue
    const prompts = this.db
      .query<
        {
          id: string
          user_id: string
          content: string
          queued_at: number
          priority: number
        },
        [string]
      >("SELECT * FROM session_prompts WHERE session_id = ? ORDER BY priority DESC, queued_at")
      .all(sessionID)

    const state = JSON.parse(row.state_json)

    return {
      id: row.id,
      sessionID: row.session_id,
      sandboxID: row.sandbox_id ?? undefined,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email ?? undefined,
        avatar: u.avatar ?? undefined,
        color: u.color,
        cursor: u.cursor_json ? JSON.parse(u.cursor_json) : undefined,
        joinedAt: u.joined_at,
      })),
      clients: clients.map((c) => ({
        id: c.id,
        userID: c.user_id,
        type: c.type as Multiplayer.ClientType,
        connectedAt: c.connected_at,
        lastActivity: c.last_activity,
      })),
      promptQueue: prompts.map((p) => ({
        id: p.id,
        userID: p.user_id,
        content: p.content,
        queuedAt: p.queued_at,
        priority: p.priority,
      })),
      state,
      createdAt: row.created_at,
    }
  }

  async all(): Promise<Multiplayer.Session[]> {
    await this.init()
    if (!this.db) return []

    const rows = this.db
      .query<{ id: string }, []>("SELECT id FROM sessions ORDER BY created_at DESC")
      .all()

    const sessions: Multiplayer.Session[] = []
    for (const row of rows) {
      const session = await this.get(row.id)
      if (session) sessions.push(session)
    }
    return sessions
  }

  async set(session: Multiplayer.Session): Promise<void> {
    await this.init()
    if (!this.db) return

    const now = Date.now()

    // Use a transaction for atomicity
    this.db.run("BEGIN TRANSACTION")

    try {
      // Upsert session
      this.db
        .query(
          `INSERT OR REPLACE INTO sessions (id, session_id, sandbox_id, state_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          session.id,
          session.sessionID,
          session.sandboxID ?? null,
          JSON.stringify(session.state),
          session.createdAt,
          now,
        )

      // Delete and re-insert users
      this.db.query("DELETE FROM session_users WHERE session_id = ?").run(session.id)
      const insertUser = this.db.query(
        `INSERT INTO session_users (id, session_id, name, email, avatar, color, cursor_json, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const user of session.users) {
        insertUser.run(
          user.id,
          session.id,
          user.name,
          user.email ?? null,
          user.avatar ?? null,
          user.color,
          user.cursor ? JSON.stringify(user.cursor) : null,
          user.joinedAt,
        )
      }

      // Delete and re-insert clients
      this.db.query("DELETE FROM session_clients WHERE session_id = ?").run(session.id)
      const insertClient = this.db.query(
        `INSERT INTO session_clients (id, session_id, user_id, type, connected_at, last_activity)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      for (const client of session.clients) {
        insertClient.run(
          client.id,
          session.id,
          client.userID,
          client.type,
          client.connectedAt,
          client.lastActivity,
        )
      }

      // Delete and re-insert prompt queue
      this.db.query("DELETE FROM session_prompts WHERE session_id = ?").run(session.id)
      const insertPrompt = this.db.query(
        `INSERT INTO session_prompts (id, session_id, user_id, content, queued_at, priority)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      for (const prompt of session.promptQueue) {
        insertPrompt.run(
          prompt.id,
          session.id,
          prompt.userID,
          prompt.content,
          prompt.queuedAt,
          prompt.priority,
        )
      }

      this.db.run("COMMIT")
    } catch (err) {
      this.db.run("ROLLBACK")
      throw err
    }
  }

  async delete(sessionID: string): Promise<boolean> {
    await this.init()
    if (!this.db) return false

    const result = this.db.query("DELETE FROM sessions WHERE id = ?").run(sessionID)
    return result.changes > 0
  }

  async has(sessionID: string): Promise<boolean> {
    await this.init()
    if (!this.db) return false

    const row = this.db
      .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM sessions WHERE id = ?")
      .get(sessionID)

    return (row?.count ?? 0) > 0
  }

  async count(): Promise<number> {
    await this.init()
    if (!this.db) return 0

    const row = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM sessions")
      .get()

    return row?.count ?? 0
  }

  async clear(): Promise<void> {
    await this.init()
    if (!this.db) return

    this.db.run("DELETE FROM sessions")
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initialized = false
    }
  }

  /**
   * Get the underlying database (for testing)
   */
  getDatabase(): import("bun:sqlite").Database | null {
    return this.db
  }
}

/**
 * Create a state store based on configuration
 */
export function createStateStore(
  type: "memory" | "sqlite",
  config?: SQLiteStateStoreConfig,
): StateStore {
  switch (type) {
    case "sqlite":
      return new SQLiteStateStore(config)
    case "memory":
    default:
      return new MemoryStateStore()
  }
}

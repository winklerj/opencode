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

/**
 * Cloudflare Durable Object environment types
 */
export interface DurableObjectEnv {
  MULTIPLAYER_DO: DurableObjectNamespace
}

/**
 * Cloudflare Durable Object namespace interface
 */
export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

export interface DurableObjectId {
  toString(): string
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

/**
 * Cloudflare Durable Object state interface
 */
export interface DurableObjectState {
  storage: DurableObjectStorage
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
  id: DurableObjectId
}

export interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>
  get<T>(keys: string[]): Promise<Map<string, T>>
  put<T>(key: string, value: T): Promise<void>
  put<T>(entries: Record<string, T>): Promise<void>
  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>
  deleteAll(): Promise<void>
  sql: SqlStorage
}

export interface SqlStorage {
  /** Execute a SQL statement. Note: This is Cloudflare DO's SQL API, not shell execution. */
  run(query: string, ...bindings: unknown[]): SqlStorageCursor
}

export interface SqlStorageCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[][]
}

/**
 * Configuration for Durable Object state store
 */
export const DurableObjectStateStoreConfig = z.object({
  /** Name for the Durable Object (used to derive the ID) */
  name: z.string().default("multiplayer-sessions"),
  /** Use SQL storage (Durable Objects v2) vs KV storage */
  useSqlStorage: z.boolean().default(true),
})
export type DurableObjectStateStoreConfig = z.input<typeof DurableObjectStateStoreConfig>

/**
 * Cloudflare Durable Object state store for production session persistence.
 *
 * This store runs inside a Cloudflare Durable Object and provides:
 * - Strong consistency guarantees
 * - Global distribution with automatic routing
 * - Persistent storage with automatic replication
 * - Support for both KV and SQL storage modes
 *
 * Usage:
 * 1. Deploy as a Durable Object class
 * 2. Create instance with DurableObjectState from constructor
 * 3. Use storage.sql for SQLite-style queries (DO v2)
 *
 * Note: This class is designed to be instantiated inside a Durable Object.
 * For external access, use DurableObjectStateStoreClient.
 */
export class DurableObjectStateStore implements StateStore {
  private state: DurableObjectState
  private config: z.output<typeof DurableObjectStateStoreConfig>
  private initialized = false

  constructor(state: DurableObjectState, config: DurableObjectStateStoreConfig = {}) {
    this.state = state
    this.config = DurableObjectStateStoreConfig.parse(config)
  }

  /**
   * Initialize the storage schema (for SQL mode)
   */
  private async init(): Promise<void> {
    if (this.initialized) return

    if (this.config.useSqlStorage) {
      // Use blockConcurrencyWhile to ensure initialization happens atomically
      await this.state.blockConcurrencyWhile(async () => {
        // Create tables using DO SQL storage
        this.state.storage.sql.run(`
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            sandbox_id TEXT,
            state_json TEXT NOT NULL,
            users_json TEXT NOT NULL,
            clients_json TEXT NOT NULL,
            prompt_queue_json TEXT NOT NULL,
            active_prompt_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `)

        this.state.storage.sql.run(`
          CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)
        `)
      })
    }

    this.initialized = true
  }

  async get(sessionID: string): Promise<Multiplayer.Session | undefined> {
    if (this.config.useSqlStorage) {
      await this.init()
      const rows = this.state.storage.sql
        .run("SELECT * FROM sessions WHERE id = ?", sessionID)
        .toArray() as Array<{
        id: string
        session_id: string
        sandbox_id: string | null
        state_json: string
        users_json: string
        clients_json: string
        prompt_queue_json: string
        active_prompt_json: string | null
        created_at: number
        updated_at: number
      }>

      if (rows.length === 0) return undefined

      const row = rows[0]
      return {
        id: row.id,
        sessionID: row.session_id,
        sandboxID: row.sandbox_id ?? undefined,
        state: JSON.parse(row.state_json),
        users: JSON.parse(row.users_json),
        clients: JSON.parse(row.clients_json),
        promptQueue: JSON.parse(row.prompt_queue_json),
        activePrompt: row.active_prompt_json ? JSON.parse(row.active_prompt_json) : undefined,
        createdAt: row.created_at,
      }
    }

    // KV storage fallback
    return this.state.storage.get<Multiplayer.Session>(`session:${sessionID}`)
  }

  async all(): Promise<Multiplayer.Session[]> {
    if (this.config.useSqlStorage) {
      await this.init()
      const rows = this.state.storage.sql
        .run("SELECT * FROM sessions ORDER BY created_at DESC")
        .toArray() as Array<{
        id: string
        session_id: string
        sandbox_id: string | null
        state_json: string
        users_json: string
        clients_json: string
        prompt_queue_json: string
        active_prompt_json: string | null
        created_at: number
        updated_at: number
      }>

      return rows.map((row) => ({
        id: row.id,
        sessionID: row.session_id,
        sandboxID: row.sandbox_id ?? undefined,
        state: JSON.parse(row.state_json),
        users: JSON.parse(row.users_json),
        clients: JSON.parse(row.clients_json),
        promptQueue: JSON.parse(row.prompt_queue_json),
        activePrompt: row.active_prompt_json ? JSON.parse(row.active_prompt_json) : undefined,
        createdAt: row.created_at,
      }))
    }

    // KV storage fallback
    const map = await this.state.storage.list<Multiplayer.Session>({ prefix: "session:" })
    return Array.from(map.values())
  }

  async set(session: Multiplayer.Session): Promise<void> {
    const now = Date.now()

    if (this.config.useSqlStorage) {
      await this.init()
      this.state.storage.sql.run(
        `INSERT OR REPLACE INTO sessions
         (id, session_id, sandbox_id, state_json, users_json, clients_json,
          prompt_queue_json, active_prompt_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        session.id,
        session.sessionID,
        session.sandboxID ?? null,
        JSON.stringify(session.state),
        JSON.stringify(session.users),
        JSON.stringify(session.clients),
        JSON.stringify(session.promptQueue),
        session.activePrompt ? JSON.stringify(session.activePrompt) : null,
        session.createdAt,
        now,
      )
      return
    }

    // KV storage fallback
    await this.state.storage.put(`session:${session.id}`, session)
  }

  async delete(sessionID: string): Promise<boolean> {
    if (this.config.useSqlStorage) {
      await this.init()
      const before = (
        this.state.storage.sql.run("SELECT COUNT(*) as count FROM sessions WHERE id = ?", sessionID).one() as {
          count: number
        }
      ).count
      this.state.storage.sql.run("DELETE FROM sessions WHERE id = ?", sessionID)
      const after = (
        this.state.storage.sql.run("SELECT COUNT(*) as count FROM sessions WHERE id = ?", sessionID).one() as {
          count: number
        }
      ).count
      return before > after
    }

    // KV storage fallback
    return this.state.storage.delete(`session:${sessionID}`)
  }

  async has(sessionID: string): Promise<boolean> {
    if (this.config.useSqlStorage) {
      await this.init()
      const result = this.state.storage.sql
        .run("SELECT COUNT(*) as count FROM sessions WHERE id = ?", sessionID)
        .one() as { count: number }
      return result.count > 0
    }

    // KV storage fallback
    const session = await this.state.storage.get<Multiplayer.Session>(`session:${sessionID}`)
    return session !== undefined
  }

  async count(): Promise<number> {
    if (this.config.useSqlStorage) {
      await this.init()
      const result = this.state.storage.sql.run("SELECT COUNT(*) as count FROM sessions").one() as { count: number }
      return result.count
    }

    // KV storage fallback
    const map = await this.state.storage.list({ prefix: "session:" })
    return map.size
  }

  async clear(): Promise<void> {
    if (this.config.useSqlStorage) {
      await this.init()
      this.state.storage.sql.run("DELETE FROM sessions")
      return
    }

    // KV storage fallback
    await this.state.storage.deleteAll()
  }

  async close(): Promise<void> {
    // Durable Objects handle cleanup automatically
    // This is a no-op for DO storage
  }

  /**
   * Get the underlying DO state (for advanced usage)
   */
  getDurableObjectState(): DurableObjectState {
    return this.state
  }
}

/**
 * Client for accessing Durable Object state store from outside the DO.
 *
 * This client makes HTTP requests to a Durable Object stub to perform
 * state operations. Use this when you need to access session state
 * from Workers or other services.
 */
export class DurableObjectStateStoreClient implements StateStore {
  private stub: DurableObjectStub

  constructor(stub: DurableObjectStub) {
    this.stub = stub
  }

  /**
   * Create a client from environment bindings
   */
  static fromEnv(env: DurableObjectEnv, name = "multiplayer-sessions"): DurableObjectStateStoreClient {
    const id = env.MULTIPLAYER_DO.idFromName(name)
    const stub = env.MULTIPLAYER_DO.get(id)
    return new DurableObjectStateStoreClient(stub)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.stub.fetch(
      new Request(`https://do-internal/${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      }),
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`DO request failed: ${response.status} ${error}`)
    }

    return response.json() as Promise<T>
  }

  async get(sessionID: string): Promise<Multiplayer.Session | undefined> {
    try {
      return await this.request<Multiplayer.Session>("GET", `sessions/${sessionID}`)
    } catch {
      return undefined
    }
  }

  async all(): Promise<Multiplayer.Session[]> {
    return this.request<Multiplayer.Session[]>("GET", "sessions")
  }

  async set(session: Multiplayer.Session): Promise<void> {
    await this.request("PUT", `sessions/${session.id}`, session)
  }

  async delete(sessionID: string): Promise<boolean> {
    const result = await this.request<{ deleted: boolean }>("DELETE", `sessions/${sessionID}`)
    return result.deleted
  }

  async has(sessionID: string): Promise<boolean> {
    const result = await this.request<{ exists: boolean }>("HEAD", `sessions/${sessionID}`)
    return result.exists
  }

  async count(): Promise<number> {
    const result = await this.request<{ count: number }>("GET", "sessions/count")
    return result.count
  }

  async clear(): Promise<void> {
    await this.request("DELETE", "sessions")
  }

  async close(): Promise<void> {
    // No-op for client
  }
}

/**
 * Base class for implementing the Multiplayer Durable Object.
 *
 * Extend this class and deploy as a Durable Object to use DO state storage.
 *
 * Example:
 * ```typescript
 * export class MultiplayerDO extends MultiplayerDurableObject {
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, { useSqlStorage: true })
 *   }
 * }
 * ```
 */
export abstract class MultiplayerDurableObject {
  protected store: DurableObjectStateStore

  constructor(state: DurableObjectState, config: DurableObjectStateStoreConfig = {}) {
    this.store = new DurableObjectStateStore(state, config)
  }

  /**
   * Handle incoming HTTP requests to the Durable Object.
   * Routes requests to the appropriate state store operations.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.slice(1) // Remove leading slash
    const parts = path.split("/")

    try {
      // GET /sessions - list all sessions
      if (request.method === "GET" && parts[0] === "sessions" && parts.length === 1) {
        const sessions = await this.store.all()
        return Response.json(sessions)
      }

      // GET /sessions/count - get session count
      if (request.method === "GET" && parts[0] === "sessions" && parts[1] === "count") {
        const count = await this.store.count()
        return Response.json({ count })
      }

      // GET /sessions/:id - get session by ID
      if (request.method === "GET" && parts[0] === "sessions" && parts.length === 2) {
        const session = await this.store.get(parts[1])
        if (!session) {
          return new Response("Not found", { status: 404 })
        }
        return Response.json(session)
      }

      // HEAD /sessions/:id - check if session exists
      if (request.method === "HEAD" && parts[0] === "sessions" && parts.length === 2) {
        const exists = await this.store.has(parts[1])
        return Response.json({ exists })
      }

      // PUT /sessions/:id - create/update session
      if (request.method === "PUT" && parts[0] === "sessions" && parts.length === 2) {
        const session = (await request.json()) as Multiplayer.Session
        await this.store.set(session)
        return Response.json({ success: true })
      }

      // DELETE /sessions/:id - delete session
      if (request.method === "DELETE" && parts[0] === "sessions" && parts.length === 2) {
        const deleted = await this.store.delete(parts[1])
        return Response.json({ deleted })
      }

      // DELETE /sessions - clear all sessions
      if (request.method === "DELETE" && parts[0] === "sessions" && parts.length === 1) {
        await this.store.clear()
        return Response.json({ success: true })
      }

      return new Response("Not found", { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      return new Response(message, { status: 500 })
    }
  }

  /**
   * Get the underlying state store for custom operations
   */
  getStateStore(): DurableObjectStateStore {
    return this.store
  }
}

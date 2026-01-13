import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  MemoryStateStore,
  SQLiteStateStore,
  createStateStore,
  type StateStore,
} from "./state"
import type { Multiplayer } from "./types"

function createTestSession(id: string, overrides: Partial<Multiplayer.Session> = {}): Multiplayer.Session {
  return {
    id,
    sessionID: `session_${id}`,
    users: [],
    clients: [],
    promptQueue: [],
    state: {
      gitSyncStatus: "pending",
      agentStatus: "idle",
      version: 0,
    },
    createdAt: Date.now(),
    ...overrides,
  }
}

function createTestUser(id: string): Multiplayer.User {
  return {
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    color: "#3B82F6",
    joinedAt: Date.now(),
  }
}

function createTestClient(id: string, userID: string): Multiplayer.Client {
  return {
    id,
    userID,
    type: "web",
    connectedAt: Date.now(),
    lastActivity: Date.now(),
  }
}

function createTestPrompt(id: string, userID: string): Multiplayer.QueuedPrompt {
  return {
    id,
    userID,
    content: `Prompt content for ${id}`,
    queuedAt: Date.now(),
    priority: 0,
  }
}

// Run the same tests for both store implementations
describe.each([
  ["MemoryStateStore", () => new MemoryStateStore()],
  ["SQLiteStateStore", () => new SQLiteStateStore({ path: ":memory:" })],
])("%s", (name, createStore) => {
  let store: StateStore

  beforeEach(() => {
    store = createStore()
  })

  afterEach(async () => {
    await store.close()
  })

  describe("basic CRUD operations", () => {
    test("set and get a session", async () => {
      const session = createTestSession("test-1")
      await store.set(session)

      const retrieved = await store.get("test-1")
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe("test-1")
      expect(retrieved?.sessionID).toBe("session_test-1")
    })

    test("returns undefined for non-existent session", async () => {
      const retrieved = await store.get("non-existent")
      expect(retrieved).toBeUndefined()
    })

    test("delete a session", async () => {
      const session = createTestSession("test-delete")
      await store.set(session)

      const deleted = await store.delete("test-delete")
      expect(deleted).toBe(true)

      const retrieved = await store.get("test-delete")
      expect(retrieved).toBeUndefined()
    })

    test("delete returns false for non-existent session", async () => {
      const deleted = await store.delete("non-existent")
      expect(deleted).toBe(false)
    })

    test("has returns true for existing session", async () => {
      const session = createTestSession("test-has")
      await store.set(session)

      const exists = await store.has("test-has")
      expect(exists).toBe(true)
    })

    test("has returns false for non-existent session", async () => {
      const exists = await store.has("non-existent")
      expect(exists).toBe(false)
    })
  })

  describe("session with nested data", () => {
    test("persists users", async () => {
      const session = createTestSession("test-users", {
        users: [createTestUser("user-1"), createTestUser("user-2")],
      })
      await store.set(session)

      const retrieved = await store.get("test-users")
      expect(retrieved?.users).toHaveLength(2)
      expect(retrieved?.users[0].name).toBe("User user-1")
      expect(retrieved?.users[1].email).toBe("user-2@example.com")
    })

    test("persists user cursor", async () => {
      const user = createTestUser("user-cursor")
      user.cursor = { file: "test.ts", line: 42, column: 10 }

      const session = createTestSession("test-cursor", { users: [user] })
      await store.set(session)

      const retrieved = await store.get("test-cursor")
      expect(retrieved?.users[0].cursor).toEqual({ file: "test.ts", line: 42, column: 10 })
    })

    test("persists clients", async () => {
      const session = createTestSession("test-clients", {
        users: [createTestUser("user-1")],
        clients: [
          createTestClient("client-1", "user-1"),
          { ...createTestClient("client-2", "user-1"), type: "mobile" },
        ],
      })
      await store.set(session)

      const retrieved = await store.get("test-clients")
      expect(retrieved?.clients).toHaveLength(2)
      expect(retrieved?.clients[0].type).toBe("web")
      expect(retrieved?.clients[1].type).toBe("mobile")
    })

    test("persists prompt queue", async () => {
      const session = createTestSession("test-prompts", {
        users: [createTestUser("user-1")],
        promptQueue: [
          { ...createTestPrompt("p-1", "user-1"), priority: 10 },
          { ...createTestPrompt("p-2", "user-1"), priority: 5 },
        ],
      })
      await store.set(session)

      const retrieved = await store.get("test-prompts")
      expect(retrieved?.promptQueue).toHaveLength(2)
      // Should be ordered by priority DESC
      expect(retrieved?.promptQueue[0].priority).toBe(10)
      expect(retrieved?.promptQueue[1].priority).toBe(5)
    })

    test("persists session state", async () => {
      const session = createTestSession("test-state", {
        state: {
          gitSyncStatus: "synced",
          agentStatus: "executing",
          editLock: "user-1",
          version: 5,
        },
      })
      await store.set(session)

      const retrieved = await store.get("test-state")
      expect(retrieved?.state.gitSyncStatus).toBe("synced")
      expect(retrieved?.state.agentStatus).toBe("executing")
      expect(retrieved?.state.editLock).toBe("user-1")
      expect(retrieved?.state.version).toBe(5)
    })

    test("persists sandboxID", async () => {
      const session = createTestSession("test-sandbox", {
        sandboxID: "sandbox-123",
      })
      await store.set(session)

      const retrieved = await store.get("test-sandbox")
      expect(retrieved?.sandboxID).toBe("sandbox-123")
    })
  })

  describe("update operations", () => {
    test("updates existing session", async () => {
      const session = createTestSession("test-update")
      await store.set(session)

      session.state.version = 10
      session.users.push(createTestUser("new-user"))
      await store.set(session)

      const retrieved = await store.get("test-update")
      expect(retrieved?.state.version).toBe(10)
      expect(retrieved?.users).toHaveLength(1)
    })

    test("replaces users on update", async () => {
      const session = createTestSession("test-replace-users", {
        users: [createTestUser("user-1"), createTestUser("user-2")],
      })
      await store.set(session)

      // Update with different users
      session.users = [createTestUser("user-3")]
      await store.set(session)

      const retrieved = await store.get("test-replace-users")
      expect(retrieved?.users).toHaveLength(1)
      expect(retrieved?.users[0].id).toBe("user-3")
    })
  })

  describe("listing operations", () => {
    test("all returns empty array when no sessions", async () => {
      const all = await store.all()
      expect(all).toHaveLength(0)
    })

    test("all returns all sessions", async () => {
      await store.set(createTestSession("s-1"))
      await store.set(createTestSession("s-2"))
      await store.set(createTestSession("s-3"))

      const all = await store.all()
      expect(all).toHaveLength(3)
    })

    test("count returns correct number", async () => {
      expect(await store.count()).toBe(0)

      await store.set(createTestSession("s-1"))
      expect(await store.count()).toBe(1)

      await store.set(createTestSession("s-2"))
      expect(await store.count()).toBe(2)

      await store.delete("s-1")
      expect(await store.count()).toBe(1)
    })
  })

  describe("clear operation", () => {
    test("removes all sessions", async () => {
      await store.set(createTestSession("s-1"))
      await store.set(createTestSession("s-2"))

      await store.clear()

      expect(await store.count()).toBe(0)
      expect(await store.get("s-1")).toBeUndefined()
      expect(await store.get("s-2")).toBeUndefined()
    })
  })
})

describe("SQLiteStateStore specific", () => {
  test("uses in-memory database by default", () => {
    const store = new SQLiteStateStore()
    // Just verify it initializes without error
    expect(store).toBeDefined()
  })

  test("getDatabase returns null before init", () => {
    const store = new SQLiteStateStore()
    expect(store.getDatabase()).toBeNull()
  })

  test("getDatabase returns database after init", async () => {
    const store = new SQLiteStateStore({ path: ":memory:" })
    await store.set(createTestSession("init-test"))
    expect(store.getDatabase()).not.toBeNull()
    await store.close()
  })

  test("close resets state", async () => {
    const store = new SQLiteStateStore({ path: ":memory:" })
    await store.set(createTestSession("close-test"))
    await store.close()
    expect(store.getDatabase()).toBeNull()
  })
})

describe("createStateStore factory", () => {
  test("creates MemoryStateStore for memory type", () => {
    const store = createStateStore("memory")
    expect(store).toBeInstanceOf(MemoryStateStore)
  })

  test("creates SQLiteStateStore for sqlite type", () => {
    const store = createStateStore("sqlite")
    expect(store).toBeInstanceOf(SQLiteStateStore)
  })

  test("passes config to SQLiteStateStore", () => {
    const store = createStateStore("sqlite", { path: ":memory:", walMode: false })
    expect(store).toBeInstanceOf(SQLiteStateStore)
  })
})

// Mock implementation for Durable Object testing
import {
  DurableObjectStateStore,
  DurableObjectStateStoreClient,
  MultiplayerDurableObject,
  type DurableObjectState,
  type DurableObjectStorage,
  type SqlStorage,
  type SqlStorageCursor,
  type DurableObjectStub,
  type DurableObjectEnv,
} from "./state"

/**
 * Mock SQL cursor for testing
 */
class MockSqlCursor implements SqlStorageCursor {
  constructor(private results: unknown[]) {}

  toArray(): unknown[] {
    return this.results
  }

  one(): unknown {
    return this.results[0]
  }

  raw(): unknown[][] {
    return this.results.map((r) => Object.values(r as object))
  }
}

/**
 * Mock SQL storage using in-memory Map
 */
class MockSqlStorage implements SqlStorage {
  private tables = new Map<string, unknown[]>()

  run(query: string, ...bindings: unknown[]): SqlStorageCursor {
    const queryLower = query.toLowerCase().trim()

    // CREATE TABLE
    if (queryLower.startsWith("create table")) {
      const match = query.match(/create table if not exists (\w+)/i)
      if (match && !this.tables.has(match[1])) {
        this.tables.set(match[1], [])
      }
      return new MockSqlCursor([])
    }

    // CREATE INDEX (no-op for mock)
    if (queryLower.startsWith("create index")) {
      return new MockSqlCursor([])
    }

    // SELECT
    if (queryLower.startsWith("select")) {
      if (queryLower.includes("count(*)")) {
        // Count query
        if (queryLower.includes("where id = ?")) {
          const id = bindings[0] as string
          const sessions = this.tables.get("sessions") || []
          const count = sessions.filter((s: unknown) => (s as { id: string }).id === id).length
          return new MockSqlCursor([{ count }])
        }
        const sessions = this.tables.get("sessions") || []
        return new MockSqlCursor([{ count: sessions.length }])
      }

      // Regular select
      const sessions = this.tables.get("sessions") || []
      if (queryLower.includes("where id = ?")) {
        const id = bindings[0] as string
        const filtered = sessions.filter((s: unknown) => (s as { id: string }).id === id)
        return new MockSqlCursor(filtered)
      }
      return new MockSqlCursor(sessions)
    }

    // INSERT OR REPLACE
    if (queryLower.startsWith("insert or replace")) {
      const sessions = this.tables.get("sessions") || []
      const newRow = {
        id: bindings[0],
        session_id: bindings[1],
        sandbox_id: bindings[2],
        state_json: bindings[3],
        users_json: bindings[4],
        clients_json: bindings[5],
        prompt_queue_json: bindings[6],
        active_prompt_json: bindings[7],
        created_at: bindings[8],
        updated_at: bindings[9],
      }
      const existingIndex = sessions.findIndex((s: unknown) => (s as { id: unknown }).id === bindings[0])
      if (existingIndex >= 0) {
        sessions[existingIndex] = newRow
      } else {
        sessions.push(newRow)
      }
      this.tables.set("sessions", sessions)
      return new MockSqlCursor([])
    }

    // DELETE
    if (queryLower.startsWith("delete")) {
      if (queryLower.includes("where id = ?")) {
        const sessions = this.tables.get("sessions") || []
        const id = bindings[0] as string
        const filtered = sessions.filter((s: unknown) => (s as { id: string }).id !== id)
        this.tables.set("sessions", filtered)
      } else {
        this.tables.set("sessions", [])
      }
      return new MockSqlCursor([])
    }

    return new MockSqlCursor([])
  }
}

/**
 * Mock KV storage for testing KV mode
 */
class MockKvStorage {
  private data = new Map<string, unknown>()

  async get<T>(key: string | string[]): Promise<T | Map<string, T> | undefined> {
    if (Array.isArray(key)) {
      const result = new Map<string, T>()
      for (const k of key) {
        const v = this.data.get(k) as T
        if (v !== undefined) result.set(k, v)
      }
      return result as Map<string, T>
    }
    return this.data.get(key) as T | undefined
  }

  async put<T>(keyOrEntries: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof keyOrEntries === "string") {
      this.data.set(keyOrEntries, value)
    } else {
      for (const [k, v] of Object.entries(keyOrEntries)) {
        this.data.set(k, v)
      }
    }
  }

  delete(key: string): Promise<boolean>
  delete(keys: string[]): Promise<number>
  async delete(key: string | string[]): Promise<boolean | number> {
    if (Array.isArray(key)) {
      let count = 0
      for (const k of key) {
        if (this.data.delete(k)) count++
      }
      return count
    }
    return this.data.delete(key)
  }

  async list<T>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    for (const [k, v] of this.data.entries()) {
      if (!options?.prefix || k.startsWith(options.prefix)) {
        result.set(k, v as T)
        if (options?.limit && result.size >= options.limit) break
      }
    }
    return result
  }

  async deleteAll(): Promise<void> {
    this.data.clear()
  }
}

/**
 * Create mock Durable Object state for testing
 */
function createMockDOState(useSql = true): DurableObjectState {
  const kvStorage = new MockKvStorage()
  const sqlStorage = new MockSqlStorage()

  const storage: DurableObjectStorage = {
    get: kvStorage.get.bind(kvStorage),
    put: kvStorage.put.bind(kvStorage),
    delete: kvStorage.delete.bind(kvStorage),
    list: kvStorage.list.bind(kvStorage),
    deleteAll: kvStorage.deleteAll.bind(kvStorage),
    sql: sqlStorage,
  }

  return {
    storage,
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
    id: { toString: () => "mock-do-id" },
  }
}

describe("DurableObjectStateStore", () => {
  describe("SQL mode", () => {
    let store: DurableObjectStateStore
    let mockState: DurableObjectState

    beforeEach(() => {
      mockState = createMockDOState(true)
      store = new DurableObjectStateStore(mockState, { useSqlStorage: true })
    })

    afterEach(async () => {
      await store.close()
    })

    test("set and get a session", async () => {
      const session = createTestSession("do-test-1")
      await store.set(session)

      const retrieved = await store.get("do-test-1")
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe("do-test-1")
      expect(retrieved?.sessionID).toBe("session_do-test-1")
    })

    test("returns undefined for non-existent session", async () => {
      const retrieved = await store.get("non-existent")
      expect(retrieved).toBeUndefined()
    })

    test("delete a session", async () => {
      const session = createTestSession("do-test-delete")
      await store.set(session)

      const deleted = await store.delete("do-test-delete")
      expect(deleted).toBe(true)

      const retrieved = await store.get("do-test-delete")
      expect(retrieved).toBeUndefined()
    })

    test("has returns true for existing session", async () => {
      const session = createTestSession("do-test-has")
      await store.set(session)

      const exists = await store.has("do-test-has")
      expect(exists).toBe(true)
    })

    test("has returns false for non-existent session", async () => {
      const exists = await store.has("non-existent")
      expect(exists).toBe(false)
    })

    test("count returns correct number", async () => {
      expect(await store.count()).toBe(0)

      await store.set(createTestSession("s-1"))
      expect(await store.count()).toBe(1)

      await store.set(createTestSession("s-2"))
      expect(await store.count()).toBe(2)
    })

    test("all returns all sessions", async () => {
      await store.set(createTestSession("s-1"))
      await store.set(createTestSession("s-2"))

      const all = await store.all()
      expect(all).toHaveLength(2)
    })

    test("clear removes all sessions", async () => {
      await store.set(createTestSession("s-1"))
      await store.set(createTestSession("s-2"))

      await store.clear()
      expect(await store.count()).toBe(0)
    })

    test("persists nested data correctly", async () => {
      const session = createTestSession("nested-test", {
        sandboxID: "sandbox-123",
        users: [createTestUser("user-1")],
        clients: [createTestClient("client-1", "user-1")],
        promptQueue: [createTestPrompt("prompt-1", "user-1")],
        state: {
          gitSyncStatus: "synced",
          agentStatus: "executing",
          editLock: "user-1",
          version: 5,
        },
      })
      await store.set(session)

      const retrieved = await store.get("nested-test")
      expect(retrieved?.sandboxID).toBe("sandbox-123")
      expect(retrieved?.users).toHaveLength(1)
      expect(retrieved?.clients).toHaveLength(1)
      expect(retrieved?.promptQueue).toHaveLength(1)
      expect(retrieved?.state.editLock).toBe("user-1")
    })

    test("getDurableObjectState returns the DO state", () => {
      expect(store.getDurableObjectState()).toBe(mockState)
    })
  })

  describe("KV mode", () => {
    let store: DurableObjectStateStore
    let mockState: DurableObjectState

    beforeEach(() => {
      mockState = createMockDOState(false)
      store = new DurableObjectStateStore(mockState, { useSqlStorage: false })
    })

    afterEach(async () => {
      await store.close()
    })

    test("set and get a session", async () => {
      const session = createTestSession("kv-test-1")
      await store.set(session)

      const retrieved = await store.get("kv-test-1")
      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe("kv-test-1")
    })

    test("delete a session", async () => {
      const session = createTestSession("kv-test-delete")
      await store.set(session)

      const deleted = await store.delete("kv-test-delete")
      expect(deleted).toBe(true)
    })

    test("count returns correct number", async () => {
      await store.set(createTestSession("s-1"))
      await store.set(createTestSession("s-2"))
      expect(await store.count()).toBe(2)
    })

    test("all returns all sessions", async () => {
      await store.set(createTestSession("s-1"))
      await store.set(createTestSession("s-2"))

      const all = await store.all()
      expect(all).toHaveLength(2)
    })

    test("clear removes all sessions", async () => {
      await store.set(createTestSession("s-1"))
      await store.clear()
      expect(await store.count()).toBe(0)
    })
  })
})

describe("MultiplayerDurableObject", () => {
  class TestMultiplayerDO extends MultiplayerDurableObject {
    constructor(state: DurableObjectState) {
      super(state, { useSqlStorage: true })
    }
  }

  let durableObject: TestMultiplayerDO

  beforeEach(() => {
    const mockState = createMockDOState(true)
    durableObject = new TestMultiplayerDO(mockState)
  })

  test("GET /sessions returns empty array initially", async () => {
    const response = await durableObject.fetch(new Request("https://do/sessions"))
    expect(response.ok).toBe(true)
    const sessions = (await response.json()) as unknown[]
    expect(sessions).toHaveLength(0)
  })

  test("PUT and GET session", async () => {
    const session = createTestSession("test-1")

    // PUT session
    const putResponse = await durableObject.fetch(
      new Request("https://do/sessions/test-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
      }),
    )
    expect(putResponse.ok).toBe(true)

    // GET session
    const getResponse = await durableObject.fetch(new Request("https://do/sessions/test-1"))
    expect(getResponse.ok).toBe(true)
    const retrieved = (await getResponse.json()) as Multiplayer.Session
    expect(retrieved.id).toBe("test-1")
  })

  test("GET /sessions/:id returns 404 for non-existent", async () => {
    const response = await durableObject.fetch(new Request("https://do/sessions/non-existent"))
    expect(response.status).toBe(404)
  })

  test("DELETE /sessions/:id removes session", async () => {
    const session = createTestSession("to-delete")
    await durableObject.fetch(
      new Request("https://do/sessions/to-delete", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
      }),
    )

    const deleteResponse = await durableObject.fetch(
      new Request("https://do/sessions/to-delete", { method: "DELETE" }),
    )
    expect(deleteResponse.ok).toBe(true)

    const getResponse = await durableObject.fetch(new Request("https://do/sessions/to-delete"))
    expect(getResponse.status).toBe(404)
  })

  test("GET /sessions/count returns correct count", async () => {
    await durableObject.fetch(
      new Request("https://do/sessions/s1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createTestSession("s1")),
      }),
    )
    await durableObject.fetch(
      new Request("https://do/sessions/s2", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createTestSession("s2")),
      }),
    )

    const response = await durableObject.fetch(new Request("https://do/sessions/count"))
    expect(response.ok).toBe(true)
    const result = (await response.json()) as { count: number }
    expect(result.count).toBe(2)
  })

  test("DELETE /sessions clears all sessions", async () => {
    await durableObject.fetch(
      new Request("https://do/sessions/s1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createTestSession("s1")),
      }),
    )

    const clearResponse = await durableObject.fetch(new Request("https://do/sessions", { method: "DELETE" }))
    expect(clearResponse.ok).toBe(true)

    const countResponse = await durableObject.fetch(new Request("https://do/sessions/count"))
    const result = (await countResponse.json()) as { count: number }
    expect(result.count).toBe(0)
  })

  test("HEAD /sessions/:id returns exists status", async () => {
    await durableObject.fetch(
      new Request("https://do/sessions/exists-test", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createTestSession("exists-test")),
      }),
    )

    const response = await durableObject.fetch(new Request("https://do/sessions/exists-test", { method: "HEAD" }))
    expect(response.ok).toBe(true)
    const result = (await response.json()) as { exists: boolean }
    expect(result.exists).toBe(true)
  })

  test("returns 404 for unknown routes", async () => {
    const response = await durableObject.fetch(new Request("https://do/unknown"))
    expect(response.status).toBe(404)
  })

  test("getStateStore returns the store", () => {
    expect(durableObject.getStateStore()).toBeInstanceOf(DurableObjectStateStore)
  })
})

describe("DurableObjectStateStoreClient", () => {
  // Create a mock stub that uses a real DO
  function createMockStub(): DurableObjectStub {
    const mockState = createMockDOState(true)

    class MockDO extends MultiplayerDurableObject {
      constructor() {
        super(mockState, { useSqlStorage: true })
      }
    }

    const durableObject = new MockDO()

    return {
      fetch: (request: Request) => durableObject.fetch(request),
    }
  }

  let client: DurableObjectStateStoreClient

  beforeEach(() => {
    client = new DurableObjectStateStoreClient(createMockStub())
  })

  afterEach(async () => {
    await client.close()
  })

  test("set and get a session", async () => {
    const session = createTestSession("client-test-1")
    await client.set(session)

    const retrieved = await client.get("client-test-1")
    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toBe("client-test-1")
  })

  test("returns undefined for non-existent session", async () => {
    const retrieved = await client.get("non-existent")
    expect(retrieved).toBeUndefined()
  })

  test("delete a session", async () => {
    const session = createTestSession("client-delete")
    await client.set(session)

    const deleted = await client.delete("client-delete")
    expect(deleted).toBe(true)
  })

  test("count returns correct number", async () => {
    await client.set(createTestSession("s-1"))
    await client.set(createTestSession("s-2"))

    const count = await client.count()
    expect(count).toBe(2)
  })

  test("all returns all sessions", async () => {
    await client.set(createTestSession("s-1"))
    await client.set(createTestSession("s-2"))

    const all = await client.all()
    expect(all).toHaveLength(2)
  })

  test("clear removes all sessions", async () => {
    await client.set(createTestSession("s-1"))
    await client.clear()

    const count = await client.count()
    expect(count).toBe(0)
  })

  test("fromEnv creates client from environment bindings", () => {
    const mockEnv: DurableObjectEnv = {
      MULTIPLAYER_DO: {
        idFromName: (name: string) => ({ toString: () => `id-${name}` }),
        get: () => createMockStub(),
      },
    }

    const envClient = DurableObjectStateStoreClient.fromEnv(mockEnv)
    expect(envClient).toBeInstanceOf(DurableObjectStateStoreClient)
  })
})

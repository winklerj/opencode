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

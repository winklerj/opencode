import { describe, it, expect, beforeEach } from "bun:test"
import { SessionManager } from "./session"
import { Multiplayer, type MultiplayerEvent } from "./types"

describe("SessionManager", () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager({
      maxUsersPerSession: 5,
      maxClientsPerUser: 3,
      lockTimeout: 60000,
    })
  })

  describe("create()", () => {
    it("should create a new session", () => {
      const session = manager.create({
        sessionID: "session_1",
      })

      expect(session.id).toMatch(/^mp_/)
      expect(session.sessionID).toBe("session_1")
      expect(session.users).toEqual([])
      expect(session.clients).toEqual([])
      expect(session.state.agentStatus).toBe("idle")
      expect(session.state.version).toBe(0)
    })

    it("should create session with sandboxID", () => {
      const session = manager.create({
        sessionID: "session_1",
        sandboxID: "sandbox_1",
      })

      expect(session.sandboxID).toBe("sandbox_1")
    })

    it("should emit session.created event", () => {
      const events: MultiplayerEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.create({ sessionID: "session_1" })

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("session.created")
    })
  })

  describe("join()", () => {
    it("should allow user to join session", () => {
      const session = manager.create({ sessionID: "session_1" })

      const user = manager.join(session.id, {
        userID: "user_1",
        name: "Test User",
      })

      expect(user).toBeDefined()
      expect(user?.id).toBe("user_1")
      expect(user?.name).toBe("Test User")
      expect(user?.color).toBeDefined() // Should have auto-generated color
      expect(manager.getUsers(session.id).length).toBe(1)
    })

    it("should emit user.joined event", () => {
      const session = manager.create({ sessionID: "session_1" })
      const events: MultiplayerEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.join(session.id, { userID: "user_1", name: "Test User" })

      const joinEvent = events.find((e) => e.type === "user.joined")
      expect(joinEvent).toBeDefined()
    })

    it("should return existing user if already joined", () => {
      const session = manager.create({ sessionID: "session_1" })

      const user1 = manager.join(session.id, { userID: "user_1", name: "Test User" })
      const user2 = manager.join(session.id, { userID: "user_1", name: "Test User 2" })

      expect(user1).toBe(user2)
      expect(manager.getUsers(session.id).length).toBe(1)
    })

    it("should respect max users limit", () => {
      const session = manager.create({ sessionID: "session_1" })

      for (let i = 0; i < 5; i++) {
        manager.join(session.id, { userID: `user_${i}`, name: `User ${i}` })
      }

      const overflow = manager.join(session.id, { userID: "user_5", name: "User 5" })
      expect(overflow).toBeNull()
      expect(manager.getUsers(session.id).length).toBe(5)
    })

    it("should return null for non-existent session", () => {
      const user = manager.join("non_existent", { userID: "user_1", name: "Test" })
      expect(user).toBeNull()
    })
  })

  describe("leave()", () => {
    it("should allow user to leave session", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })

      const result = manager.leave(session.id, "user_1")

      expect(result).toBe(true)
      expect(manager.getUsers(session.id).length).toBe(0)
    })

    it("should emit user.left event", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })
      const events: MultiplayerEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.leave(session.id, "user_1")

      const leaveEvent = events.find((e) => e.type === "user.left")
      expect(leaveEvent).toBeDefined()
    })

    it("should release edit lock when user leaves", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })
      manager.acquireLock(session.id, "user_1")

      expect(manager.get(session.id)?.state.editLock).toBe("user_1")

      manager.leave(session.id, "user_1")

      expect(manager.get(session.id)?.state.editLock).toBeUndefined()
    })

    it("should remove user's clients when leaving", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })
      manager.connect(session.id, { userID: "user_1", type: "web" })
      manager.connect(session.id, { userID: "user_1", type: "mobile" })

      expect(manager.getClients(session.id).length).toBe(2)

      manager.leave(session.id, "user_1")

      expect(manager.getClients(session.id).length).toBe(0)
    })

    it("should return false for non-existent user", () => {
      const session = manager.create({ sessionID: "session_1" })
      const result = manager.leave(session.id, "non_existent")
      expect(result).toBe(false)
    })
  })

  describe("connect()", () => {
    it("should allow client to connect", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })

      const client = manager.connect(session.id, { userID: "user_1", type: "web" })

      expect(client).toBeDefined()
      expect(client?.userID).toBe("user_1")
      expect(client?.type).toBe("web")
      expect(manager.getClients(session.id).length).toBe(1)
    })

    it("should emit client.connected event", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })
      const events: MultiplayerEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.connect(session.id, { userID: "user_1", type: "web" })

      const connectEvent = events.find((e) => e.type === "client.connected")
      expect(connectEvent).toBeDefined()
    })

    it("should not allow client for non-joined user", () => {
      const session = manager.create({ sessionID: "session_1" })

      const client = manager.connect(session.id, { userID: "user_1", type: "web" })

      expect(client).toBeNull()
    })

    it("should respect max clients per user", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })

      for (let i = 0; i < 3; i++) {
        manager.connect(session.id, { userID: "user_1", type: "web" })
      }

      const overflow = manager.connect(session.id, { userID: "user_1", type: "mobile" })
      expect(overflow).toBeNull()
    })
  })

  describe("disconnect()", () => {
    it("should allow client to disconnect", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })
      const client = manager.connect(session.id, { userID: "user_1", type: "web" })

      const result = manager.disconnect(session.id, client!.id)

      expect(result).toBe(true)
      expect(manager.getClients(session.id).length).toBe(0)
    })

    it("should emit client.disconnected event", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })
      const client = manager.connect(session.id, { userID: "user_1", type: "web" })
      const events: MultiplayerEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.disconnect(session.id, client!.id)

      const disconnectEvent = events.find((e) => e.type === "client.disconnected")
      expect(disconnectEvent).toBeDefined()
    })
  })

  describe("updateCursor()", () => {
    it("should update user cursor position", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })

      const result = manager.updateCursor(session.id, "user_1", {
        file: "src/index.ts",
        line: 10,
        column: 5,
      })

      expect(result).toBe(true)

      const user = manager.getUser(session.id, "user_1")
      expect(user?.cursor?.file).toBe("src/index.ts")
      expect(user?.cursor?.line).toBe(10)
    })

    it("should emit cursor.moved event", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })
      const events: MultiplayerEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.updateCursor(session.id, "user_1", { file: "src/index.ts" })

      const cursorEvent = events.find((e) => e.type === "cursor.moved")
      expect(cursorEvent).toBeDefined()
    })
  })

  describe("acquireLock()", () => {
    it("should allow user to acquire edit lock", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })

      const result = manager.acquireLock(session.id, "user_1")

      expect(result).toBe(true)
      expect(manager.get(session.id)?.state.editLock).toBe("user_1")
    })

    it("should emit lock.acquired event", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })
      const events: MultiplayerEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.acquireLock(session.id, "user_1")

      const lockEvent = events.find((e) => e.type === "lock.acquired")
      expect(lockEvent).toBeDefined()
    })

    it("should not allow acquiring when lock already held", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "User 1" })
      manager.join(session.id, { userID: "user_2", name: "User 2" })

      manager.acquireLock(session.id, "user_1")
      const result = manager.acquireLock(session.id, "user_2")

      expect(result).toBe(false)
      expect(manager.get(session.id)?.state.editLock).toBe("user_1")
    })

    it("should not allow non-joined user to acquire lock", () => {
      const session = manager.create({ sessionID: "session_1" })

      const result = manager.acquireLock(session.id, "user_1")

      expect(result).toBe(false)
    })
  })

  describe("releaseLock()", () => {
    it("should allow lock holder to release", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })
      manager.acquireLock(session.id, "user_1")

      const result = manager.releaseLock(session.id, "user_1")

      expect(result).toBe(true)
      expect(manager.get(session.id)?.state.editLock).toBeUndefined()
    })

    it("should emit lock.released event", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })
      manager.acquireLock(session.id, "user_1")
      const events: MultiplayerEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.releaseLock(session.id, "user_1")

      const releaseEvent = events.find((e) => e.type === "lock.released")
      expect(releaseEvent).toBeDefined()
    })

    it("should not allow non-holder to release", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "User 1" })
      manager.join(session.id, { userID: "user_2", name: "User 2" })
      manager.acquireLock(session.id, "user_1")

      const result = manager.releaseLock(session.id, "user_2")

      expect(result).toBe(false)
      expect(manager.get(session.id)?.state.editLock).toBe("user_1")
    })
  })

  describe("canEdit()", () => {
    it("should return true when no lock exists", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })

      expect(manager.canEdit(session.id, "user_1")).toBe(true)
    })

    it("should return true for lock holder", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "Test User" })
      manager.acquireLock(session.id, "user_1")

      expect(manager.canEdit(session.id, "user_1")).toBe(true)
    })

    it("should return false for non-holder when lock exists", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "User 1" })
      manager.join(session.id, { userID: "user_2", name: "User 2" })
      manager.acquireLock(session.id, "user_1")

      expect(manager.canEdit(session.id, "user_2")).toBe(false)
    })
  })

  describe("updateState()", () => {
    it("should update session state", () => {
      const session = manager.create({ sessionID: "session_1" })

      manager.updateState(session.id, { agentStatus: "executing" })

      expect(manager.get(session.id)?.state.agentStatus).toBe("executing")
    })

    it("should emit state.changed event", () => {
      const session = manager.create({ sessionID: "session_1" })
      const events: MultiplayerEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.updateState(session.id, { gitSyncStatus: "synced" })

      const stateEvent = events.find((e) => e.type === "state.changed")
      expect(stateEvent).toBeDefined()
    })

    it("should increment version on update", () => {
      const session = manager.create({ sessionID: "session_1" })
      const initialVersion = manager.get(session.id)?.state.version

      manager.updateState(session.id, { agentStatus: "thinking" })

      expect(manager.get(session.id)?.state.version).toBe((initialVersion || 0) + 1)
    })
  })

  describe("query methods", () => {
    beforeEach(() => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "User 1" })
      manager.join(session.id, { userID: "user_2", name: "User 2" })
      manager.connect(session.id, { userID: "user_1", type: "web" })
    })

    it("get() should return session by ID", () => {
      const sessions = manager.all()
      const session = manager.get(sessions[0].id)
      expect(session).toBeDefined()
    })

    it("all() should return all sessions", () => {
      expect(manager.all().length).toBe(1)
    })

    it("getUsers() should return users in session", () => {
      const sessions = manager.all()
      expect(manager.getUsers(sessions[0].id).length).toBe(2)
    })

    it("getClients() should return clients in session", () => {
      const sessions = manager.all()
      expect(manager.getClients(sessions[0].id).length).toBe(1)
    })

    it("getUser() should return specific user", () => {
      const sessions = manager.all()
      const user = manager.getUser(sessions[0].id, "user_1")
      expect(user?.name).toBe("User 1")
    })

    it("count should return session count", () => {
      expect(manager.count).toBe(1)
    })
  })

  describe("TLA+ invariants", () => {
    it("SingleEditLockHolder: lock held by at most one user", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "User 1" })
      manager.join(session.id, { userID: "user_2", name: "User 2" })
      manager.join(session.id, { userID: "user_3", name: "User 3" })

      // User 1 acquires lock
      manager.acquireLock(session.id, "user_1")

      // Other users cannot acquire
      expect(manager.acquireLock(session.id, "user_2")).toBe(false)
      expect(manager.acquireLock(session.id, "user_3")).toBe(false)

      // Lock is still held by user_1
      expect(manager.get(session.id)?.state.editLock).toBe("user_1")
    })

    it("SingleEditLockHolder: lock holder must be in session users", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "User 1" })
      manager.acquireLock(session.id, "user_1")

      const lockHolder = manager.get(session.id)?.state.editLock
      const users = manager.getUsers(session.id)

      if (lockHolder) {
        expect(users.some((u) => u.id === lockHolder)).toBe(true)
      }
    })

    it("ValidSessionUsers: all users in session have valid IDs", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "User 1" })
      manager.join(session.id, { userID: "user_2", name: "User 2" })

      const users = manager.getUsers(session.id)

      for (const user of users) {
        expect(user.id).toBeDefined()
        expect(typeof user.id).toBe("string")
        expect(user.id.length).toBeGreaterThan(0)
      }
    })

    it("ValidClientTypes: all clients have valid types", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "User 1" })
      manager.connect(session.id, { userID: "user_1", type: "web" })
      manager.connect(session.id, { userID: "user_1", type: "mobile" })

      const clients = manager.getClients(session.id)
      const validTypes = ["web", "slack", "chrome", "mobile", "voice"]

      for (const client of clients) {
        expect(validTypes).toContain(client.type)
      }
    })

    it("ClientsReferenceValidUsers: all clients reference joined users", () => {
      const session = manager.create({ sessionID: "session_1" })
      manager.join(session.id, { userID: "user_1", name: "User 1" })
      manager.connect(session.id, { userID: "user_1", type: "web" })

      const clients = manager.getClients(session.id)
      const users = manager.getUsers(session.id)

      for (const client of clients) {
        expect(users.some((u) => u.id === client.userID)).toBe(true)
      }
    })

    it("VersionMonotonicallyIncreases: state version always increases", () => {
      const session = manager.create({ sessionID: "session_1" })
      const versions: number[] = [manager.get(session.id)?.state.version || 0]

      manager.join(session.id, { userID: "user_1", name: "User 1" })
      versions.push(manager.get(session.id)?.state.version || 0)

      manager.connect(session.id, { userID: "user_1", type: "web" })
      versions.push(manager.get(session.id)?.state.version || 0)

      manager.acquireLock(session.id, "user_1")
      versions.push(manager.get(session.id)?.state.version || 0)

      manager.releaseLock(session.id, "user_1")
      versions.push(manager.get(session.id)?.state.version || 0)

      // Each version should be greater than or equal to previous
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i]).toBeGreaterThan(versions[i - 1])
      }
    })
  })

  describe("subscription", () => {
    it("unsubscribe should stop events", () => {
      const events: MultiplayerEvent[] = []
      const unsubscribe = manager.subscribe((e) => events.push(e))

      manager.create({ sessionID: "session_1" })
      expect(events.length).toBe(1)

      unsubscribe()
      manager.create({ sessionID: "session_2" })
      expect(events.length).toBe(1)
    })
  })
})

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { SnapshotManager, type Snapshot, type SnapshotEvent } from "./manager"
import { Sandbox } from "../sandbox"

describe("SnapshotManager", () => {
  let manager: SnapshotManager

  beforeEach(() => {
    manager = new SnapshotManager({
      maxSnapshotsPerSession: 3,
      snapshotTTL: 60000, // 1 minute
      cleanupInterval: 1000,
    })
  })

  afterEach(() => {
    manager.stopCleanup()
    manager.clear()
  })

  describe("create()", () => {
    it("should create a snapshot", () => {
      const snapshot = manager.create("sandbox_1", "session_1", "abc123")

      expect(snapshot).toBeDefined()
      expect(snapshot?.id).toMatch(/^snapshot_/)
      expect(snapshot?.sandboxID).toBe("sandbox_1")
      expect(snapshot?.sessionID).toBe("session_1")
      expect(snapshot?.gitCommit).toBe("abc123")
      expect(snapshot?.hasUncommittedChanges).toBe(false)
      expect(snapshot?.expired).toBe(false)
      expect(snapshot?.createdAt).toBeGreaterThan(0)
    })

    it("should create snapshot with uncommitted changes flag", () => {
      const snapshot = manager.create("sandbox_1", "session_1", "abc123", true)

      expect(snapshot?.hasUncommittedChanges).toBe(true)
    })

    it("should emit created event", () => {
      const events: SnapshotEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.create("sandbox_1", "session_1", "abc123")

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("created")
    })

    it("should add new snapshots to front of session list (newest first)", () => {
      manager.create("sandbox_1", "session_1", "commit1")
      manager.create("sandbox_2", "session_1", "commit2")
      manager.create("sandbox_3", "session_1", "commit3")

      const sessionSnaps = manager.bySession("session_1")
      expect(sessionSnaps.length).toBe(3)
      expect(sessionSnaps[0].gitCommit).toBe("commit3")
      expect(sessionSnaps[1].gitCommit).toBe("commit2")
      expect(sessionSnaps[2].gitCommit).toBe("commit1")
    })

    it("should remove oldest snapshot when max reached", () => {
      // Max is 3
      manager.create("sandbox_1", "session_1", "commit1")
      manager.create("sandbox_2", "session_1", "commit2")
      manager.create("sandbox_3", "session_1", "commit3")
      manager.create("sandbox_4", "session_1", "commit4")

      const sessionSnaps = manager.bySession("session_1")
      expect(sessionSnaps.length).toBe(3)
      expect(sessionSnaps[0].gitCommit).toBe("commit4")
      expect(sessionSnaps[1].gitCommit).toBe("commit3")
      expect(sessionSnaps[2].gitCommit).toBe("commit2")
      // commit1 should have been removed
    })

    it("should track snapshots separately per session", () => {
      manager.create("sandbox_1", "session_1", "commit1")
      manager.create("sandbox_2", "session_2", "commit2")
      manager.create("sandbox_3", "session_1", "commit3")

      expect(manager.bySession("session_1").length).toBe(2)
      expect(manager.bySession("session_2").length).toBe(1)
    })
  })

  describe("getLatest()", () => {
    it("should return the latest non-expired snapshot", () => {
      manager.create("sandbox_1", "session_1", "commit1")
      manager.create("sandbox_2", "session_1", "commit2")

      const latest = manager.getLatest("session_1")
      expect(latest?.gitCommit).toBe("commit2")
    })

    it("should return undefined for session without snapshots", () => {
      const latest = manager.getLatest("session_1")
      expect(latest).toBeUndefined()
    })

    it("should return undefined if latest snapshot is expired", () => {
      const snapshot = manager.create("sandbox_1", "session_1", "commit1")
      manager.expire(snapshot!.id)

      const latest = manager.getLatest("session_1")
      expect(latest).toBeUndefined()
    })
  })

  describe("hasValidSnapshot()", () => {
    it("should return true when valid snapshot exists", () => {
      manager.create("sandbox_1", "session_1", "commit1")
      expect(manager.hasValidSnapshot("session_1")).toBe(true)
    })

    it("should return false for session without snapshots", () => {
      expect(manager.hasValidSnapshot("session_1")).toBe(false)
    })

    it("should return false when all snapshots expired", () => {
      const snapshot = manager.create("sandbox_1", "session_1", "commit1")
      manager.expire(snapshot!.id)

      expect(manager.hasValidSnapshot("session_1")).toBe(false)
    })
  })

  describe("restore()", () => {
    it("should call restore callback with snapshot", async () => {
      const snapshot = manager.create("sandbox_1", "session_1", "commit1")

      const mockSandbox: Sandbox.Info = {
        id: "new_sandbox_1",
        projectID: "project_1",
        status: "ready",
        provider: "local",
        image: { id: "img_1", tag: "latest", digest: "sha256:abc", builtAt: Date.now() },
        git: { repo: "owner/repo", branch: "main", commit: "commit1", syncStatus: "pending" },
        services: [],
        network: { internalIP: "10.0.0.1", ports: {} },
        snapshot: { id: snapshot!.id, createdAt: snapshot!.createdAt },
        time: { created: Date.now(), lastActivity: Date.now() },
      }

      manager.onRestore(async (snap, sessionID) => {
        expect(snap.id).toBe(snapshot!.id)
        expect(sessionID).toBe("session_1")
        return mockSandbox
      })

      const events: SnapshotEvent[] = []
      manager.subscribe((e) => events.push(e))

      const result = await manager.restore("session_1")

      expect(result).toBeDefined()
      expect(result?.id).toBe("new_sandbox_1")

      const restoreEvents = events.filter((e) => e.type === "restored")
      expect(restoreEvents.length).toBe(1)
    })

    it("should return null if no valid snapshot", async () => {
      manager.onRestore(async () => {
        throw new Error("Should not be called")
      })

      const result = await manager.restore("session_1")
      expect(result).toBeNull()
    })

    it("should return null if no restore callback set", async () => {
      manager.create("sandbox_1", "session_1", "commit1")

      const result = await manager.restore("session_1")
      expect(result).toBeNull()
    })
  })

  describe("expire()", () => {
    it("should mark snapshot as expired", () => {
      const snapshot = manager.create("sandbox_1", "session_1", "commit1")

      const result = manager.expire(snapshot!.id)

      expect(result).toBe(true)
      expect(manager.get(snapshot!.id)?.expired).toBe(true)
    })

    it("should emit expired event", () => {
      const snapshot = manager.create("sandbox_1", "session_1", "commit1")
      const events: SnapshotEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.expire(snapshot!.id)

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("expired")
    })

    it("should return false for non-existent snapshot", () => {
      const result = manager.expire("non_existent")
      expect(result).toBe(false)
    })

    it("should return false for already expired snapshot", () => {
      const snapshot = manager.create("sandbox_1", "session_1", "commit1")
      manager.expire(snapshot!.id)

      const result = manager.expire(snapshot!.id)
      expect(result).toBe(false)
    })
  })

  describe("remove()", () => {
    it("should remove snapshot from manager", () => {
      const snapshot = manager.create("sandbox_1", "session_1", "commit1")

      const result = manager.remove(snapshot!.id)

      expect(result).toBe(true)
      expect(manager.get(snapshot!.id)).toBeUndefined()
      expect(manager.bySession("session_1").length).toBe(0)
    })

    it("should emit cleaned event", () => {
      const snapshot = manager.create("sandbox_1", "session_1", "commit1")
      const events: SnapshotEvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.remove(snapshot!.id)

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("cleaned")
    })

    it("should return false for non-existent snapshot", () => {
      const result = manager.remove("non_existent")
      expect(result).toBe(false)
    })

    it("should maintain session list integrity", () => {
      manager.create("sandbox_1", "session_1", "commit1")
      const snap2 = manager.create("sandbox_2", "session_1", "commit2")
      manager.create("sandbox_3", "session_1", "commit3")

      manager.remove(snap2!.id)

      const sessionSnaps = manager.bySession("session_1")
      expect(sessionSnaps.length).toBe(2)
      expect(sessionSnaps[0].gitCommit).toBe("commit3")
      expect(sessionSnaps[1].gitCommit).toBe("commit1")
    })
  })

  describe("cleanupExpired()", () => {
    it("should remove all expired snapshots", () => {
      const snap1 = manager.create("sandbox_1", "session_1", "commit1")
      const snap2 = manager.create("sandbox_2", "session_1", "commit2")
      manager.create("sandbox_3", "session_1", "commit3")

      manager.expire(snap1!.id)
      manager.expire(snap2!.id)

      const cleaned = manager.cleanupExpired()

      expect(cleaned).toBe(2)
      expect(manager.count).toBe(1)
    })
  })

  describe("query methods", () => {
    beforeEach(() => {
      manager.create("sandbox_1", "session_1", "commit1")
      manager.create("sandbox_2", "session_1", "commit2")
      manager.create("sandbox_3", "session_2", "commit3")
    })

    it("get() should return snapshot by ID", () => {
      const all = manager.all()
      const snapshot = manager.get(all[0].id)
      expect(snapshot).toBeDefined()
    })

    it("all() should return all snapshots", () => {
      expect(manager.all().length).toBe(3)
    })

    it("bySession() should filter by session", () => {
      expect(manager.bySession("session_1").length).toBe(2)
      expect(manager.bySession("session_2").length).toBe(1)
      expect(manager.bySession("session_3").length).toBe(0)
    })

    it("count should return total snapshot count", () => {
      expect(manager.count).toBe(3)
    })

    it("validCount() should return non-expired count for session", () => {
      expect(manager.validCount("session_1")).toBe(2)

      const sessionSnaps = manager.bySession("session_1")
      manager.expire(sessionSnaps[0].id)

      expect(manager.validCount("session_1")).toBe(1)
    })
  })

  describe("subscription", () => {
    it("unsubscribe should stop events", () => {
      const events: SnapshotEvent[] = []
      const unsubscribe = manager.subscribe((e) => events.push(e))

      manager.create("sandbox_1", "session_1", "commit1")
      expect(events.length).toBe(1)

      unsubscribe()
      manager.create("sandbox_2", "session_1", "commit2")
      expect(events.length).toBe(1)
    })
  })

  describe("TLA+ invariants", () => {
    it("ValidSnapshotCount: count >= actual snapshots", () => {
      manager.create("sandbox_1", "session_1", "commit1")
      manager.create("sandbox_2", "session_1", "commit2")
      manager.create("sandbox_3", "session_2", "commit3")

      expect(manager.count).toBe(3)
      expect(manager.all().length).toBe(manager.count)
    })

    it("SnapshotsReferenceValidSessions: all snapshots have sessionID", () => {
      manager.create("sandbox_1", "session_1", "commit1")
      manager.create("sandbox_2", "session_2", "commit2")

      for (const snapshot of manager.all()) {
        expect(snapshot.sessionID).toBeDefined()
        expect(typeof snapshot.sessionID).toBe("string")
        expect(snapshot.sessionID.length).toBeGreaterThan(0)
      }
    })

    it("ValidSessionSnapshotLists: session lists contain valid snapshot IDs", () => {
      manager.create("sandbox_1", "session_1", "commit1")
      manager.create("sandbox_2", "session_1", "commit2")

      const sessionSnaps = manager.bySession("session_1")
      for (const snapshot of sessionSnaps) {
        expect(manager.get(snapshot.id)).toBeDefined()
      }
    })

    it("MaxSnapshotsEnforced: session never exceeds max snapshots", () => {
      // Max is 3
      for (let i = 0; i < 10; i++) {
        manager.create(`sandbox_${i}`, "session_1", `commit${i}`)
      }

      expect(manager.bySession("session_1").length).toBeLessThanOrEqual(3)
    })

    it("ExpiredSnapshotsNotReturnedAsLatest: getLatest skips expired", () => {
      const snap1 = manager.create("sandbox_1", "session_1", "commit1")
      manager.create("sandbox_2", "session_1", "commit2")
      const snap3 = manager.create("sandbox_3", "session_1", "commit3")

      // Expire the latest
      manager.expire(snap3!.id)

      const latest = manager.getLatest("session_1")
      expect(latest?.gitCommit).toBe("commit2")
    })

    it("SnapshotOrderMaintained: newest first in session list", () => {
      manager.create("sandbox_1", "session_1", "commit1")
      manager.create("sandbox_2", "session_1", "commit2")
      manager.create("sandbox_3", "session_1", "commit3")

      const sessionSnaps = manager.bySession("session_1")

      // Should be in descending order by creation time
      for (let i = 0; i < sessionSnaps.length - 1; i++) {
        expect(sessionSnaps[i].createdAt).toBeGreaterThanOrEqual(sessionSnaps[i + 1].createdAt)
      }
    })
  })

  describe("TTL expiration", () => {
    it("should expire snapshots based on TTL in getLatest", async () => {
      // Create manager with very short TTL
      const shortTTLManager = new SnapshotManager({
        maxSnapshotsPerSession: 3,
        snapshotTTL: 50, // 50ms TTL
        cleanupInterval: 10000,
      })

      shortTTLManager.create("sandbox_1", "session_1", "commit1")

      // Immediately should be valid
      expect(shortTTLManager.hasValidSnapshot("session_1")).toBe(true)

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Now should be invalid
      expect(shortTTLManager.hasValidSnapshot("session_1")).toBe(false)

      shortTTLManager.clear()
    })
  })
})

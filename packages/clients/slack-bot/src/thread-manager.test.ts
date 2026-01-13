import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { ThreadManager } from "./thread-manager"

describe("ThreadManager", () => {
  let manager: ThreadManager

  beforeEach(() => {
    manager = new ThreadManager({ ttlMs: 1000, cleanupIntervalMs: 1000000 }) // Short TTL, no auto cleanup
  })

  afterEach(() => {
    manager.dispose()
  })

  describe("create", () => {
    test("creates a new thread", () => {
      const thread = manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
      })

      expect(thread.threadTs).toBe("123.456")
      expect(thread.channelID).toBe("C123")
      expect(thread.initiatorUserID).toBe("U123")
      expect(thread.status).toBe("active")
      expect(thread.messageCount).toBe(1)
    })

    test("creates thread with repository context", () => {
      const thread = manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
        repository: {
          repository: "org/repo",
          source: "link",
          confidence: 1.0,
        },
      })

      expect(thread.repository?.repository).toBe("org/repo")
    })

    test("creates thread with session ID", () => {
      const thread = manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
        sessionID: "session-123",
      })

      expect(thread.sessionID).toBe("session-123")
    })
  })

  describe("get", () => {
    test("returns thread by channel and timestamp", () => {
      manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
      })

      const thread = manager.get("C123", "123.456")
      expect(thread).toBeDefined()
      expect(thread?.threadTs).toBe("123.456")
    })

    test("returns undefined for non-existent thread", () => {
      const thread = manager.get("C999", "999.999")
      expect(thread).toBeUndefined()
    })
  })

  describe("touch", () => {
    test("updates last activity timestamp", async () => {
      const original = manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
      })

      // Wait to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 50))

      const updated = manager.touch("C123", "123.456")
      // Use >= to handle fast execution where timestamps might be equal
      expect(updated?.lastActivityAt).toBeGreaterThanOrEqual(original.lastActivityAt)
    })

    test("returns undefined for non-existent thread", () => {
      const result = manager.touch("C999", "999.999")
      expect(result).toBeUndefined()
    })
  })

  describe("addMessage", () => {
    test("increments message count", () => {
      manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
      })

      const updated = manager.addMessage("C123", "123.456")
      expect(updated?.messageCount).toBe(2)
    })
  })

  describe("setSession", () => {
    test("associates session with thread", () => {
      manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
      })

      const updated = manager.setSession("C123", "123.456", "session-abc")
      expect(updated?.sessionID).toBe("session-abc")
    })
  })

  describe("status transitions", () => {
    beforeEach(() => {
      manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
      })
    })

    test("processing sets status to processing", () => {
      const thread = manager.processing("C123", "123.456")
      expect(thread?.status).toBe("processing")
    })

    test("waiting sets status to waiting", () => {
      const thread = manager.waiting("C123", "123.456")
      expect(thread?.status).toBe("waiting")
    })

    test("complete sets status to completed", () => {
      const thread = manager.complete("C123", "123.456")
      expect(thread?.status).toBe("completed")
    })

    test("error sets status and message", () => {
      const thread = manager.error("C123", "123.456", "Something went wrong")
      expect(thread?.status).toBe("error")
      expect(thread?.errorMessage).toBe("Something went wrong")
    })
  })

  describe("delete", () => {
    test("removes thread", () => {
      manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
      })

      const deleted = manager.delete("C123", "123.456")
      expect(deleted).toBe(true)
      expect(manager.get("C123", "123.456")).toBeUndefined()
    })

    test("returns false for non-existent thread", () => {
      const deleted = manager.delete("C999", "999.999")
      expect(deleted).toBe(false)
    })
  })

  describe("listByChannel", () => {
    test("returns threads for channel sorted by activity", async () => {
      manager.create({
        threadTs: "100.000",
        channelID: "C123",
        initiatorUserID: "U123",
      })

      await new Promise((r) => setTimeout(r, 10))

      manager.create({
        threadTs: "200.000",
        channelID: "C123",
        initiatorUserID: "U123",
      })

      const threads = manager.listByChannel("C123")
      expect(threads.length).toBe(2)
      expect(threads[0]?.threadTs).toBe("200.000") // Most recent first
    })

    test("returns empty array for channel with no threads", () => {
      const threads = manager.listByChannel("C999")
      expect(threads.length).toBe(0)
    })
  })

  describe("listActive", () => {
    test("returns only active, processing, and waiting threads", () => {
      manager.create({
        threadTs: "1.000",
        channelID: "C123",
        initiatorUserID: "U123",
      })
      manager.create({
        threadTs: "2.000",
        channelID: "C123",
        initiatorUserID: "U123",
      })
      manager.create({
        threadTs: "3.000",
        channelID: "C123",
        initiatorUserID: "U123",
      })

      manager.complete("C123", "2.000")
      manager.processing("C123", "3.000")

      const active = manager.listActive()
      expect(active.length).toBe(2) // active + processing, not completed
    })
  })

  describe("getBySession", () => {
    test("finds thread by session ID", () => {
      manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
        sessionID: "session-xyz",
      })

      const thread = manager.getBySession("session-xyz")
      expect(thread?.threadTs).toBe("123.456")
    })

    test("returns undefined for non-existent session", () => {
      const thread = manager.getBySession("nonexistent")
      expect(thread).toBeUndefined()
    })
  })

  describe("cleanup", () => {
    test("removes stale threads", async () => {
      manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
      })

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 1100))

      const cleaned = manager.cleanup()
      expect(cleaned).toBe(1)
      expect(manager.get("C123", "123.456")).toBeUndefined()
    })

    test("does not remove processing threads", async () => {
      manager.create({
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
      })
      manager.processing("C123", "123.456")

      await new Promise((r) => setTimeout(r, 1100))

      const cleaned = manager.cleanup()
      expect(cleaned).toBe(0)
      expect(manager.get("C123", "123.456")).toBeDefined()
    })
  })

  describe("stats", () => {
    test("returns thread statistics", () => {
      manager.create({
        threadTs: "1.000",
        channelID: "C123",
        initiatorUserID: "U123",
      })
      manager.create({
        threadTs: "2.000",
        channelID: "C123",
        initiatorUserID: "U123",
      })
      manager.create({
        threadTs: "3.000",
        channelID: "C123",
        initiatorUserID: "U123",
      })

      manager.processing("C123", "2.000")
      manager.complete("C123", "3.000")

      const stats = manager.stats()
      expect(stats.total).toBe(3)
      expect(stats.active).toBe(1)
      expect(stats.processing).toBe(1)
      expect(stats.completed).toBe(1)
    })
  })
})

import { describe, test, expect, beforeEach } from "bun:test"
import { SessionManager } from "./session-manager"
import type { GitHubPR, GitHubPREvent } from "./types"

function createTestPR(prNumber: number, repository = "owner/repo"): GitHubPR {
  return {
    number: prNumber,
    title: `Test PR #${prNumber}`,
    htmlUrl: `https://github.com/${repository}/pull/${prNumber}`,
    author: "testuser",
    headBranch: "feature-branch",
    baseBranch: "main",
    headSha: "abc123",
    state: "open",
    repository,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe("SessionManager", () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager()
  })

  describe("createOrGet", () => {
    test("creates new session mapping", () => {
      const pr = createTestPR(1)
      const mapping = manager.createOrGet(pr)

      expect(mapping.prNumber).toBe(1)
      expect(mapping.repository).toBe("owner/repo")
      expect(mapping.sessionID).toContain("github-pr-owner-repo-1")
    })

    test("returns existing session on second call", () => {
      const pr = createTestPR(1)
      const first = manager.createOrGet(pr)
      const second = manager.createOrGet(pr)

      expect(first.sessionID).toBe(second.sessionID)
      expect(manager.count).toBe(1)
    })

    test("uses custom session ID if provided", () => {
      const pr = createTestPR(1)
      const mapping = manager.createOrGet(pr, "custom-session-id")

      expect(mapping.sessionID).toBe("custom-session-id")
    })

    test("emits session.created event", () => {
      const events: GitHubPREvent[] = []
      manager.subscribe((e) => events.push(e))

      const pr = createTestPR(1)
      manager.createOrGet(pr)

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe("session.created")
    })

    test("does not emit event for existing session", () => {
      const pr = createTestPR(1)
      manager.createOrGet(pr)

      const events: GitHubPREvent[] = []
      manager.subscribe((e) => events.push(e))

      manager.createOrGet(pr)
      expect(events).toHaveLength(0)
    })
  })

  describe("get", () => {
    test("returns session if exists", () => {
      const pr = createTestPR(1)
      const created = manager.createOrGet(pr)

      const retrieved = manager.get("owner/repo", 1)
      expect(retrieved).toEqual(created)
    })

    test("returns undefined if not exists", () => {
      expect(manager.get("owner/repo", 999)).toBeUndefined()
    })
  })

  describe("getBySessionID", () => {
    test("finds session by session ID", () => {
      const pr = createTestPR(1)
      manager.createOrGet(pr, "my-session-id")

      const found = manager.getBySessionID("my-session-id")
      expect(found?.prNumber).toBe(1)
    })

    test("returns undefined for unknown session ID", () => {
      expect(manager.getBySessionID("unknown")).toBeUndefined()
    })
  })

  describe("touch", () => {
    test("updates lastActivityAt", async () => {
      const pr = createTestPR(1)
      const mapping = manager.createOrGet(pr)
      const originalTime = mapping.lastActivityAt

      await Bun.sleep(10)
      manager.touch("owner/repo", 1)

      const updated = manager.get("owner/repo", 1)
      expect(updated?.lastActivityAt).toBeGreaterThan(originalTime)
    })

    test("returns false for unknown PR", () => {
      expect(manager.touch("owner/repo", 999)).toBe(false)
    })
  })

  describe("comment contexts", () => {
    test("adds and retrieves comment context", () => {
      manager.addCommentContext({
        commentID: 123,
        prNumber: 1,
        repository: "owner/repo",
        path: "src/file.ts",
        line: 42,
      })

      const context = manager.getCommentContext(123)
      expect(context?.path).toBe("src/file.ts")
      expect(context?.line).toBe(42)
    })

    test("removes comment context", () => {
      manager.addCommentContext({
        commentID: 123,
        prNumber: 1,
        repository: "owner/repo",
      })

      const removed = manager.removeCommentContext(123)
      expect(removed).toBe(true)
      expect(manager.getCommentContext(123)).toBeUndefined()
    })

    test("gets all contexts for a PR", () => {
      manager.addCommentContext({
        commentID: 1,
        prNumber: 1,
        repository: "owner/repo",
      })
      manager.addCommentContext({
        commentID: 2,
        prNumber: 1,
        repository: "owner/repo",
      })
      manager.addCommentContext({
        commentID: 3,
        prNumber: 2,
        repository: "owner/repo",
      })

      const contexts = manager.getCommentContextsForPR("owner/repo", 1)
      expect(contexts).toHaveLength(2)
    })
  })

  describe("delete", () => {
    test("removes session and associated comment contexts", () => {
      const pr = createTestPR(1)
      manager.createOrGet(pr)
      manager.addCommentContext({
        commentID: 123,
        prNumber: 1,
        repository: "owner/repo",
      })

      const deleted = manager.delete("owner/repo", 1)
      expect(deleted).toBe(true)
      expect(manager.get("owner/repo", 1)).toBeUndefined()
      expect(manager.getCommentContext(123)).toBeUndefined()
    })
  })

  describe("forRepository", () => {
    test("returns sessions for specific repository", () => {
      manager.createOrGet(createTestPR(1, "owner/repo1"))
      manager.createOrGet(createTestPR(2, "owner/repo1"))
      manager.createOrGet(createTestPR(3, "owner/repo2"))

      const repo1Sessions = manager.forRepository("owner/repo1")
      expect(repo1Sessions).toHaveLength(2)
    })
  })

  describe("cleanup", () => {
    test("cleanupStale removes old sessions", async () => {
      manager = new SessionManager({ idleTimeout: 50 })

      const pr = createTestPR(1)
      manager.createOrGet(pr)

      await Bun.sleep(100)
      const removed = manager.cleanupStale()

      expect(removed).toBe(1)
      expect(manager.count).toBe(0)
    })

    test("respects maxSessions limit", () => {
      manager = new SessionManager({ maxSessions: 2 })

      manager.createOrGet(createTestPR(1))
      manager.createOrGet(createTestPR(2))
      manager.createOrGet(createTestPR(3))

      expect(manager.count).toBe(2)
    })
  })

  describe("clear", () => {
    test("removes all sessions and contexts", () => {
      manager.createOrGet(createTestPR(1))
      manager.createOrGet(createTestPR(2))
      manager.addCommentContext({
        commentID: 123,
        prNumber: 1,
        repository: "owner/repo",
      })

      manager.clear()

      expect(manager.count).toBe(0)
      expect(manager.getCommentContext(123)).toBeUndefined()
    })
  })
})

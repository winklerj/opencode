import { describe, test, expect } from "bun:test"
import { tmpdir } from "../../test/fixture/fixture"
import { Instance } from "../project/instance"
import { SnapshotLifecycle } from "./lifecycle"

describe("SnapshotLifecycle", () => {
  describe("initialization", () => {
    test("should initialize without errors", async () => {
      await using dir = await tmpdir({ git: true })
      await Instance.provide({
        directory: dir.path,
        fn: async () => {
          const manager = await SnapshotLifecycle.initialize()
          expect(manager).toBeDefined()
          expect(manager.config).toBeDefined()
          expect(manager.config.autoTerminate).toBe(true)
          expect(manager.config.minWorkDuration).toBe(5000)
          expect(manager.config.syncOnRestore).toBe(true)
        },
      })
    })
  })

  describe("trackSandbox", () => {
    test("should track sandbox for a session", async () => {
      await using dir = await tmpdir({ git: true })
      await Instance.provide({
        directory: dir.path,
        fn: async () => {
          await SnapshotLifecycle.trackSandbox("session-1", "sandbox-1")
          const manager = await SnapshotLifecycle.initialize()
          expect(manager.sessionWork.get("session-1")?.sandboxID).toBe("sandbox-1")
        },
      })
    })
  })

  describe("markChanged", () => {
    test("should mark session as having changes", async () => {
      await using dir = await tmpdir({ git: true })
      await Instance.provide({
        directory: dir.path,
        fn: async () => {
          await SnapshotLifecycle.trackSandbox("session-2", "sandbox-2")
          await SnapshotLifecycle.markChanged("session-2")
          const manager = await SnapshotLifecycle.initialize()
          expect(manager.sessionWork.get("session-2")?.hasChanges).toBe(true)
        },
      })
    })
  })

  describe("stats", () => {
    test("should return statistics", async () => {
      await using dir = await tmpdir({ git: true })
      await Instance.provide({
        directory: dir.path,
        fn: async () => {
          const stats = await SnapshotLifecycle.stats()
          expect(stats).toHaveProperty("activeSessions")
          expect(stats).toHaveProperty("totalSnapshots")
          expect(typeof stats.activeSessions).toBe("number")
          expect(typeof stats.totalSnapshots).toBe("number")
        },
      })
    })
  })
})

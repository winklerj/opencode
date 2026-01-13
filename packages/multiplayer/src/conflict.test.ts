import { describe, test, expect, beforeEach, mock } from "bun:test"
import {
  ConflictResolver,
  createUpdate,
  OptimisticUpdater,
  type VersionedUpdate,
  type ConflictEvent,
} from "./conflict"

interface TestState {
  editLock?: string
  agentStatus: string
  gitSyncStatus: string
  customField?: string
}

describe("ConflictResolver", () => {
  let resolver: ConflictResolver<TestState>

  beforeEach(() => {
    resolver = new ConflictResolver<TestState>()
  })

  describe("no conflict scenarios", () => {
    test("applies update when versions match", () => {
      const currentState = {
        version: 1,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(1, { agentStatus: "thinking" }, "client-1")

      const result = resolver.resolve(currentState, update)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.newState.version).toBe(2)
        expect(result.newState.agentStatus).toBe("thinking")
        expect(result.result.resolved).toBe(true)
      }
    })

    test("preserves existing fields on update", () => {
      const currentState = {
        version: 5,
        agentStatus: "idle",
        gitSyncStatus: "synced",
        customField: "value",
      }
      const update = createUpdate<TestState>(5, { agentStatus: "executing" }, "client-1")

      const result = resolver.resolve(currentState, update)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.newState.customField).toBe("value")
        expect(result.newState.gitSyncStatus).toBe("synced")
      }
    })
  })

  describe("last-write-wins strategy", () => {
    test("accepts update even with version mismatch", () => {
      resolver = new ConflictResolver<TestState>({ strategy: "last-write-wins" })

      const currentState = {
        version: 5,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(3, { agentStatus: "thinking" }, "client-1")

      const result = resolver.resolve(currentState, update)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.newState.agentStatus).toBe("thinking")
        expect(result.newState.version).toBe(6)
        expect(result.result.strategy).toBe("last-write-wins")
      }
    })

    test("increments version on each update", () => {
      const currentState = {
        version: 10,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(8, { gitSyncStatus: "syncing" }, "client-1")

      const result = resolver.resolve(currentState, update)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.newState.version).toBe(11)
      }
    })
  })

  describe("reject strategy", () => {
    test("rejects update with version mismatch", () => {
      resolver = new ConflictResolver<TestState>({ strategy: "reject" })

      const currentState = {
        version: 5,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(3, { agentStatus: "thinking" }, "client-1")

      const result = resolver.resolve(currentState, update)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.conflict.currentVersion).toBe(5)
        expect(result.conflict.update.baseVersion).toBe(3)
        expect(result.conflict.strategy).toBe("reject")
      }
    })

    test("accepts update when versions match", () => {
      resolver = new ConflictResolver<TestState>({ strategy: "reject" })

      const currentState = {
        version: 5,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(5, { agentStatus: "thinking" }, "client-1")

      const result = resolver.resolve(currentState, update)

      expect(result.success).toBe(true)
    })
  })

  describe("merge strategy", () => {
    test("merges non-conflicting fields", () => {
      resolver = new ConflictResolver<TestState>({
        strategy: "merge",
        nonMergeableFields: ["editLock"],
      })

      const currentState = {
        version: 5,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(3, { customField: "new-value" }, "client-1")

      const result = resolver.resolve(currentState, update)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.newState.customField).toBe("new-value")
        expect(result.result.strategy).toBe("merge")
        expect(result.result.mergedFields).toContain("customField")
      }
    })

    test("rejects when non-mergeable field conflicts", () => {
      resolver = new ConflictResolver<TestState>({
        strategy: "merge",
        nonMergeableFields: ["editLock"],
      })

      const currentState = {
        version: 5,
        agentStatus: "idle",
        gitSyncStatus: "synced",
        editLock: "user-1",
      }
      const update = createUpdate<TestState>(3, { editLock: "user-2" }, "client-1")

      const result = resolver.resolve(currentState, update)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.conflict.conflictingFields).toContain("editLock")
      }
    })

    test("reports merged and rejected fields", () => {
      resolver = new ConflictResolver<TestState>({
        strategy: "merge",
        nonMergeableFields: [],
      })

      const currentState = {
        version: 5,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(
        3,
        { agentStatus: "thinking", customField: "value" },
        "client-1",
      )

      const result = resolver.resolve(currentState, update)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.mergedFields).toBeDefined()
        // When merging, conflicting fields that aren't non-mergeable are skipped
        expect(result.result.rejectedUpdates).toBeDefined()
      }
    })
  })

  describe("version drift handling", () => {
    test("rejects update when version drift exceeds maximum", () => {
      resolver = new ConflictResolver<TestState>({
        strategy: "last-write-wins",
        maxVersionDrift: 5,
      })

      const currentState = {
        version: 20,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(10, { agentStatus: "thinking" }, "client-1")

      const result = resolver.resolve(currentState, update)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.conflict.currentVersion).toBe(20)
      }
    })

    test("accepts update when version drift is within limit", () => {
      resolver = new ConflictResolver<TestState>({
        strategy: "last-write-wins",
        maxVersionDrift: 10,
      })

      const currentState = {
        version: 15,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(10, { agentStatus: "thinking" }, "client-1")

      const result = resolver.resolve(currentState, update)

      expect(result.success).toBe(true)
    })
  })

  describe("event emission", () => {
    test("emits conflict.detected on version mismatch", () => {
      const events: ConflictEvent[] = []
      resolver.subscribe((e) => events.push(e))

      const currentState = {
        version: 5,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(3, { agentStatus: "thinking" }, "client-1")

      resolver.resolve(currentState, update)

      expect(events.some((e) => e.type === "conflict.detected")).toBe(true)
    })

    test("emits conflict.resolved when update succeeds", () => {
      const events: ConflictEvent[] = []
      resolver.subscribe((e) => events.push(e))

      const currentState = {
        version: 5,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(5, { agentStatus: "thinking" }, "client-1")

      resolver.resolve(currentState, update)

      expect(events.some((e) => e.type === "conflict.resolved")).toBe(true)
    })

    test("emits conflict.rejected when update fails", () => {
      resolver = new ConflictResolver<TestState>({ strategy: "reject" })
      const events: ConflictEvent[] = []
      resolver.subscribe((e) => events.push(e))

      const currentState = {
        version: 5,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(3, { agentStatus: "thinking" }, "client-1")

      resolver.resolve(currentState, update)

      expect(events.some((e) => e.type === "conflict.rejected")).toBe(true)
    })

    test("unsubscribe stops events", () => {
      const events: ConflictEvent[] = []
      const unsub = resolver.subscribe((e) => events.push(e))

      unsub()

      const currentState = {
        version: 5,
        agentStatus: "idle",
        gitSyncStatus: "synced",
      }
      const update = createUpdate<TestState>(5, { agentStatus: "thinking" }, "client-1")

      resolver.resolve(currentState, update)

      expect(events.length).toBe(0)
    })
  })

  describe("wouldConflict helper", () => {
    test("returns true when versions differ", () => {
      expect(resolver.wouldConflict(5, 3)).toBe(true)
      expect(resolver.wouldConflict(10, 8)).toBe(true)
    })

    test("returns false when versions match", () => {
      expect(resolver.wouldConflict(5, 5)).toBe(false)
      expect(resolver.wouldConflict(0, 0)).toBe(false)
    })
  })

  describe("strategy management", () => {
    test("returns current strategy", () => {
      resolver = new ConflictResolver<TestState>({ strategy: "merge" })
      expect(resolver.strategy).toBe("merge")
    })

    test("allows changing strategy", () => {
      resolver.setStrategy("reject")
      expect(resolver.strategy).toBe("reject")
    })
  })
})

describe("createUpdate helper", () => {
  test("creates versioned update with timestamp", () => {
    const before = Date.now()
    const update = createUpdate(5, { field: "value" }, "client-1")
    const after = Date.now()

    expect(update.baseVersion).toBe(5)
    expect(update.updates).toEqual({ field: "value" })
    expect(update.clientID).toBe("client-1")
    expect(update.timestamp).toBeGreaterThanOrEqual(before)
    expect(update.timestamp).toBeLessThanOrEqual(after)
  })
})

describe("OptimisticUpdater", () => {
  let updater: OptimisticUpdater<TestState>

  beforeEach(() => {
    updater = new OptimisticUpdater<TestState>()
  })

  test("creates pending updates", () => {
    const updateID = updater.createPending(5, { agentStatus: "thinking" }, "client-1")

    expect(updateID).toBeDefined()
    expect(updater.pendingCount).toBe(1)
  })

  test("confirms updates removes them from pending", () => {
    const updateID = updater.createPending(5, { agentStatus: "thinking" }, "client-1")

    updater.confirm(updateID)

    expect(updater.pendingCount).toBe(0)
  })

  test("rollback returns and removes update", () => {
    const updateID = updater.createPending(5, { agentStatus: "thinking" }, "client-1")

    const update = updater.rollback(updateID)

    expect(update).toBeDefined()
    expect(update?.updates.agentStatus).toBe("thinking")
    expect(updater.pendingCount).toBe(0)
  })

  test("rollback returns undefined for unknown ID", () => {
    const update = updater.rollback("unknown-id")
    expect(update).toBeUndefined()
  })

  test("getPending returns all pending updates", () => {
    updater.createPending(1, { agentStatus: "thinking" }, "client-1")
    updater.createPending(2, { gitSyncStatus: "syncing" }, "client-1")

    const pending = updater.getPending()

    expect(pending.length).toBe(2)
  })

  test("clear removes all pending updates", () => {
    updater.createPending(1, { agentStatus: "thinking" }, "client-1")
    updater.createPending(2, { gitSyncStatus: "syncing" }, "client-1")

    updater.clear()

    expect(updater.pendingCount).toBe(0)
  })

  test("generates unique update IDs", () => {
    const id1 = updater.createPending(1, { agentStatus: "thinking" }, "client-1")
    const id2 = updater.createPending(1, { agentStatus: "executing" }, "client-1")

    expect(id1).not.toBe(id2)
  })
})

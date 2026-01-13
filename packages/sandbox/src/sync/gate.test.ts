import { describe, it, expect, beforeEach } from "bun:test"
import { SyncGate, READONLY_TOOLS, WRITE_TOOLS } from "./gate"
import type { Sandbox } from "../sandbox"

describe("SyncGate", () => {
  let gate: SyncGate

  beforeEach(() => {
    gate = new SyncGate({ enabled: true, retryInterval: 100, maxWaitTime: 1000 })
  })

  describe("check()", () => {
    it("should allow read-only tools when sync is pending", () => {
      for (const tool of READONLY_TOOLS) {
        const result = gate.check(tool, "sandbox-1", "pending")
        expect(result.allowed).toBe(true)
        expect(result.reason).toBeUndefined()
      }
    })

    it("should allow read-only tools when sync is syncing", () => {
      for (const tool of READONLY_TOOLS) {
        const result = gate.check(tool, "sandbox-1", "syncing")
        expect(result.allowed).toBe(true)
      }
    })

    it("should allow read-only tools when sync is synced", () => {
      for (const tool of READONLY_TOOLS) {
        const result = gate.check(tool, "sandbox-1", "synced")
        expect(result.allowed).toBe(true)
      }
    })

    it("should allow read-only tools when sync is error", () => {
      for (const tool of READONLY_TOOLS) {
        const result = gate.check(tool, "sandbox-1", "error")
        expect(result.allowed).toBe(true)
      }
    })

    it("should block write tools when sync is pending", () => {
      for (const tool of WRITE_TOOLS) {
        const result = gate.check(tool, "sandbox-1", "pending")
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Waiting for git sync")
        expect(result.retryAfter).toBe(100)
      }
    })

    it("should block write tools when sync is syncing", () => {
      for (const tool of WRITE_TOOLS) {
        const result = gate.check(tool, "sandbox-1", "syncing")
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("syncing")
      }
    })

    it("should allow write tools when sync is complete", () => {
      for (const tool of WRITE_TOOLS) {
        const result = gate.check(tool, "sandbox-1", "synced")
        expect(result.allowed).toBe(true)
      }
    })

    it("should allow unknown tools regardless of sync status", () => {
      const result = gate.check("unknown_tool", "sandbox-1", "pending")
      expect(result.allowed).toBe(true)
    })

    it("should allow all tools when gate is disabled", () => {
      const disabledGate = new SyncGate({ enabled: false })
      for (const tool of WRITE_TOOLS) {
        const result = disabledGate.check(tool, "sandbox-1", "pending")
        expect(result.allowed).toBe(true)
      }
    })
  })

  describe("wait()", () => {
    it("should return immediately for read-only tools", async () => {
      const getSyncStatus = async () => "pending" as Sandbox.GitSyncStatus
      const result = await gate.wait("read", "sandbox-1", "call-1", getSyncStatus)
      expect(result.allowed).toBe(true)
    })

    it("should return immediately when sync is complete", async () => {
      const getSyncStatus = async () => "synced" as Sandbox.GitSyncStatus
      const result = await gate.wait("edit", "sandbox-1", "call-1", getSyncStatus)
      expect(result.allowed).toBe(true)
    })

    it("should wait and succeed when sync completes", async () => {
      let callCount = 0
      const getSyncStatus = async (): Promise<Sandbox.GitSyncStatus> => {
        callCount++
        if (callCount >= 3) return "synced"
        return "syncing"
      }

      const result = await gate.wait("edit", "sandbox-1", "call-1", getSyncStatus)
      expect(result.allowed).toBe(true)
      expect(callCount).toBeGreaterThanOrEqual(3)
    })

    it("should fail when sync errors", async () => {
      let callCount = 0
      const getSyncStatus = async (): Promise<Sandbox.GitSyncStatus> => {
        callCount++
        if (callCount >= 2) return "error"
        return "syncing"
      }

      const result = await gate.wait("edit", "sandbox-1", "call-1", getSyncStatus)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("failed")
    })

    it("should timeout if sync never completes", async () => {
      const gate = new SyncGate({ enabled: true, retryInterval: 50, maxWaitTime: 200 })
      const getSyncStatus = async () => "syncing" as Sandbox.GitSyncStatus

      const result = await gate.wait("edit", "sandbox-1", "call-1", getSyncStatus)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("did not complete")
    })

    it("should track pending edits during wait", async () => {
      let checkCount = 0
      let resolveWait: () => void
      const blockPromise = new Promise<void>((resolve) => {
        resolveWait = resolve
      })

      const getSyncStatus = async (): Promise<Sandbox.GitSyncStatus> => {
        checkCount++
        // First check returns syncing to trigger pending tracking
        if (checkCount === 1) return "syncing"
        // Block on subsequent checks until we resolve
        await blockPromise
        return "synced"
      }

      const waitPromiseStarted = gate.wait("edit", "sandbox-1", "call-1", getSyncStatus)

      // Give it a moment to do the first check and get blocked
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Check pending edits - should be tracked now
      const pending = gate.getPendingEdits("sandbox-1")
      expect(pending.length).toBe(1)
      expect(pending[0].tool).toBe("edit")
      expect(pending[0].callID).toBe("call-1")

      // Resolve and wait for completion
      resolveWait!()
      await waitPromiseStarted

      // Pending should be cleared
      expect(gate.getPendingEdits("sandbox-1").length).toBe(0)
    })
  })

  describe("notify methods", () => {
    it("should clear pending edits on sync complete", async () => {
      // Add a pending edit manually by starting a wait
      let blockSync = true
      const getSyncStatus = async (): Promise<Sandbox.GitSyncStatus> => {
        if (blockSync) return "syncing"
        return "synced"
      }

      // Start wait (will block)
      const waitPromise = gate.wait("edit", "sandbox-1", "call-1", getSyncStatus)

      // Give it time to register as pending
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(gate.getPendingCount()).toBe(1)

      // Unblock and notify
      blockSync = false
      gate.notifySyncComplete("sandbox-1")

      // Wait should complete
      await waitPromise

      expect(gate.getPendingCount()).toBe(0)
    })
  })

  describe("tool classification", () => {
    it("should classify read-only tools correctly", () => {
      expect(gate.classify("read")).toBe("readonly")
      expect(gate.classify("glob")).toBe("readonly")
      expect(gate.classify("grep")).toBe("readonly")
      expect(gate.classify("ls")).toBe("readonly")
    })

    it("should classify write tools correctly", () => {
      expect(gate.classify("edit")).toBe("write")
      expect(gate.classify("write")).toBe("write")
      expect(gate.classify("patch")).toBe("write")
      expect(gate.classify("bash")).toBe("write")
    })

    it("should classify unknown tools correctly", () => {
      expect(gate.classify("something_new")).toBe("unknown")
    })

    it("isReadonly should return correct type guard", () => {
      expect(gate.isReadonly("read")).toBe(true)
      expect(gate.isReadonly("edit")).toBe(false)
    })

    it("isWrite should return correct type guard", () => {
      expect(gate.isWrite("edit")).toBe(true)
      expect(gate.isWrite("read")).toBe(false)
    })
  })

  describe("TLA+ invariants", () => {
    it("reads always proceed regardless of sync status", () => {
      const statuses: Sandbox.GitSyncStatus[] = ["pending", "syncing", "synced", "error"]
      for (const status of statuses) {
        for (const tool of READONLY_TOOLS) {
          const result = gate.check(tool, "sandbox-1", status)
          expect(result.allowed).toBe(true)
        }
      }
    })

    it("writes blocked until synced", () => {
      const blockingStatuses: Sandbox.GitSyncStatus[] = ["pending", "syncing"]
      for (const status of blockingStatuses) {
        for (const tool of WRITE_TOOLS) {
          const result = gate.check(tool, "sandbox-1", status)
          expect(result.allowed).toBe(false)
        }
      }

      // But allowed when synced
      for (const tool of WRITE_TOOLS) {
        const result = gate.check(tool, "sandbox-1", "synced")
        expect(result.allowed).toBe(true)
      }
    })
  })
})

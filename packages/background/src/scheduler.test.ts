import { describe, it, expect, beforeEach } from "bun:test"
import { AgentScheduler, type SchedulerStats } from "./scheduler"
import type { Agent, AgentEvent } from "./agent"

describe("AgentScheduler", () => {
  let scheduler: AgentScheduler

  beforeEach(() => {
    scheduler = new AgentScheduler({
      limits: {
        maxConcurrent: 3,
        maxQueued: 10,
        maxPerSession: 5,
      },
    })
  })

  describe("spawn()", () => {
    it("should create a new agent", () => {
      const result = scheduler.spawn({
        parentSessionID: "session_1",
        task: "do something",
      })

      expect(result.success).toBe(true)
      expect(result.agent).toBeDefined()
      expect(result.agent?.status).toBe("queued")
    })

    it("should reject when queue is full", () => {
      const smallScheduler = new AgentScheduler({
        limits: { maxQueued: 2 },
      })

      smallScheduler.spawn({ parentSessionID: "s1", task: "task1" })
      smallScheduler.spawn({ parentSessionID: "s1", task: "task2" })
      const result = smallScheduler.spawn({ parentSessionID: "s1", task: "task3" })

      expect(result.success).toBe(false)
      expect(result.error).toContain("Queue full")
    })

    it("should reject when session limit reached", () => {
      const smallScheduler = new AgentScheduler({
        limits: { maxPerSession: 2 },
      })

      smallScheduler.spawn({ parentSessionID: "s1", task: "task1" })
      smallScheduler.spawn({ parentSessionID: "s1", task: "task2" })
      const result = smallScheduler.spawn({ parentSessionID: "s1", task: "task3" })

      expect(result.success).toBe(false)
      expect(result.error).toContain("Session limit reached")

      // But another session should work
      const result2 = smallScheduler.spawn({ parentSessionID: "s2", task: "task1" })
      expect(result2.success).toBe(true)
    })
  })

  describe("cancel()", () => {
    it("should cancel a queued agent", () => {
      const result = scheduler.spawn({ parentSessionID: "s1", task: "task1" })
      expect(result.agent).toBeDefined()

      const cancelled = scheduler.cancel(result.agent!.id)
      expect(cancelled).toBe(true)
      expect(scheduler.get(result.agent!.id)?.status).toBe("cancelled")
    })

    it("should return false for non-existent agent", () => {
      const cancelled = scheduler.cancel("non_existent")
      expect(cancelled).toBe(false)
    })
  })

  describe("query methods", () => {
    beforeEach(() => {
      // Spawn several agents
      scheduler.spawn({ parentSessionID: "s1", task: "task1" })
      scheduler.spawn({ parentSessionID: "s1", task: "task2" })
      scheduler.spawn({ parentSessionID: "s2", task: "task3" })
    })

    it("get() should return agent by ID", () => {
      const result = scheduler.spawn({ parentSessionID: "s1", task: "task4" })
      const agent = scheduler.get(result.agent!.id)
      expect(agent).toBeDefined()
      expect(agent?.task).toBe("task4")
    })

    it("all() should return all agents", () => {
      expect(scheduler.all().length).toBe(3)
    })

    it("byParentSession() should filter by session", () => {
      expect(scheduler.byParentSession("s1").length).toBe(2)
      expect(scheduler.byParentSession("s2").length).toBe(1)
    })

    it("queuedCount() should return queued count", () => {
      expect(scheduler.queuedCount()).toBe(3)
    })
  })

  describe("capacity checks", () => {
    it("canSpawn() should check queue space", () => {
      const smallScheduler = new AgentScheduler({
        limits: { maxQueued: 2 },
      })

      expect(smallScheduler.canSpawn()).toBe(true)
      smallScheduler.spawn({ parentSessionID: "s1", task: "task1" })
      expect(smallScheduler.canSpawn()).toBe(true)
      smallScheduler.spawn({ parentSessionID: "s1", task: "task2" })
      expect(smallScheduler.canSpawn()).toBe(false)
    })

    it("hasCapacity() should check concurrent limit", () => {
      expect(scheduler.hasCapacity()).toBe(true)
      // Initially no agents are running (no callbacks set), so capacity is available
    })
  })

  describe("stats()", () => {
    it("should return accurate statistics", () => {
      scheduler.spawn({ parentSessionID: "s1", task: "task1" })
      scheduler.spawn({ parentSessionID: "s1", task: "task2" })
      const result = scheduler.spawn({ parentSessionID: "s1", task: "task3" })
      scheduler.cancel(result.agent!.id)

      const stats = scheduler.stats()

      expect(stats.total).toBe(3)
      expect(stats.queued).toBe(2) // 2 still queued
      expect(stats.cancelled).toBe(1)
      expect(stats.queueSpace).toBe(8) // 10 - 2 queued
    })
  })

  describe("events", () => {
    it("should forward events from spawner", () => {
      const events: AgentEvent[] = []
      scheduler.subscribe((e) => events.push(e))

      scheduler.spawn({ parentSessionID: "s1", task: "task1" })

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("spawned")
    })

    it("unsubscribe should stop events", () => {
      const events: AgentEvent[] = []
      const unsubscribe = scheduler.subscribe((e) => events.push(e))

      scheduler.spawn({ parentSessionID: "s1", task: "task1" })
      expect(events.length).toBe(1)

      unsubscribe()
      scheduler.spawn({ parentSessionID: "s1", task: "task2" })
      expect(events.length).toBe(1)
    })
  })

  describe("lifecycle with callbacks", () => {
    it("should process agents through lifecycle when callbacks provided", async () => {
      const autoScheduler = new AgentScheduler({
        autoProcess: true,
        limits: { maxConcurrent: 3, maxQueued: 10, maxPerSession: 5 },
      })

      const events: AgentEvent[] = []
      autoScheduler.subscribe((e) => events.push(e))

      autoScheduler.onInitialize(async (agent) => {
        return { sandboxID: `sandbox_${agent.id}` }
      })

      autoScheduler.onRun(async (agent) => {
        return { output: { task: agent.task, done: true } }
      })

      const result = autoScheduler.spawn({ parentSessionID: "s1", task: "task1" })

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100))

      const agent = autoScheduler.get(result.agent!.id)
      expect(agent?.status).toBe("completed")
      expect(agent?.sandboxID).toContain("sandbox_")
      expect(agent?.output).toEqual({ task: "task1", done: true })

      // Check events
      const eventTypes = events.map((e) => e.type)
      expect(eventTypes).toContain("spawned")
      expect(eventTypes).toContain("initializing")
      expect(eventTypes).toContain("running")
      expect(eventTypes).toContain("completed")
    })

    it("should handle initialization failure", async () => {
      const autoScheduler = new AgentScheduler({
        autoProcess: true,
        limits: { maxConcurrent: 3, maxQueued: 10, maxPerSession: 5 },
      })

      const events: AgentEvent[] = []
      autoScheduler.subscribe((e) => events.push(e))

      autoScheduler.onInitialize(async () => {
        return { error: "Failed to create sandbox" }
      })

      const result = autoScheduler.spawn({ parentSessionID: "s1", task: "task1" })

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100))

      const agent = autoScheduler.get(result.agent!.id)
      expect(agent?.status).toBe("failed")
      expect(agent?.error).toBe("Failed to create sandbox")
    })

    it("should handle run failure", async () => {
      const autoScheduler = new AgentScheduler({
        autoProcess: true,
        limits: { maxConcurrent: 3, maxQueued: 10, maxPerSession: 5 },
      })

      autoScheduler.onInitialize(async (agent) => {
        return { sandboxID: `sandbox_${agent.id}` }
      })

      autoScheduler.onRun(async () => {
        return { error: "Task execution failed" }
      })

      const result = autoScheduler.spawn({ parentSessionID: "s1", task: "task1" })

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 100))

      const agent = autoScheduler.get(result.agent!.id)
      expect(agent?.status).toBe("failed")
      expect(agent?.error).toBe("Task execution failed")
    })

    it("should respect concurrent limit", async () => {
      const smallScheduler = new AgentScheduler({
        autoProcess: true,
        limits: { maxConcurrent: 2 },
      })

      let runningCount = 0
      let maxRunning = 0

      smallScheduler.onInitialize(async (agent) => {
        return { sandboxID: `sandbox_${agent.id}` }
      })

      smallScheduler.onRun(async () => {
        runningCount++
        maxRunning = Math.max(maxRunning, runningCount)
        await new Promise((resolve) => setTimeout(resolve, 50))
        runningCount--
        return { output: "done" }
      })

      // Spawn more than the concurrent limit
      smallScheduler.spawn({ parentSessionID: "s1", task: "task1" })
      smallScheduler.spawn({ parentSessionID: "s1", task: "task2" })
      smallScheduler.spawn({ parentSessionID: "s1", task: "task3" })

      // Wait for all to complete
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Max running should never exceed concurrent limit
      expect(maxRunning).toBeLessThanOrEqual(2)
    })
  })

  describe("cleanup()", () => {
    it("should remove terminated agents", async () => {
      const autoScheduler = new AgentScheduler({
        autoProcess: true,
        limits: { maxConcurrent: 3, maxQueued: 10, maxPerSession: 5 },
      })

      autoScheduler.onInitialize(async (agent) => ({ sandboxID: `s_${agent.id}` }))
      autoScheduler.onRun(async () => ({ output: "done" }))

      autoScheduler.spawn({ parentSessionID: "s1", task: "task1" })
      autoScheduler.spawn({ parentSessionID: "s1", task: "task2" })

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(autoScheduler.all().length).toBe(2)

      const cleaned = autoScheduler.cleanup()
      expect(cleaned).toBe(2)
      expect(autoScheduler.all().length).toBe(0)
    })
  })

  describe("TLA+ invariants", () => {
    it("MaxBackgroundAgents: never exceed configured limits", () => {
      const limitedScheduler = new AgentScheduler({
        limits: { maxQueued: 3 },
      })

      for (let i = 0; i < 5; i++) {
        limitedScheduler.spawn({ parentSessionID: "s1", task: `task${i}` })
      }

      // Should have at most 3 queued
      expect(limitedScheduler.queuedCount()).toBeLessThanOrEqual(3)
    })

    it("resource limits are respected across sessions", () => {
      const limitedScheduler = new AgentScheduler({
        limits: { maxPerSession: 2, maxQueued: 10 },
      })

      // Fill up session 1
      limitedScheduler.spawn({ parentSessionID: "s1", task: "task1" })
      limitedScheduler.spawn({ parentSessionID: "s1", task: "task2" })
      const s1Result = limitedScheduler.spawn({ parentSessionID: "s1", task: "task3" })

      expect(s1Result.success).toBe(false)

      // Session 2 should still work
      const s2Result = limitedScheduler.spawn({ parentSessionID: "s2", task: "task1" })
      expect(s2Result.success).toBe(true)

      expect(limitedScheduler.byParentSession("s1").length).toBe(2)
      expect(limitedScheduler.byParentSession("s2").length).toBe(1)
    })
  })
})

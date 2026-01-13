import { describe, it, expect, beforeEach } from "bun:test"
import { AgentSpawner } from "./spawner"
import type { Agent, AgentEvent, AgentStatus } from "./agent"

describe("AgentSpawner", () => {
  let spawner: AgentSpawner

  beforeEach(() => {
    spawner = new AgentSpawner({ maxAgents: 10 })
  })

  describe("spawn()", () => {
    it("should create a new agent in queued status", () => {
      const agent = spawner.spawn({
        parentSessionID: "session_1",
        task: "do something",
      })

      expect(agent.id).toMatch(/^agent_/)
      expect(agent.parentSessionID).toBe("session_1")
      expect(agent.sessionID).toMatch(/^agent_session_/)
      expect(agent.status).toBe("queued")
      expect(agent.task).toBe("do something")
      expect(agent.sandboxID).toBeUndefined()
      expect(agent.createdAt).toBeGreaterThan(0)
    })

    it("should generate unique IDs for each agent", () => {
      const agent1 = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      const agent2 = spawner.spawn({ parentSessionID: "s1", task: "task2" })

      expect(agent1.id).not.toBe(agent2.id)
      expect(agent1.sessionID).not.toBe(agent2.sessionID)
    })

    it("should emit spawned event", () => {
      const events: AgentEvent[] = []
      spawner.subscribe((e) => events.push(e))

      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("spawned")
      expect((events[0] as { type: "spawned"; agent: Agent }).agent.id).toBe(agent.id)
    })

    it("should throw when max agents limit reached", () => {
      const smallSpawner = new AgentSpawner({ maxAgents: 2 })

      smallSpawner.spawn({ parentSessionID: "s1", task: "task1" })
      smallSpawner.spawn({ parentSessionID: "s1", task: "task2" })

      expect(() => smallSpawner.spawn({ parentSessionID: "s1", task: "task3" })).toThrow(
        "Maximum agents limit reached",
      )
    })
  })

  describe("transition()", () => {
    it("should allow valid transition from queued to initializing", () => {
      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })

      const result = spawner.transition(agent.id, "initializing", { sandboxID: "sandbox_1" })

      expect(result).toBe(true)
      expect(spawner.get(agent.id)?.status).toBe("initializing")
      expect(spawner.get(agent.id)?.sandboxID).toBe("sandbox_1")
      expect(spawner.get(agent.id)?.startedAt).toBeGreaterThan(0)
    })

    it("should allow valid transition from initializing to running", () => {
      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      spawner.transition(agent.id, "initializing", { sandboxID: "sandbox_1" })

      const result = spawner.transition(agent.id, "running")

      expect(result).toBe(true)
      expect(spawner.get(agent.id)?.status).toBe("running")
    })

    it("should allow valid transition from running to completed", () => {
      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      spawner.transition(agent.id, "initializing", { sandboxID: "sandbox_1" })
      spawner.transition(agent.id, "running")

      const result = spawner.transition(agent.id, "completed", { output: { result: "success" } })

      expect(result).toBe(true)
      expect(spawner.get(agent.id)?.status).toBe("completed")
      expect(spawner.get(agent.id)?.completedAt).toBeGreaterThan(0)
      expect(spawner.get(agent.id)?.output).toEqual({ result: "success" })
    })

    it("should block invalid transition", () => {
      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })

      // Can't go directly from queued to running
      const result = spawner.transition(agent.id, "running")

      expect(result).toBe(false)
      expect(spawner.get(agent.id)?.status).toBe("queued")
    })

    it("should return false for non-existent agent", () => {
      const result = spawner.transition("non_existent", "running")
      expect(result).toBe(false)
    })
  })

  describe("helper transition methods", () => {
    it("startInitializing should set sandbox and transition", () => {
      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })

      const result = spawner.startInitializing(agent.id, "sandbox_123")

      expect(result).toBe(true)
      expect(spawner.get(agent.id)?.status).toBe("initializing")
      expect(spawner.get(agent.id)?.sandboxID).toBe("sandbox_123")
    })

    it("startRunning should transition from initializing", () => {
      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      spawner.startInitializing(agent.id, "sandbox_123")

      const result = spawner.startRunning(agent.id)

      expect(result).toBe(true)
      expect(spawner.get(agent.id)?.status).toBe("running")
    })

    it("complete should transition and set output", () => {
      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      spawner.startInitializing(agent.id, "sandbox_123")
      spawner.startRunning(agent.id)

      const result = spawner.complete(agent.id, { data: [1, 2, 3] })

      expect(result).toBe(true)
      expect(spawner.get(agent.id)?.status).toBe("completed")
      expect(spawner.get(agent.id)?.output).toEqual({ data: [1, 2, 3] })
    })

    it("fail should transition and set error", () => {
      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      spawner.startInitializing(agent.id, "sandbox_123")

      const result = spawner.fail(agent.id, "Something went wrong")

      expect(result).toBe(true)
      expect(spawner.get(agent.id)?.status).toBe("failed")
      expect(spawner.get(agent.id)?.error).toBe("Something went wrong")
    })

    it("cancel should work from any non-terminal state", () => {
      const agent1 = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      const agent2 = spawner.spawn({ parentSessionID: "s1", task: "task2" })
      const agent3 = spawner.spawn({ parentSessionID: "s1", task: "task3" })

      spawner.startInitializing(agent2.id, "sandbox_2")
      spawner.startInitializing(agent3.id, "sandbox_3")
      spawner.startRunning(agent3.id)

      expect(spawner.cancel(agent1.id)).toBe(true)
      expect(spawner.cancel(agent2.id)).toBe(true)
      expect(spawner.cancel(agent3.id)).toBe(true)

      expect(spawner.get(agent1.id)?.status).toBe("cancelled")
      expect(spawner.get(agent2.id)?.status).toBe("cancelled")
      expect(spawner.get(agent3.id)?.status).toBe("cancelled")
    })

    it("cancel should fail for terminal states", () => {
      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      spawner.startInitializing(agent.id, "sandbox_123")
      spawner.startRunning(agent.id)
      spawner.complete(agent.id)

      const result = spawner.cancel(agent.id)

      expect(result).toBe(false)
      expect(spawner.get(agent.id)?.status).toBe("completed")
    })
  })

  describe("query methods", () => {
    beforeEach(() => {
      // Create a mix of agents in different states
      const a1 = spawner.spawn({ parentSessionID: "session_1", task: "task1" })
      const a2 = spawner.spawn({ parentSessionID: "session_1", task: "task2" })
      const a3 = spawner.spawn({ parentSessionID: "session_2", task: "task3" })
      const a4 = spawner.spawn({ parentSessionID: "session_2", task: "task4" })
      const a5 = spawner.spawn({ parentSessionID: "session_2", task: "task5" })

      // a1: queued
      // a2: initializing
      spawner.startInitializing(a2.id, "sandbox_2")
      // a3: running
      spawner.startInitializing(a3.id, "sandbox_3")
      spawner.startRunning(a3.id)
      // a4: completed
      spawner.startInitializing(a4.id, "sandbox_4")
      spawner.startRunning(a4.id)
      spawner.complete(a4.id)
      // a5: failed
      spawner.startInitializing(a5.id, "sandbox_5")
      spawner.fail(a5.id, "error")
    })

    it("all() should return all agents", () => {
      expect(spawner.all().length).toBe(5)
    })

    it("byStatus() should filter by status", () => {
      expect(spawner.byStatus("queued").length).toBe(1)
      expect(spawner.byStatus("initializing").length).toBe(1)
      expect(spawner.byStatus("running").length).toBe(1)
      expect(spawner.byStatus("completed").length).toBe(1)
      expect(spawner.byStatus("failed").length).toBe(1)
    })

    it("byParentSession() should filter by parent session", () => {
      expect(spawner.byParentSession("session_1").length).toBe(2)
      expect(spawner.byParentSession("session_2").length).toBe(3)
      expect(spawner.byParentSession("unknown").length).toBe(0)
    })

    it("queued() should return queued agents", () => {
      const queued = spawner.queued()
      expect(queued.length).toBe(1)
      expect(queued[0].status).toBe("queued")
    })

    it("running() should return running agents", () => {
      const running = spawner.running()
      expect(running.length).toBe(1)
      expect(running[0].status).toBe("running")
    })

    it("activeCount() should count non-terminal agents", () => {
      // queued + initializing + running = 3
      expect(spawner.activeCount()).toBe(3)
    })

    it("count should return total agents", () => {
      expect(spawner.count).toBe(5)
    })
  })

  describe("cleanup methods", () => {
    it("remove() should only remove terminated agents", () => {
      const active = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      const completed = spawner.spawn({ parentSessionID: "s1", task: "task2" })
      spawner.startInitializing(completed.id, "sandbox")
      spawner.startRunning(completed.id)
      spawner.complete(completed.id)

      expect(spawner.remove(active.id)).toBe(false)
      expect(spawner.remove(completed.id)).toBe(true)
      expect(spawner.count).toBe(1)
    })

    it("clearTerminated() should remove all terminated agents", () => {
      const a1 = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      const a2 = spawner.spawn({ parentSessionID: "s1", task: "task2" })
      const a3 = spawner.spawn({ parentSessionID: "s1", task: "task3" })
      const a4 = spawner.spawn({ parentSessionID: "s1", task: "task4" })

      // Complete some
      spawner.startInitializing(a2.id, "s2")
      spawner.startRunning(a2.id)
      spawner.complete(a2.id)

      spawner.startInitializing(a3.id, "s3")
      spawner.fail(a3.id, "error")

      spawner.cancel(a4.id)

      const cleared = spawner.clearTerminated()

      expect(cleared).toBe(3) // completed, failed, cancelled
      expect(spawner.count).toBe(1) // only a1 (queued)
    })
  })

  describe("events", () => {
    it("should emit events for all transitions", () => {
      const events: AgentEvent[] = []
      spawner.subscribe((e) => events.push(e))

      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      spawner.startInitializing(agent.id, "sandbox")
      spawner.startRunning(agent.id)
      spawner.complete(agent.id, { result: "done" })

      expect(events.length).toBe(4)
      expect(events[0].type).toBe("spawned")
      expect(events[1].type).toBe("initializing")
      expect(events[2].type).toBe("running")
      expect(events[3].type).toBe("completed")
    })

    it("should emit failed event with error", () => {
      const events: AgentEvent[] = []
      spawner.subscribe((e) => events.push(e))

      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })
      spawner.startInitializing(agent.id, "sandbox")
      spawner.fail(agent.id, "Something broke")

      const failEvent = events.find((e) => e.type === "failed") as { type: "failed"; agent: Agent; error: string }
      expect(failEvent).toBeDefined()
      expect(failEvent.error).toBe("Something broke")
    })

    it("unsubscribe should stop events", () => {
      const events: AgentEvent[] = []
      const unsubscribe = spawner.subscribe((e) => events.push(e))

      spawner.spawn({ parentSessionID: "s1", task: "task1" })
      expect(events.length).toBe(1)

      unsubscribe()
      spawner.spawn({ parentSessionID: "s1", task: "task2" })
      expect(events.length).toBe(1) // No new events
    })
  })

  describe("TLA+ invariants", () => {
    it("ValidAgentStatusTransitions: all agents have valid status", () => {
      const validStatuses = ["queued", "initializing", "running", "completed", "failed", "cancelled"]

      spawner.spawn({ parentSessionID: "s1", task: "task1" })
      spawner.spawn({ parentSessionID: "s1", task: "task2" })
      const a3 = spawner.spawn({ parentSessionID: "s1", task: "task3" })
      spawner.startInitializing(a3.id, "sandbox")

      for (const agent of spawner.all()) {
        expect(validStatuses).toContain(agent.status)
      }
    })

    it("status transitions follow valid paths only", () => {
      const agent = spawner.spawn({ parentSessionID: "s1", task: "task1" })

      // Invalid: queued -> running
      expect(spawner.transition(agent.id, "running")).toBe(false)
      // Invalid: queued -> completed
      expect(spawner.transition(agent.id, "completed")).toBe(false)
      // Invalid: queued -> failed
      expect(spawner.transition(agent.id, "failed")).toBe(false)

      // Valid: queued -> initializing
      expect(spawner.transition(agent.id, "initializing", { sandboxID: "s1" })).toBe(true)

      // Invalid: initializing -> queued
      expect(spawner.transition(agent.id, "queued")).toBe(false)
      // Invalid: initializing -> completed
      expect(spawner.transition(agent.id, "completed")).toBe(false)

      // Valid: initializing -> running
      expect(spawner.transition(agent.id, "running")).toBe(true)

      // Valid: running -> completed
      expect(spawner.transition(agent.id, "completed")).toBe(true)

      // Terminal state - no more transitions
      expect(spawner.transition(agent.id, "running")).toBe(false)
      expect(spawner.transition(agent.id, "failed")).toBe(false)
    })
  })
})

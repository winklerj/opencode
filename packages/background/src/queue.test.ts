import { describe, it, expect, beforeEach } from "bun:test"
import { PromptQueue, type QueueEvent } from "./queue"

describe("PromptQueue", () => {
  let queue: PromptQueue

  beforeEach(() => {
    queue = new PromptQueue("session-1", { maxPrompts: 10, allowReorder: true })
  })

  describe("add()", () => {
    it("should add a prompt to the queue", () => {
      const prompt = queue.add("user-1", "Write tests")

      expect(prompt.id).toMatch(/^prompt_/)
      expect(prompt.sessionID).toBe("session-1")
      expect(prompt.userID).toBe("user-1")
      expect(prompt.content).toBe("Write tests")
      expect(prompt.status).toBe("queued")
      expect(prompt.priority).toBe("normal")
      expect(queue.length).toBe(1)
    })

    it("should respect priority ordering", () => {
      queue.add("user-1", "Normal task")
      queue.add("user-1", "High priority task", "high")
      queue.add("user-1", "Urgent task", "urgent")
      queue.add("user-1", "Another normal task")

      const all = queue.all()
      expect(all[0].content).toBe("Urgent task")
      expect(all[1].content).toBe("High priority task")
      expect(all[2].content).toBe("Normal task")
      expect(all[3].content).toBe("Another normal task")
    })

    it("should throw when queue is full", () => {
      for (let i = 0; i < 10; i++) {
        queue.add("user-1", `Task ${i}`)
      }

      expect(() => queue.add("user-1", "One more")).toThrow("Queue is full")
    })

    it("should emit added event", () => {
      const events: QueueEvent[] = []
      queue.subscribe((e) => events.push(e))

      queue.add("user-1", "Test")

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("added")
    })
  })

  describe("startNext()", () => {
    it("should start the first queued prompt", () => {
      queue.add("user-1", "First")
      queue.add("user-1", "Second")

      const started = queue.startNext()

      expect(started?.content).toBe("First")
      expect(started?.status).toBe("executing")
      expect(started?.startedAt).toBeDefined()
    })

    it("should return undefined when no prompts are queued", () => {
      const result = queue.startNext()
      expect(result).toBeUndefined()
    })

    it("should return undefined when a prompt is already executing", () => {
      queue.add("user-1", "First")
      queue.add("user-1", "Second")

      queue.startNext()
      const result = queue.startNext()

      expect(result).toBeUndefined()
    })

    it("should emit started event", () => {
      const events: QueueEvent[] = []
      queue.add("user-1", "Test")
      queue.subscribe((e) => events.push(e))

      queue.startNext()

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("started")
    })
  })

  describe("complete()", () => {
    it("should complete the executing prompt", () => {
      queue.add("user-1", "Task")
      queue.startNext()

      const completed = queue.complete()

      expect(completed?.content).toBe("Task")
      expect(completed?.status).toBe("completed")
      expect(completed?.completedAt).toBeDefined()
      expect(queue.length).toBe(0)
    })

    it("should return undefined when no prompt is executing", () => {
      queue.add("user-1", "Task")
      const result = queue.complete()
      expect(result).toBeUndefined()
    })

    it("should emit completed event", () => {
      const events: QueueEvent[] = []
      queue.add("user-1", "Test")
      queue.startNext()
      queue.subscribe((e) => events.push(e))

      queue.complete()

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("completed")
    })

    it("should allow starting next after completion", () => {
      queue.add("user-1", "First")
      queue.add("user-1", "Second")

      queue.startNext()
      queue.complete()
      const next = queue.startNext()

      expect(next?.content).toBe("Second")
    })
  })

  describe("cancel()", () => {
    it("should cancel a queued prompt", () => {
      const prompt = queue.add("user-1", "Task")

      const result = queue.cancel(prompt.id, "user-1")

      expect(result).toBe(true)
      expect(queue.length).toBe(0)
    })

    it("should not cancel executing prompts", () => {
      const prompt = queue.add("user-1", "Task")
      queue.startNext()

      const result = queue.cancel(prompt.id, "user-1")

      expect(result).toBe(false)
      expect(queue.length).toBe(1)
    })

    it("should only allow users to cancel their own prompts", () => {
      const prompt = queue.add("user-1", "Task")

      const result = queue.cancel(prompt.id, "user-2")

      expect(result).toBe(false)
      expect(queue.length).toBe(1)
    })

    it("should return false for non-existent prompt", () => {
      const result = queue.cancel("non-existent", "user-1")
      expect(result).toBe(false)
    })

    it("should emit cancelled event", () => {
      const events: QueueEvent[] = []
      const prompt = queue.add("user-1", "Test")
      queue.subscribe((e) => events.push(e))

      queue.cancel(prompt.id, "user-1")

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("cancelled")
    })
  })

  describe("reorder()", () => {
    it("should reorder a prompt to a new position", () => {
      queue.add("user-1", "First")
      const second = queue.add("user-1", "Second")
      queue.add("user-1", "Third")

      const result = queue.reorder(second.id, "user-1", 0)

      expect(result).toBe(true)
      expect(queue.at(0)?.content).toBe("Second")
      expect(queue.at(1)?.content).toBe("First")
      expect(queue.at(2)?.content).toBe("Third")
    })

    it("should not reorder executing prompts", () => {
      const first = queue.add("user-1", "First")
      queue.add("user-1", "Second")
      queue.startNext()

      const result = queue.reorder(first.id, "user-1", 1)

      expect(result).toBe(false)
    })

    it("should not allow moving before executing prompt", () => {
      queue.add("user-1", "First")
      const second = queue.add("user-1", "Second")
      queue.startNext()

      const result = queue.reorder(second.id, "user-1", 0)

      expect(result).toBe(false)
    })

    it("should only allow users to reorder their own prompts", () => {
      const prompt = queue.add("user-1", "Task")
      queue.add("user-1", "Other")

      const result = queue.reorder(prompt.id, "user-2", 1)

      expect(result).toBe(false)
    })

    it("should respect allowReorder config", () => {
      const noReorderQueue = new PromptQueue("session-2", { allowReorder: false })
      const prompt = noReorderQueue.add("user-1", "Task")
      noReorderQueue.add("user-1", "Other")

      const result = noReorderQueue.reorder(prompt.id, "user-1", 1)

      expect(result).toBe(false)
    })

    it("should emit reordered event", () => {
      const events: QueueEvent[] = []
      queue.add("user-1", "First")
      const second = queue.add("user-1", "Second")
      queue.subscribe((e) => events.push(e))

      queue.reorder(second.id, "user-1", 0)

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("reordered")
      if (events[0].type === "reordered") {
        expect(events[0].from).toBe(1)
        expect(events[0].to).toBe(0)
      }
    })
  })

  describe("query methods", () => {
    it("should get prompt by ID", () => {
      const prompt = queue.add("user-1", "Task")
      expect(queue.get(prompt.id)).toBe(prompt)
      expect(queue.get("non-existent")).toBeUndefined()
    })

    it("should get all prompts", () => {
      queue.add("user-1", "First")
      queue.add("user-2", "Second")
      expect(queue.all().length).toBe(2)
    })

    it("should get queued prompts only", () => {
      queue.add("user-1", "First")
      queue.add("user-1", "Second")
      queue.startNext()

      expect(queue.queued().length).toBe(1)
      expect(queue.queued()[0].content).toBe("Second")
    })

    it("should get executing prompt", () => {
      queue.add("user-1", "Task")
      expect(queue.executing()).toBeUndefined()

      queue.startNext()
      expect(queue.executing()?.content).toBe("Task")
    })

    it("should get prompts by user", () => {
      queue.add("user-1", "User 1 task")
      queue.add("user-2", "User 2 task")
      queue.add("user-1", "Another user 1 task")

      expect(queue.byUser("user-1").length).toBe(2)
      expect(queue.byUser("user-2").length).toBe(1)
      expect(queue.byUser("user-3").length).toBe(0)
    })

    it("should report position", () => {
      const first = queue.add("user-1", "First")
      const second = queue.add("user-1", "Second")

      expect(queue.position(first.id)).toBe(0)
      expect(queue.position(second.id)).toBe(1)
      expect(queue.position("non-existent")).toBe(-1)
    })

    it("should check empty and full states", () => {
      expect(queue.isEmpty()).toBe(true)
      expect(queue.isFull()).toBe(false)

      for (let i = 0; i < 10; i++) {
        queue.add("user-1", `Task ${i}`)
      }

      expect(queue.isEmpty()).toBe(false)
      expect(queue.isFull()).toBe(true)
    })
  })

  describe("clear()", () => {
    it("should remove all prompts", () => {
      queue.add("user-1", "First")
      queue.add("user-1", "Second")
      queue.startNext()

      queue.clear()

      expect(queue.length).toBe(0)
      expect(queue.isEmpty()).toBe(true)
    })

    it("should emit cleared event", () => {
      const events: QueueEvent[] = []
      queue.add("user-1", "Task")
      queue.subscribe((e) => events.push(e))

      queue.clear()

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("cleared")
    })
  })

  describe("TLA+ invariants", () => {
    it("OnePromptExecutingPerSession: at most one prompt executing", () => {
      queue.add("user-1", "First")
      queue.add("user-1", "Second")
      queue.add("user-1", "Third")

      queue.startNext()

      const executingCount = queue.all().filter((p) => p.status === "executing").length
      expect(executingCount).toBe(1)

      // Try to start another - should fail
      const result = queue.startNext()
      expect(result).toBeUndefined()

      // Still only one executing
      expect(queue.all().filter((p) => p.status === "executing").length).toBe(1)
    })

    it("users can only cancel their own prompts", () => {
      const prompt = queue.add("user-1", "Task")

      // User-2 cannot cancel user-1's prompt
      expect(queue.cancel(prompt.id, "user-2")).toBe(false)

      // User-1 can cancel their own prompt
      expect(queue.cancel(prompt.id, "user-1")).toBe(true)
    })

    it("FIFO ordering within priority levels", () => {
      queue.add("user-1", "Normal 1")
      queue.add("user-1", "Normal 2")
      queue.add("user-1", "Normal 3")

      // Should process in order
      expect(queue.startNext()?.content).toBe("Normal 1")
      queue.complete()
      expect(queue.startNext()?.content).toBe("Normal 2")
      queue.complete()
      expect(queue.startNext()?.content).toBe("Normal 3")
    })

    it("higher priority prompts execute before lower priority", () => {
      queue.add("user-1", "Normal task")
      queue.add("user-1", "High priority task", "high")
      queue.add("user-1", "Urgent task", "urgent")

      // Urgent first
      expect(queue.startNext()?.content).toBe("Urgent task")
      queue.complete()

      // High next
      expect(queue.startNext()?.content).toBe("High priority task")
      queue.complete()

      // Normal last
      expect(queue.startNext()?.content).toBe("Normal task")
    })
  })
})

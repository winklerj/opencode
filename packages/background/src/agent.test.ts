import { describe, it, expect } from "bun:test"
import {
  AgentStatus,
  Agent,
  SpawnInput,
  SchedulerConfig,
  VALID_TRANSITIONS,
  isValidTransition,
  isTerminal,
  TERMINAL_STATUSES,
} from "./agent"

describe("Agent Types", () => {
  describe("AgentStatus", () => {
    it("should have all expected statuses", () => {
      expect(AgentStatus.options).toEqual(["queued", "initializing", "running", "completed", "failed", "cancelled"])
    })

    it("should parse valid statuses", () => {
      expect(AgentStatus.parse("queued")).toBe("queued")
      expect(AgentStatus.parse("initializing")).toBe("initializing")
      expect(AgentStatus.parse("running")).toBe("running")
      expect(AgentStatus.parse("completed")).toBe("completed")
      expect(AgentStatus.parse("failed")).toBe("failed")
      expect(AgentStatus.parse("cancelled")).toBe("cancelled")
    })

    it("should reject invalid statuses", () => {
      expect(() => AgentStatus.parse("invalid")).toThrow()
    })
  })

  describe("Agent schema", () => {
    it("should parse minimal agent", () => {
      const agent = Agent.parse({
        id: "agent_1",
        parentSessionID: "session_1",
        sessionID: "agent_session_1",
        status: "queued",
        task: "do something",
        createdAt: Date.now(),
      })
      expect(agent.id).toBe("agent_1")
      expect(agent.status).toBe("queued")
      expect(agent.sandboxID).toBeUndefined()
    })

    it("should parse full agent", () => {
      const agent = Agent.parse({
        id: "agent_1",
        parentSessionID: "session_1",
        sessionID: "agent_session_1",
        sandboxID: "sandbox_1",
        status: "completed",
        task: "do something",
        createdAt: 1000,
        startedAt: 2000,
        completedAt: 3000,
        output: { result: "success" },
      })
      expect(agent.sandboxID).toBe("sandbox_1")
      expect(agent.completedAt).toBe(3000)
      expect(agent.output).toEqual({ result: "success" })
    })

    it("should parse agent with error", () => {
      const agent = Agent.parse({
        id: "agent_1",
        parentSessionID: "session_1",
        sessionID: "agent_session_1",
        status: "failed",
        task: "do something",
        createdAt: 1000,
        error: "Something went wrong",
      })
      expect(agent.error).toBe("Something went wrong")
    })
  })

  describe("SpawnInput schema", () => {
    it("should parse minimal input", () => {
      const input = SpawnInput.parse({
        parentSessionID: "session_1",
        task: "do something",
      })
      expect(input.parentSessionID).toBe("session_1")
      expect(input.task).toBe("do something")
      expect(input.sandboxConfig).toBeUndefined()
    })

    it("should parse input with sandbox config", () => {
      const input = SpawnInput.parse({
        parentSessionID: "session_1",
        task: "do something",
        sandboxConfig: {
          repository: "owner/repo",
          branch: "main",
          imageTag: "v1.0",
        },
      })
      expect(input.sandboxConfig?.repository).toBe("owner/repo")
      expect(input.sandboxConfig?.branch).toBe("main")
    })
  })

  describe("SchedulerConfig schema", () => {
    it("should have sensible defaults", () => {
      const config = SchedulerConfig.parse({})
      expect(config.maxConcurrent).toBe(5)
      expect(config.maxQueued).toBe(100)
      expect(config.initTimeout).toBe(120000)
      expect(config.runTimeout).toBe(3600000)
    })

    it("should allow custom values", () => {
      const config = SchedulerConfig.parse({
        maxConcurrent: 10,
        maxQueued: 50,
        initTimeout: 60000,
        runTimeout: 1800000,
      })
      expect(config.maxConcurrent).toBe(10)
      expect(config.maxQueued).toBe(50)
    })
  })
})

describe("Status Transitions", () => {
  describe("VALID_TRANSITIONS", () => {
    it("queued can only transition to initializing or cancelled", () => {
      expect(VALID_TRANSITIONS.queued).toEqual(["initializing", "cancelled"])
    })

    it("initializing can transition to running, failed, or cancelled", () => {
      expect(VALID_TRANSITIONS.initializing).toEqual(["running", "failed", "cancelled"])
    })

    it("running can transition to completed, failed, or cancelled", () => {
      expect(VALID_TRANSITIONS.running).toEqual(["completed", "failed", "cancelled"])
    })

    it("terminal states have no valid transitions", () => {
      expect(VALID_TRANSITIONS.completed).toEqual([])
      expect(VALID_TRANSITIONS.failed).toEqual([])
      expect(VALID_TRANSITIONS.cancelled).toEqual([])
    })
  })

  describe("isValidTransition", () => {
    it("should allow valid transitions from queued", () => {
      expect(isValidTransition("queued", "initializing")).toBe(true)
      expect(isValidTransition("queued", "cancelled")).toBe(true)
    })

    it("should block invalid transitions from queued", () => {
      expect(isValidTransition("queued", "running")).toBe(false)
      expect(isValidTransition("queued", "completed")).toBe(false)
      expect(isValidTransition("queued", "failed")).toBe(false)
    })

    it("should allow valid transitions from initializing", () => {
      expect(isValidTransition("initializing", "running")).toBe(true)
      expect(isValidTransition("initializing", "failed")).toBe(true)
      expect(isValidTransition("initializing", "cancelled")).toBe(true)
    })

    it("should block invalid transitions from initializing", () => {
      expect(isValidTransition("initializing", "queued")).toBe(false)
      expect(isValidTransition("initializing", "completed")).toBe(false)
    })

    it("should allow valid transitions from running", () => {
      expect(isValidTransition("running", "completed")).toBe(true)
      expect(isValidTransition("running", "failed")).toBe(true)
      expect(isValidTransition("running", "cancelled")).toBe(true)
    })

    it("should block invalid transitions from running", () => {
      expect(isValidTransition("running", "queued")).toBe(false)
      expect(isValidTransition("running", "initializing")).toBe(false)
    })

    it("should block all transitions from terminal states", () => {
      for (const terminal of TERMINAL_STATUSES) {
        for (const status of AgentStatus.options) {
          expect(isValidTransition(terminal, status)).toBe(false)
        }
      }
    })
  })

  describe("isTerminal", () => {
    it("should identify terminal states", () => {
      expect(isTerminal("completed")).toBe(true)
      expect(isTerminal("failed")).toBe(true)
      expect(isTerminal("cancelled")).toBe(true)
    })

    it("should identify non-terminal states", () => {
      expect(isTerminal("queued")).toBe(false)
      expect(isTerminal("initializing")).toBe(false)
      expect(isTerminal("running")).toBe(false)
    })
  })

  describe("TERMINAL_STATUSES", () => {
    it("should contain all terminal states", () => {
      expect(TERMINAL_STATUSES).toContain("completed")
      expect(TERMINAL_STATUSES).toContain("failed")
      expect(TERMINAL_STATUSES).toContain("cancelled")
    })

    it("should not contain active states", () => {
      expect(TERMINAL_STATUSES).not.toContain("queued")
      expect(TERMINAL_STATUSES).not.toContain("initializing")
      expect(TERMINAL_STATUSES).not.toContain("running")
    })
  })
})

describe("TLA+ Invariants", () => {
  describe("ValidAgentStatusTransitions", () => {
    it("all defined statuses should be in AgentStatus enum", () => {
      const allStatuses = Object.keys(VALID_TRANSITIONS)
      for (const status of allStatuses) {
        expect(AgentStatus.options).toContain(status)
      }
    })

    it("all transition targets should be valid statuses", () => {
      for (const [, targets] of Object.entries(VALID_TRANSITIONS)) {
        for (const target of targets) {
          expect(AgentStatus.options).toContain(target)
        }
      }
    })

    it("no status should transition to queued (initial state only)", () => {
      for (const [, targets] of Object.entries(VALID_TRANSITIONS)) {
        expect(targets).not.toContain("queued")
      }
    })
  })
})

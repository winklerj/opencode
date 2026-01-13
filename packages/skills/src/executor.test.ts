import { describe, it, expect, beforeEach } from "bun:test"
import { SkillsExecutor, type ExecutionContext } from "./executor"
import { SkillsRegistry } from "./registry"
import type { Skill, SkillEvent } from "./skill"

describe("SkillsExecutor", () => {
  let registry: SkillsRegistry
  let executor: SkillsExecutor

  const testSkill: Skill = {
    name: "test-skill",
    description: "A test skill",
    category: "custom",
    prompt: "Test prompt instructions",
    tools: ["read", "grep"],
    model: "claude-sonnet-4-20250514",
    builtin: false,
  }

  beforeEach(() => {
    registry = new SkillsRegistry()
    registry.register(testSkill)
    executor = new SkillsExecutor(registry)
  })

  describe("prepare", () => {
    it("should prepare skill with prompt and configuration", () => {
      const result = executor.prepare({
        skillName: "test-skill",
        sessionID: "session-1",
      })

      expect(result).not.toBeNull()
      expect(result?.skill).toEqual(testSkill)
      expect(result?.prompt).toContain("## Skill: test-skill")
      expect(result?.prompt).toContain("Test prompt instructions")
      expect(result?.model).toBe("claude-sonnet-4-20250514")
      expect(result?.tools).toEqual(["read", "grep"])
    })

    it("should include context in prompt when provided", () => {
      const result = executor.prepare({
        skillName: "test-skill",
        sessionID: "session-1",
        context: "Additional context here",
      })

      expect(result?.prompt).toContain("## Context")
      expect(result?.prompt).toContain("Additional context here")
    })

    it("should override model when specified in input", () => {
      const result = executor.prepare({
        skillName: "test-skill",
        sessionID: "session-1",
        model: "claude-opus-4-20250514",
      })

      expect(result?.model).toBe("claude-opus-4-20250514")
    })

    it("should return null for unknown skill", () => {
      const result = executor.prepare({
        skillName: "unknown-skill",
        sessionID: "session-1",
      })

      expect(result).toBeNull()
    })

    it("should use default model when skill has no model", () => {
      const noModelSkill: Skill = {
        name: "no-model-skill",
        description: "Skill without model",
        category: "custom",
        prompt: "Prompt",
        builtin: false,
      }
      registry.register(noModelSkill)

      const result = executor.prepare({
        skillName: "no-model-skill",
        sessionID: "session-1",
      })

      expect(result?.model).toBe("claude-sonnet-4-20250514")
    })
  })

  describe("invoke", () => {
    it("should invoke skill and emit events", async () => {
      const events: SkillEvent[] = []
      const ctx: ExecutionContext = {
        sessionID: "session-1",
        onEvent: (event) => events.push(event),
      }

      const result = await executor.invoke(
        {
          skillName: "test-skill",
          sessionID: "session-1",
        },
        ctx,
      )

      expect(result.success).toBe(true)
      expect(result.output).toContain("## Skill: test-skill")

      // Check events were emitted
      expect(events).toHaveLength(3)
      expect(events[0].type).toBe("invoked")
      expect(events[1].type).toBe("running")
      expect(events[2].type).toBe("completed")
    })

    it("should fail for unknown skill", async () => {
      const events: SkillEvent[] = []
      const ctx: ExecutionContext = {
        sessionID: "session-1",
        onEvent: (event) => events.push(event),
      }

      const result = await executor.invoke(
        {
          skillName: "unknown-skill",
          sessionID: "session-1",
        },
        ctx,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain("not found")

      // Check failure event was emitted
      expect(events.some((e) => e.type === "failed")).toBe(true)
    })

    it("should work without event handler", async () => {
      const ctx: ExecutionContext = {
        sessionID: "session-1",
      }

      const result = await executor.invoke(
        {
          skillName: "test-skill",
          sessionID: "session-1",
        },
        ctx,
      )

      expect(result.success).toBe(true)
    })
  })

  describe("listSkills", () => {
    it("should list all skills from registry", () => {
      const skills = executor.listSkills()
      expect(skills).toHaveLength(1)
      expect(skills[0].name).toBe("test-skill")
    })
  })

  describe("getSkill", () => {
    it("should get skill by name", () => {
      const skill = executor.getSkill("test-skill")
      expect(skill).toEqual(testSkill)
    })

    it("should return undefined for unknown skill", () => {
      expect(executor.getSkill("unknown")).toBeUndefined()
    })
  })
})

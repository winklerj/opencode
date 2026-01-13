import { describe, it, expect, beforeEach } from "bun:test"
import { SkillsRegistry } from "./registry"
import type { Skill } from "./skill"

describe("SkillsRegistry", () => {
  let registry: SkillsRegistry

  const testSkill: Skill = {
    name: "test-skill",
    description: "A test skill",
    category: "custom",
    prompt: "Test prompt",
    builtin: false,
  }

  const anotherSkill: Skill = {
    name: "another-skill",
    description: "Another test skill",
    category: "review",
    prompt: "Another prompt",
    builtin: true,
  }

  beforeEach(() => {
    registry = new SkillsRegistry()
  })

  describe("register", () => {
    it("should register a skill", () => {
      registry.register(testSkill)
      expect(registry.has("test-skill")).toBe(true)
    })

    it("should overwrite existing skill with same name", () => {
      registry.register(testSkill)
      const updatedSkill = { ...testSkill, description: "Updated" }
      registry.register(updatedSkill)
      expect(registry.get("test-skill")?.description).toBe("Updated")
    })
  })

  describe("registerAll", () => {
    it("should register multiple skills", () => {
      registry.registerAll([testSkill, anotherSkill])
      expect(registry.count()).toBe(2)
    })
  })

  describe("get", () => {
    it("should return skill by name", () => {
      registry.register(testSkill)
      const skill = registry.get("test-skill")
      expect(skill).toEqual(testSkill)
    })

    it("should return undefined for unknown skill", () => {
      expect(registry.get("unknown")).toBeUndefined()
    })
  })

  describe("has", () => {
    it("should return true for registered skill", () => {
      registry.register(testSkill)
      expect(registry.has("test-skill")).toBe(true)
    })

    it("should return false for unknown skill", () => {
      expect(registry.has("unknown")).toBe(false)
    })
  })

  describe("unregister", () => {
    it("should remove skill from registry", () => {
      registry.register(testSkill)
      const removed = registry.unregister("test-skill")
      expect(removed).toBe(true)
      expect(registry.has("test-skill")).toBe(false)
    })

    it("should return false when skill not found", () => {
      expect(registry.unregister("unknown")).toBe(false)
    })
  })

  describe("list", () => {
    it("should return all registered skills", () => {
      registry.registerAll([testSkill, anotherSkill])
      const skills = registry.list()
      expect(skills).toHaveLength(2)
      expect(skills).toContainEqual(testSkill)
      expect(skills).toContainEqual(anotherSkill)
    })

    it("should return empty array when no skills", () => {
      expect(registry.list()).toEqual([])
    })
  })

  describe("listByCategory", () => {
    it("should return skills matching category", () => {
      registry.registerAll([testSkill, anotherSkill])
      const reviewSkills = registry.listByCategory("review")
      expect(reviewSkills).toHaveLength(1)
      expect(reviewSkills[0].name).toBe("another-skill")
    })

    it("should return empty array for no matches", () => {
      registry.register(testSkill)
      expect(registry.listByCategory("debugging")).toEqual([])
    })
  })

  describe("listBuiltin", () => {
    it("should return only builtin skills", () => {
      registry.registerAll([testSkill, anotherSkill])
      const builtinSkills = registry.listBuiltin()
      expect(builtinSkills).toHaveLength(1)
      expect(builtinSkills[0].name).toBe("another-skill")
    })
  })

  describe("listCustom", () => {
    it("should return only custom skills", () => {
      registry.registerAll([testSkill, anotherSkill])
      const customSkills = registry.listCustom()
      expect(customSkills).toHaveLength(1)
      expect(customSkills[0].name).toBe("test-skill")
    })
  })

  describe("count", () => {
    it("should return correct count", () => {
      expect(registry.count()).toBe(0)
      registry.register(testSkill)
      expect(registry.count()).toBe(1)
      registry.register(anotherSkill)
      expect(registry.count()).toBe(2)
    })
  })

  describe("clear", () => {
    it("should remove all skills", () => {
      registry.registerAll([testSkill, anotherSkill])
      registry.clear()
      expect(registry.count()).toBe(0)
    })
  })
})

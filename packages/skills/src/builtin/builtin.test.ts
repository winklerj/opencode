import { describe, it, expect } from "bun:test"
import {
  builtinSkills,
  codeReviewSkill,
  prDescriptionSkill,
  testGenerationSkill,
  bugFixSkill,
  featureImplSkill,
} from "./index"
import { Skill } from "../skill"

describe("Built-in Skills", () => {
  describe("builtinSkills", () => {
    it("should export all 5 built-in skills", () => {
      expect(builtinSkills).toHaveLength(5)
    })

    it("should all be marked as builtin", () => {
      for (const skill of builtinSkills) {
        expect(skill.builtin).toBe(true)
      }
    })

    it("should all be valid Skill objects", () => {
      for (const skill of builtinSkills) {
        const result = Skill.safeParse(skill)
        expect(result.success).toBe(true)
      }
    })
  })

  describe("codeReviewSkill", () => {
    it("should have correct name and category", () => {
      expect(codeReviewSkill.name).toBe("code-review")
      expect(codeReviewSkill.category).toBe("review")
    })

    it("should have read-only tools", () => {
      expect(codeReviewSkill.tools).toEqual(["read", "grep", "glob"])
    })

    it("should have comprehensive review prompt", () => {
      expect(codeReviewSkill.prompt).toContain("Security")
      expect(codeReviewSkill.prompt).toContain("Code Quality")
      expect(codeReviewSkill.prompt).toContain("Performance")
    })
  })

  describe("prDescriptionSkill", () => {
    it("should have correct name and category", () => {
      expect(prDescriptionSkill.name).toBe("pr-description")
      expect(prDescriptionSkill.category).toBe("generation")
    })

    it("should include computer_use for screenshots", () => {
      expect(prDescriptionSkill.tools).toContain("computer_use")
    })

    it("should include PR description format", () => {
      expect(prDescriptionSkill.prompt).toContain("Summary")
      expect(prDescriptionSkill.prompt).toContain("What Changed")
      expect(prDescriptionSkill.prompt).toContain("How to Test")
    })
  })

  describe("testGenerationSkill", () => {
    it("should have correct name and category", () => {
      expect(testGenerationSkill.name).toBe("test-generation")
      expect(testGenerationSkill.category).toBe("generation")
    })

    it("should include write and bash tools", () => {
      expect(testGenerationSkill.tools).toContain("write")
      expect(testGenerationSkill.tools).toContain("bash")
    })

    it("should cover test best practices", () => {
      expect(testGenerationSkill.prompt).toContain("Unit Tests")
      expect(testGenerationSkill.prompt).toContain("Edge Cases")
    })
  })

  describe("bugFixSkill", () => {
    it("should have correct name and category", () => {
      expect(bugFixSkill.name).toBe("bug-fix")
      expect(bugFixSkill.category).toBe("debugging")
    })

    it("should include edit tool for fixing", () => {
      expect(bugFixSkill.tools).toContain("edit")
    })

    it("should include debugging process", () => {
      expect(bugFixSkill.prompt).toContain("Reproduce")
      expect(bugFixSkill.prompt).toContain("Root Cause")
    })
  })

  describe("featureImplSkill", () => {
    it("should have correct name and category", () => {
      expect(featureImplSkill.name).toBe("feature-impl")
      expect(featureImplSkill.category).toBe("implementation")
    })

    it("should include all common tools", () => {
      expect(featureImplSkill.tools).toContain("read")
      expect(featureImplSkill.tools).toContain("write")
      expect(featureImplSkill.tools).toContain("edit")
      expect(featureImplSkill.tools).toContain("bash")
    })

    it("should cover implementation process", () => {
      expect(featureImplSkill.prompt).toContain("Requirements")
      expect(featureImplSkill.prompt).toContain("Design")
    })
  })
})

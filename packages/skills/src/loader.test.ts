import { describe, it, expect, beforeEach } from "bun:test"
import { SkillsLoader } from "./loader"
import { SkillsRegistry } from "./registry"

describe("SkillsLoader", () => {
  let loader: SkillsLoader

  beforeEach(() => {
    loader = new SkillsLoader()
  })

  describe("loadFromMarkdown", () => {
    it("should parse skill from markdown with frontmatter", () => {
      const markdown = `---
name: test-skill
description: A test skill
category: review
tools: [read, grep]
model: claude-sonnet-4-20250514
---

# System Prompt

This is the skill prompt.`

      const skill = loader.loadFromMarkdown(markdown)

      expect(skill).not.toBeNull()
      expect(skill?.name).toBe("test-skill")
      expect(skill?.description).toBe("A test skill")
      expect(skill?.category).toBe("review")
      expect(skill?.tools).toEqual(["read", "grep"])
      expect(skill?.model).toBe("claude-sonnet-4-20250514")
      expect(skill?.prompt).toContain("This is the skill prompt")
    })

    it("should default category to custom when not specified", () => {
      const markdown = `---
name: test-skill
description: A test skill
---

Prompt content`

      const skill = loader.loadFromMarkdown(markdown)

      expect(skill?.category).toBe("custom")
    })

    it("should set location when provided", () => {
      const markdown = `---
name: test-skill
description: A test skill
---

Prompt content`

      const skill = loader.loadFromMarkdown(markdown, "/path/to/skill.md")

      expect(skill?.location).toBe("/path/to/skill.md")
    })

    it("should handle builtin flag", () => {
      const markdown = `---
name: test-skill
description: A test skill
builtin: true
---

Prompt content`

      const skill = loader.loadFromMarkdown(markdown)

      expect(skill?.builtin).toBe(true)
    })

    it("should return null for markdown without frontmatter", () => {
      const markdown = `# Just a Heading

Some content without frontmatter.`

      const skill = loader.loadFromMarkdown(markdown)

      expect(skill).toBeNull()
    })

    it("should return null when name is missing", () => {
      const markdown = `---
description: A test skill
---

Prompt content`

      const skill = loader.loadFromMarkdown(markdown)

      expect(skill).toBeNull()
    })

    it("should return null when description is missing", () => {
      const markdown = `---
name: test-skill
---

Prompt content`

      const skill = loader.loadFromMarkdown(markdown)

      expect(skill).toBeNull()
    })

    it("should handle invalid category gracefully", () => {
      const markdown = `---
name: test-skill
description: A test skill
category: invalid-category
---

Prompt content`

      const skill = loader.loadFromMarkdown(markdown)

      expect(skill?.category).toBe("custom")
    })

    it("should ignore invalid tools", () => {
      const markdown = `---
name: test-skill
description: A test skill
tools: [read, invalid-tool, grep]
---

Prompt content`

      const skill = loader.loadFromMarkdown(markdown)

      // Invalid tools should cause the whole tools array to be undefined
      expect(skill?.tools).toBeUndefined()
    })

    it("should handle quoted strings in frontmatter", () => {
      const markdown = `---
name: "test-skill"
description: "A test 'skill' with quotes"
---

Prompt content`

      const skill = loader.loadFromMarkdown(markdown)

      expect(skill?.name).toBe("test-skill")
      expect(skill?.description).toBe("A test 'skill' with quotes")
    })
  })

  describe("loadIntoRegistry", () => {
    it("should load skills from directory into registry", async () => {
      const registry = new SkillsRegistry()

      // Create a temporary directory with a skill file
      const tmpDir = `/tmp/skills-test-${Date.now()}`
      await Bun.write(
        `${tmpDir}/test/SKILL.md`,
        `---
name: dir-skill
description: Loaded from directory
---

Skill prompt`,
      )

      const count = await loader.loadIntoRegistry(tmpDir, registry)

      expect(count).toBe(1)
      expect(registry.has("dir-skill")).toBe(true)

      // Cleanup
      await Bun.$`rm -rf ${tmpDir}`.quiet()
    })

    it("should return 0 for empty directory", async () => {
      const registry = new SkillsRegistry()
      const tmpDir = `/tmp/skills-empty-${Date.now()}`
      await Bun.$`mkdir -p ${tmpDir}`.quiet()

      const count = await loader.loadIntoRegistry(tmpDir, registry)

      expect(count).toBe(0)
      expect(registry.count()).toBe(0)

      // Cleanup
      await Bun.$`rm -rf ${tmpDir}`.quiet()
    })
  })
})

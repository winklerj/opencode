import { type Skill, SkillCategory, SkillTools } from "./skill"
import { SkillsRegistry } from "./registry"

/**
 * YAML frontmatter pattern for markdown files
 */
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

/**
 * Parse YAML-like frontmatter from markdown content.
 * Simple parser for key: value pairs.
 */
function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } | null {
  const match = content.match(FRONTMATTER_REGEX)
  if (!match) {
    return null
  }

  const [, yaml, body] = match
  const data: Record<string, unknown> = {}

  for (const line of yaml.split("\n")) {
    const colonIndex = line.indexOf(":")
    if (colonIndex === -1) continue

    const key = line.slice(0, colonIndex).trim()
    let value: unknown = line.slice(colonIndex + 1).trim()

    // Parse arrays (simple format: [item1, item2])
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    }
    // Parse booleans
    else if (value === "true") {
      value = true
    } else if (value === "false") {
      value = false
    }
    // Parse numbers
    else if (typeof value === "string" && /^\d+$/.test(value)) {
      value = Number.parseInt(value, 10)
    }
    // Remove quotes from strings
    else if (typeof value === "string") {
      value = value.replace(/^["']|["']$/g, "")
    }

    data[key] = value
  }

  return { data, body: body.trim() }
}

/**
 * SkillsLoader handles loading skills from various sources:
 * - Markdown files with YAML frontmatter
 * - Programmatic skill definitions
 *
 * Markdown skill format:
 * ```markdown
 * ---
 * name: skill-name
 * description: What this skill does
 * category: review
 * tools: [read, write, bash]
 * model: claude-sonnet-4-20250514
 * ---
 *
 * # System Prompt
 *
 * Instructions for the agent...
 * ```
 */
export class SkillsLoader {
  /**
   * Load a skill from markdown content.
   *
   * @param content - Markdown content with YAML frontmatter
   * @param location - File path (for file-based skills)
   * @returns Parsed skill or null if invalid
   */
  loadFromMarkdown(content: string, location?: string): Skill | null {
    const parsed = parseFrontmatter(content)
    if (!parsed) {
      return null
    }

    const { data, body } = parsed

    // Validate required fields
    if (typeof data.name !== "string" || !data.name) {
      return null
    }
    if (typeof data.description !== "string" || !data.description) {
      return null
    }

    // Parse and validate category
    const categoryResult = SkillCategory.safeParse(data.category ?? "custom")
    const category = categoryResult.success ? categoryResult.data : "custom"

    // Parse and validate tools
    let tools: Skill["tools"]
    if (Array.isArray(data.tools)) {
      const toolsResult = SkillTools.safeParse(data.tools)
      if (toolsResult.success) {
        tools = toolsResult.data
      }
    }

    return {
      name: data.name,
      description: data.description,
      category,
      prompt: body,
      tools,
      model: typeof data.model === "string" ? data.model : undefined,
      builtin: data.builtin === true,
      location,
    }
  }

  /**
   * Load all skills from a directory.
   * Scans for SKILL.md files in the directory tree.
   *
   * @param directory - Root directory to scan
   * @returns Array of loaded skills
   */
  async loadFromDirectory(directory: string): Promise<Skill[]> {
    const glob = new Bun.Glob("**/SKILL.md")
    const skills: Skill[] = []

    for await (const path of glob.scan({
      cwd: directory,
      absolute: true,
      onlyFiles: true,
    })) {
      const content = await Bun.file(path).text()
      const skill = this.loadFromMarkdown(content, path)
      if (skill) {
        skills.push(skill)
      }
    }

    return skills
  }

  /**
   * Load skills from a directory into a registry.
   *
   * @param directory - Root directory to scan
   * @param registry - Registry to populate
   * @returns Number of skills loaded
   */
  async loadIntoRegistry(directory: string, registry: SkillsRegistry): Promise<number> {
    const skills = await this.loadFromDirectory(directory)
    registry.registerAll(skills)
    return skills.length
  }
}

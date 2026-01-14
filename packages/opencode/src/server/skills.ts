import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { Skill } from "../skill/skill"
import { ConfigMarkdown } from "../config/markdown"
import z from "zod"
import { errors } from "./error"
import path from "path"
import fs from "fs/promises"
import { Instance } from "../project/instance"
import { Plugin } from "../plugin"

/**
 * Skills API Routes
 *
 * Provides endpoints for listing, retrieving, and managing skills.
 * Skills encode how your team ships—reusable workflows, best practices,
 * and domain-specific knowledge.
 */

/**
 * Detailed skill information including content
 */
const SkillDetail = z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  content: z.string(),
})
type SkillDetail = z.infer<typeof SkillDetail>

/**
 * Input for creating/updating a skill
 */
const SkillInput = z.object({
  name: z.string().describe("Unique skill name"),
  description: z.string().describe("Description of what the skill does"),
  prompt: z.string().describe("System prompt for the skill"),
  tools: z.array(z.string()).optional().describe("Allowed tools for the skill"),
  model: z.string().optional().describe("Override model for this skill"),
})
type SkillInput = z.infer<typeof SkillInput>

/**
 * Input for invoking a skill
 */
const SkillInvokeInput = z.object({
  sessionID: z.string().describe("Session ID for execution context"),
  context: z.string().optional().describe("Additional context for the skill"),
})
type SkillInvokeInput = z.infer<typeof SkillInvokeInput>

/**
 * Result from skill invocation
 */
const SkillInvokeResult = z.object({
  success: z.boolean(),
  prompt: z.string().optional().describe("Prepared prompt for the skill"),
  model: z.string().optional().describe("Model to use"),
  tools: z.array(z.string()).optional().describe("Allowed tools"),
  error: z.string().optional().describe("Error message if failed"),
})
type SkillInvokeResult = z.infer<typeof SkillInvokeResult>

/**
 * Get the skills directory for custom skills
 */
async function getSkillsDirectory(): Promise<string> {
  const dir = path.join(Instance.directory, ".opencode", "skills")
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/**
 * Convert a skill input to markdown content
 */
function skillToMarkdown(input: SkillInput): string {
  const lines = [
    "---",
    `name: ${input.name}`,
    `description: ${input.description}`,
  ]
  if (input.model) {
    lines.push(`model: ${input.model}`)
  }
  if (input.tools && input.tools.length > 0) {
    lines.push(`tools:`)
    for (const tool of input.tools) {
      lines.push(`  - ${tool}`)
    }
  }
  lines.push("---", "", input.prompt)
  return lines.join("\n")
}

export const SkillsRoute = new Hono()
  // GET /skills - List all available skills
  .get(
    "/",
    describeRoute({
      summary: "List skills",
      description:
        "List all available skills. Skills are loaded from .opencode/skills/ and .claude/skills/ directories.",
      operationId: "skills.list",
      responses: {
        200: {
          description: "List of available skills",
          content: {
            "application/json": {
              schema: resolver(z.array(Skill.Info)),
            },
          },
        },
      },
    }),
    async (c) => {
      const skills = await Skill.all()
      return c.json(skills)
    },
  )
  // GET /skills/:name - Get skill details
  .get(
    "/:name",
    describeRoute({
      summary: "Get skill",
      description: "Get details for a specific skill including its content.",
      operationId: "skills.get",
      responses: {
        200: {
          description: "Skill details",
          content: {
            "application/json": {
              schema: resolver(SkillDetail),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ name: z.string() })),
    async (c) => {
      const { name } = c.req.valid("param")
      const skill = await Skill.get(name)

      if (!skill) {
        return c.json({ error: "Skill not found" }, 404)
      }

      // Read the skill content
      const md = await ConfigMarkdown.parse(skill.location)
      const content = md?.content ?? ""

      return c.json({
        ...skill,
        content,
      })
    },
  )
  // POST /skills - Create a custom skill
  .post(
    "/",
    describeRoute({
      summary: "Create skill",
      description:
        "Create a new custom skill. Skills are stored in .opencode/skills/ directory.",
      operationId: "skills.create",
      responses: {
        200: {
          description: "Created skill",
          content: {
            "application/json": {
              schema: resolver(SkillDetail),
            },
          },
        },
        400: {
          description: "Skill already exists",
          content: {
            "application/json": {
              schema: resolver(z.object({ error: z.string() })),
            },
          },
        },
      },
    }),
    validator("json", SkillInput),
    async (c) => {
      const input = c.req.valid("json")

      // Check if skill already exists
      const existing = await Skill.get(input.name)
      if (existing) {
        return c.json({ error: `Skill "${input.name}" already exists` }, 400)
      }

      // Create skill file
      const skillsDir = await getSkillsDirectory()
      const skillDir = path.join(skillsDir, input.name)
      await fs.mkdir(skillDir, { recursive: true })

      const location = path.join(skillDir, "SKILL.md")
      const content = skillToMarkdown(input)
      await fs.writeFile(location, content, "utf-8")

      // Note: Skills are cached per instance. New skills will be available
      // after instance reload or when the skill is accessed directly via file.

      return c.json({
        name: input.name,
        description: input.description,
        location,
        content: input.prompt,
      })
    },
  )
  // PUT /skills/:name - Update a custom skill
  .put(
    "/:name",
    describeRoute({
      summary: "Update skill",
      description: "Update an existing custom skill.",
      operationId: "skills.update",
      responses: {
        200: {
          description: "Updated skill",
          content: {
            "application/json": {
              schema: resolver(SkillDetail),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ name: z.string() })),
    validator("json", SkillInput.omit({ name: true })),
    async (c) => {
      const { name } = c.req.valid("param")
      const input = c.req.valid("json")

      const skill = await Skill.get(name)
      if (!skill) {
        return c.json({ error: "Skill not found" }, 404)
      }

      // Update skill file
      const content = skillToMarkdown({ ...input, name })
      await fs.writeFile(skill.location, content, "utf-8")

      // Note: Skills are cached per instance. New skills will be available
      // after instance reload or when the skill is accessed directly via file.

      return c.json({
        name,
        description: input.description,
        location: skill.location,
        content: input.prompt,
      })
    },
  )
  // DELETE /skills/:name - Delete a custom skill
  .delete(
    "/:name",
    describeRoute({
      summary: "Delete skill",
      description: "Delete a custom skill.",
      operationId: "skills.delete",
      responses: {
        200: {
          description: "Skill deleted",
          content: {
            "application/json": {
              schema: resolver(z.object({ deleted: z.boolean() })),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ name: z.string() })),
    async (c) => {
      const { name } = c.req.valid("param")

      const skill = await Skill.get(name)
      if (!skill) {
        return c.json({ error: "Skill not found" }, 404)
      }

      // Delete the skill file
      await fs.unlink(skill.location)

      // Try to remove the directory if it's empty
      const skillDir = path.dirname(skill.location)
      try {
        await fs.rmdir(skillDir)
      } catch {
        // Directory not empty, ignore
      }

      // Note: Skills are cached per instance. New skills will be available
      // after instance reload or when the skill is accessed directly via file.

      return c.json({ deleted: true })
    },
  )
  // POST /skills/:name/invoke - Invoke a skill in session context
  .post(
    "/:name/invoke",
    describeRoute({
      summary: "Invoke skill",
      description:
        "Invoke a skill in session context. Returns the prepared prompt and configuration for the agent to execute.",
      operationId: "skills.invoke",
      responses: {
        200: {
          description: "Skill invocation result",
          content: {
            "application/json": {
              schema: resolver(SkillInvokeResult),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ name: z.string() })),
    validator("json", SkillInvokeInput),
    async (c) => {
      const { name } = c.req.valid("param")
      const { sessionID, context } = c.req.valid("json")

      const skill = await Skill.get(name)
      if (!skill) {
        return c.json({ error: "Skill not found" }, 404)
      }

      // Read skill content
      const md = await ConfigMarkdown.parse(skill.location)
      if (!md) {
        return c.json({ success: false, error: "Failed to parse skill content" })
      }

      // Trigger skill.invoke.before hook
      const beforeOutput: { modifiedPrompt?: string; skip?: boolean } = {}
      await Plugin.trigger("skill.invoke.before", {
        skillName: name,
        sessionID,
        context,
      }, beforeOutput)

      if (beforeOutput.skip) {
        return c.json({ success: false, error: "Skill invocation skipped by hook" })
      }

      // Build the skill prompt
      const promptParts = [
        `## Skill: ${skill.name}`,
        "",
        `**Description**: ${skill.description}`,
        "",
        "## Instructions",
        "",
        beforeOutput.modifiedPrompt ?? md.content,
      ]

      if (context) {
        promptParts.push("", "## Context", "", context)
      }

      const result: SkillInvokeResult = {
        success: true,
        prompt: promptParts.join("\n"),
        model: md.data?.model as string | undefined,
        tools: md.data?.tools as string[] | undefined,
      }

      // Trigger skill.invoke.after hook
      await Plugin.trigger("skill.invoke.after", {
        skillName: name,
        sessionID,
        result: result.prompt!,
      }, {})

      return c.json(result)
    },
  )

import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { Skill } from "../skill/skill"
import { ConfigMarkdown } from "../config/markdown"
import z from "zod"
import { errors } from "./error"

/**
 * Skills API Routes
 *
 * Provides endpoints for listing and retrieving skills.
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

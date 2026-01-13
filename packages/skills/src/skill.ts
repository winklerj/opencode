import { z } from "zod"

/**
 * Skills encode how your team ships - reusable workflows,
 * best practices, and domain-specific knowledge.
 *
 * From SPECIFICATION.md:
 * "Skills encode how your team ships—reusable workflows, best practices,
 * and domain-specific knowledge. They let builders of all backgrounds
 * contribute with the tooling and setup an engineer would have."
 */

/**
 * Categories of built-in skills
 */
export const SkillCategory = z.enum([
  "review", // Code review, PR review
  "generation", // Test generation, PR description
  "debugging", // Bug fix, diagnosis
  "implementation", // Feature implementation
  "custom", // User-defined skills
])
export type SkillCategory = z.infer<typeof SkillCategory>

/**
 * Available tools a skill can use
 */
export const SkillTools = z.array(
  z.enum([
    "read",
    "write",
    "edit",
    "grep",
    "glob",
    "bash",
    "multiedit",
    "computer_use", // For visual verification
    "spawn_session", // For parallel work
    "datadog_query", // Metrics
    "sentry_query", // Error tracking
    "launchdarkly_query", // Feature flags
  ]),
)
export type SkillTools = z.infer<typeof SkillTools>

/**
 * Skill definition schema
 * Matches SPECIFICATION.md Section 6.3
 */
export const Skill = z.object({
  /** Unique name identifier (e.g., "code-review", "pr-description") */
  name: z.string(),
  /** Human-readable description */
  description: z.string(),
  /** Skill category for organization */
  category: SkillCategory,
  /** System prompt that guides the agent's behavior */
  prompt: z.string(),
  /** Tools this skill is allowed to use */
  tools: SkillTools.optional(),
  /** Override the default model for this skill */
  model: z.string().optional(),
  /** Whether this is a built-in skill */
  builtin: z.boolean().default(false),
  /** File path for file-based skills */
  location: z.string().optional(),
})
export type Skill = z.infer<typeof Skill>

/**
 * Input for invoking a skill
 */
export const InvokeInput = z.object({
  /** Name of the skill to invoke */
  skillName: z.string(),
  /** Session ID for context */
  sessionID: z.string(),
  /** Additional context to provide to the skill */
  context: z.string().optional(),
  /** Override the skill's default model */
  model: z.string().optional(),
})
export type InvokeInput = z.infer<typeof InvokeInput>

/**
 * Result of skill invocation
 */
export const InvokeResult = z.object({
  /** Whether the skill completed successfully */
  success: z.boolean(),
  /** Output from the skill execution */
  output: z.string().optional(),
  /** Error message if failed */
  error: z.string().optional(),
  /** Artifacts produced by the skill (file paths, URLs, etc.) */
  artifacts: z.array(z.string()).optional(),
})
export type InvokeResult = z.infer<typeof InvokeResult>

/**
 * Events emitted during skill execution
 */
export type SkillEvent =
  | { type: "invoked"; skillName: string; sessionID: string }
  | { type: "running"; skillName: string; step: string }
  | { type: "completed"; skillName: string; result: InvokeResult }
  | { type: "failed"; skillName: string; error: string }

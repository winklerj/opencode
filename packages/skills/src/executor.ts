import { type Skill, type InvokeInput, type InvokeResult, type SkillEvent } from "./skill"
import { SkillsRegistry } from "./registry"

/**
 * Execution context provided to skill executors
 */
export interface ExecutionContext {
  /** Session ID for the current execution */
  sessionID: string
  /** Additional context provided by the invoker */
  context?: string
  /** Callback for skill events */
  onEvent?: (event: SkillEvent) => void
  /** Signal for cancellation */
  signal?: AbortSignal
}

/**
 * Configuration for SkillsExecutor
 */
export interface ExecutorConfig {
  /** Default model to use when skill doesn't specify one */
  defaultModel?: string
  /** Default timeout for skill execution (ms) */
  defaultTimeout?: number
}

/**
 * SkillsExecutor handles invoking skills and managing their execution.
 *
 * The executor:
 * - Looks up skills from the registry
 * - Prepares execution context with skill's system prompt
 * - Emits events during execution
 * - Handles errors and timeouts
 *
 * Note: The actual agent execution is delegated to the parent system
 * (packages/opencode). This executor prepares the prompt and context.
 */
export class SkillsExecutor {
  private registry: SkillsRegistry
  private config: ExecutorConfig

  constructor(registry: SkillsRegistry, config: ExecutorConfig = {}) {
    this.registry = registry
    this.config = {
      defaultModel: config.defaultModel ?? "claude-sonnet-4-20250514",
      defaultTimeout: config.defaultTimeout ?? 600000, // 10 minutes
    }
  }

  /**
   * Prepare a skill for execution.
   * Returns the prepared prompt and configuration without executing.
   *
   * @param input - Invocation input
   * @returns Prepared skill configuration or null if skill not found
   */
  prepare(input: InvokeInput): {
    skill: Skill
    prompt: string
    model: string
    tools: Skill["tools"]
  } | null {
    const skill = this.registry.get(input.skillName)
    if (!skill) {
      return null
    }

    // Build the complete prompt with skill instructions and context
    const promptParts = [
      `## Skill: ${skill.name}`,
      "",
      `**Description**: ${skill.description}`,
      "",
      "## Instructions",
      "",
      skill.prompt,
    ]

    if (input.context) {
      promptParts.push("", "## Context", "", input.context)
    }

    return {
      skill,
      prompt: promptParts.join("\n"),
      model: input.model ?? skill.model ?? this.config.defaultModel!,
      tools: skill.tools,
    }
  }

  /**
   * Invoke a skill.
   *
   * This method prepares the skill for execution and emits events.
   * The actual execution must be performed by the caller using
   * the returned preparation data.
   *
   * @param input - Invocation input
   * @param ctx - Execution context
   * @returns Result of the skill invocation
   */
  async invoke(input: InvokeInput, ctx: ExecutionContext): Promise<InvokeResult> {
    ctx.onEvent?.({
      type: "invoked",
      skillName: input.skillName,
      sessionID: ctx.sessionID,
    })

    const preparation = this.prepare(input)
    if (!preparation) {
      const error = `Skill "${input.skillName}" not found`
      ctx.onEvent?.({
        type: "failed",
        skillName: input.skillName,
        error,
      })
      return { success: false, error }
    }

    ctx.onEvent?.({
      type: "running",
      skillName: input.skillName,
      step: "Executing skill prompt",
    })

    // Return the prepared data for the caller to execute
    // The actual execution is delegated to the parent system
    const result: InvokeResult = {
      success: true,
      output: preparation.prompt,
    }

    ctx.onEvent?.({
      type: "completed",
      skillName: input.skillName,
      result,
    })

    return result
  }

  /**
   * List all available skills.
   */
  listSkills(): Skill[] {
    return this.registry.list()
  }

  /**
   * Get a skill by name.
   */
  getSkill(name: string): Skill | undefined {
    return this.registry.get(name)
  }
}

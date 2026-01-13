import { Instance } from "../project/instance"
import { AgentScheduler, type Agent as BackgroundAgent } from "@opencode-ai/background"
import { Plugin } from "../plugin"

/**
 * BackgroundService provides a singleton AgentScheduler for the project.
 *
 * This service manages background agent scheduling, ensuring a single
 * scheduler instance is shared across all tools (spawn_session, check_session).
 */
export namespace BackgroundService {
  /**
   * Get the scheduler singleton for the current project
   */
  export const getScheduler = Instance.state(async () => {
    const scheduler = new AgentScheduler({
      limits: {
        maxConcurrent: 5,
        maxQueued: 100,
        maxPerSession: 10,
      },
      initTimeout: 120000,  // 2 minutes to initialize sandbox
      runTimeout: 3600000,  // 1 hour max run time
      autoProcess: true,    // Auto-process queue on spawn
    })

    // Configure initialization callback to set up sandbox
    scheduler.onInitialize(async (agent) => {
      // TODO: In a full implementation, this would:
      // 1. Get a sandbox from the warm pool or create one via SandboxProvider
      // 2. Clone the repository if specified
      // 3. Return the sandboxID
      // For now, return a mock sandbox ID
      return { sandboxID: `sandbox_${agent.id}` }
    })

    // Configure run callback to execute the agent task
    scheduler.onRun(async (agent) => {
      // TODO: In a full implementation, this would:
      // 1. Create a new OpenCode session in the sandbox
      // 2. Execute the task using the agent's system prompt
      // 3. Return the output
      // For now, simulate completion
      return { output: `Task "${agent.task}" completed` }
    })

    return scheduler
  })

  /**
   * Spawn a background agent.
   * Triggers background.spawn hook to allow plugins to configure sandbox.
   */
  export async function spawn(input: {
    parentSessionID: string
    task: string
    type?: "research" | "parallel-work" | "review"
    repository?: string
    branch?: string
    imageTag?: string
  }): Promise<{ success: true; agent: BackgroundAgent } | { success: false; error: string }> {
    // Allow plugins to modify sandbox configuration
    const hookOutput = await Plugin.trigger(
      "background.spawn",
      {
        parentSessionID: input.parentSessionID,
        task: input.task,
        sandboxConfig: input.repository
          ? {
              repository: input.repository,
              branch: input.branch,
              imageTag: input.imageTag,
            }
          : undefined,
      },
      {
        sandboxConfig: undefined as
          | {
              projectID?: string
              repository?: string
              branch?: string
              services?: string[]
              imageTag?: string
            }
          | undefined,
      },
    )

    // Merge plugin modifications with original input
    const sandboxConfig = input.repository
      ? {
          repository: hookOutput.sandboxConfig?.repository ?? input.repository,
          branch: hookOutput.sandboxConfig?.branch ?? input.branch,
          imageTag: hookOutput.sandboxConfig?.imageTag ?? input.imageTag,
        }
      : hookOutput.sandboxConfig
        ? {
            repository: hookOutput.sandboxConfig.repository!,
            branch: hookOutput.sandboxConfig.branch,
            imageTag: hookOutput.sandboxConfig.imageTag,
          }
        : undefined

    const scheduler = await getScheduler()

    const result = scheduler.spawn({
      parentSessionID: input.parentSessionID,
      task: input.task,
      sandboxConfig,
    })

    if (!result.success || !result.agent) {
      return { success: false, error: result.error || "Unknown error" }
    }

    return { success: true, agent: result.agent }
  }

  /**
   * Get an agent by ID
   */
  export async function get(agentID: string): Promise<BackgroundAgent | undefined> {
    const scheduler = await getScheduler()
    return scheduler.get(agentID)
  }

  /**
   * Cancel an agent
   */
  export async function cancel(agentID: string): Promise<boolean> {
    const scheduler = await getScheduler()
    return scheduler.cancel(agentID)
  }

  /**
   * Get all agents for a parent session
   */
  export async function byParentSession(parentSessionID: string): Promise<BackgroundAgent[]> {
    const scheduler = await getScheduler()
    return scheduler.byParentSession(parentSessionID)
  }

  /**
   * Get scheduler statistics
   */
  export async function stats() {
    const scheduler = await getScheduler()
    return scheduler.stats()
  }

  /**
   * Wait for an agent to reach a terminal state
   */
  export async function waitFor(agentID: string): Promise<BackgroundAgent> {
    const scheduler = await getScheduler()

    return new Promise((resolve) => {
      const check = () => {
        const agent = scheduler.get(agentID)
        if (!agent) {
          resolve({
            id: agentID,
            parentSessionID: "",
            sessionID: "",
            status: "failed",
            task: "",
            createdAt: Date.now(),
            error: "Agent not found",
          })
          return
        }

        if (["completed", "failed", "cancelled"].includes(agent.status)) {
          resolve(agent)
          return
        }

        // Poll every 500ms
        setTimeout(check, 500)
      }
      check()
    })
  }
}

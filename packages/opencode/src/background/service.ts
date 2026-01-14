import { Instance } from "../project/instance"
import { AgentScheduler, type Agent as BackgroundAgent } from "@opencode-ai/background"
import { Plugin } from "../plugin"
import { SandboxService } from "../sandbox/service"
import { TelemetryLog, EventNames } from "../telemetry/log"

/**
 * Cache of sandbox configs for agents.
 * Maps agent ID to sandbox configuration used during spawn.
 */
const agentSandboxConfigs = new Map<
  string,
  {
    repository?: string
    branch?: string
    imageTag?: string
    projectID?: string
  }
>()

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
      // Look up sandbox config that was cached during spawn
      const sandboxConfig = agentSandboxConfigs.get(agent.id)

      if (sandboxConfig?.repository && sandboxConfig?.projectID) {
        // Try warm pool first
        const claimResult = await SandboxService.claimFromPool(
          sandboxConfig.repository,
          sandboxConfig.projectID,
          sandboxConfig.imageTag,
        )

        if (claimResult.sandbox) {
          TelemetryLog.info("Background agent claimed sandbox from warm pool", {
            "event.name": EventNames.BACKGROUND_SPAWNED,
            "event.domain": "background",
            "opencode.sandbox.id": claimResult.sandbox.id,
          })
          return { sandboxID: claimResult.sandbox.id }
        }

        // Fall back to creating a new sandbox
        const sandbox = await SandboxService.create({
          projectID: sandboxConfig.projectID,
          repository: sandboxConfig.repository,
          branch: sandboxConfig.branch,
          imageTag: sandboxConfig.imageTag,
        })

        TelemetryLog.info("Background agent created new sandbox", {
          "event.name": EventNames.BACKGROUND_SPAWNED,
          "event.domain": "background",
          "opencode.sandbox.id": sandbox.id,
        })
        return { sandboxID: sandbox.id }
      }

      // No sandbox config - return a mock ID for testing
      TelemetryLog.info("Background agent using mock sandbox", {
        "event.name": EventNames.BACKGROUND_SPAWNED,
        "event.domain": "background",
      })
      return { sandboxID: `sandbox_${agent.id}` }
    })

    // Configure run callback to execute the agent task
    scheduler.onRun(async (agent) => {
      // Execute the task in the sandbox
      const sandboxID = agent.sandboxID
      if (!sandboxID || sandboxID.startsWith("sandbox_")) {
        // Mock sandbox - simulate completion
        TelemetryLog.info("Background agent completed (mock)", {
          "event.name": EventNames.BACKGROUND_COMPLETED,
          "event.domain": "background",
        })
        return { output: `Task "${agent.task}" completed (mock)` }
      }

      // Real sandbox - execute command
      const result = await SandboxService.execute(sandboxID, [
        "bash",
        "-c",
        `echo "Executing task: ${agent.task}"`,
      ])

      TelemetryLog.info("Background agent completed", {
        "event.name": EventNames.BACKGROUND_COMPLETED,
        "event.domain": "background",
        "opencode.sandbox.id": sandboxID,
      })

      // Clean up the cached sandbox config
      agentSandboxConfigs.delete(agent.id)

      return {
        output: result.stdout,
        exitCode: result.exitCode,
      }
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

    // Cache the full sandbox config (with projectID from hook if available)
    if (sandboxConfig) {
      agentSandboxConfigs.set(result.agent.id, {
        repository: sandboxConfig.repository,
        branch: sandboxConfig.branch,
        imageTag: sandboxConfig.imageTag,
        projectID: hookOutput.sandboxConfig?.projectID,
      })
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

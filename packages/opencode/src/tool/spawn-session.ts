import { Tool } from "./tool"
import z from "zod"
import { BackgroundService } from "../background/service"
import type { Agent as BackgroundAgent, AgentStatus } from "@opencode-ai/background"

const parameters = z.object({
  task: z.string().describe("What the spawned agent should accomplish"),
  type: z.enum(["research", "parallel-work", "review"]).describe("Type of background session"),
  repository: z.string().optional().describe("Repository to work with"),
  branch: z.string().optional().describe("Branch to work on"),
  wait: z.boolean().default(false).describe("Wait for completion (default: false)"),
})

interface SpawnSessionMetadata {
  agentId?: string
  status?: AgentStatus
  type?: "research" | "parallel-work" | "review"
  output?: unknown
  error?: string
}

export const SpawnSessionTool = Tool.define<typeof parameters, SpawnSessionMetadata>("spawn_session", {
  description: `Spawn a background coding session for parallel work or research.

Use this tool when you need to:
- Research something in parallel while continuing other work
- Spawn a parallel task that can run independently
- Delegate a review or analysis task

The spawned session runs in its own sandbox and can work independently.
By default, this returns immediately with the agent ID. Use wait=true to wait for completion.`,
  parameters,
  async execute(params: z.infer<typeof parameters>, ctx) {
    // Spawn the background agent
    const result = await BackgroundService.spawn({
      parentSessionID: ctx.sessionID,
      task: params.task,
      type: params.type,
      repository: params.repository,
      branch: params.branch,
    })

    if (!result.success) {
      return {
        title: "Failed to spawn session",
        metadata: { error: result.error } as SpawnSessionMetadata,
        output: `Failed to spawn background session: ${result.error}`,
      }
    }

    const agent = result.agent

    ctx.metadata({
      title: `Spawning: ${params.task.slice(0, 30)}...`,
      metadata: {
        agentId: agent.id,
        status: agent.status,
        type: params.type,
      },
    })

    // If wait=true, wait for completion
    if (params.wait) {
      const finalAgent = await BackgroundService.waitFor(agent.id)

      return {
        title: `Background session ${finalAgent.status}`,
        metadata: {
          agentId: finalAgent.id,
          status: finalAgent.status,
          output: finalAgent.output,
        } as SpawnSessionMetadata,
        output: formatAgentResult(finalAgent),
      }
    }

    // Return immediately with agent ID
    return {
      title: `Spawned background session`,
      metadata: {
        agentId: agent.id,
        status: agent.status,
        type: params.type,
      } as SpawnSessionMetadata,
      output: `Spawned background session ${agent.id}

Task: ${params.task}
Type: ${params.type}
Status: ${agent.status}

Use check_session with agent ID "${agent.id}" to check progress.`,
    }
  },
})

/**
 * Format agent result for output
 */
function formatAgentResult(agent: BackgroundAgent): string {
  const lines = [
    `Background Session Result`,
    `========================`,
    `Agent ID: ${agent.id}`,
    `Status: ${agent.status}`,
  ]

  if (agent.error) {
    lines.push(`Error: ${agent.error}`)
  }

  if (agent.output) {
    lines.push(``, `Output:`, String(agent.output))
  }

  return lines.join("\n")
}

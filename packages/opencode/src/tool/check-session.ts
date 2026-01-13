import { Tool } from "./tool"
import z from "zod"
import { BackgroundService } from "../background/service"
import type { Agent as BackgroundAgent, AgentStatus } from "@opencode-ai/background"

const parameters = z.object({
  agentID: z.string().describe("ID of the background agent to check"),
  includeOutput: z.boolean().default(false).describe("Include full output if available"),
})

interface CheckSessionMetadata {
  agentId: string
  status?: AgentStatus
  isTerminal?: boolean
  error?: string
}

export const CheckSessionTool = Tool.define<typeof parameters, CheckSessionMetadata>("check_session", {
  description: `Check the status of a spawned background session.

Use this tool to:
- Check if a background agent has completed
- Get the output or error from a completed agent
- Monitor progress of running agents

Returns the agent's current status and optionally its output.`,
  parameters,
  async execute(params: z.infer<typeof parameters>, ctx) {
    const agent = await BackgroundService.get(params.agentID)

    if (!agent) {
      return {
        title: "Agent not found",
        metadata: { agentId: params.agentID, error: "Agent not found" } as CheckSessionMetadata,
        output: `No background agent found with ID: ${params.agentID}

The agent may have been cleaned up or the ID is invalid.`,
      }
    }

    const isTerminal = ["completed", "failed", "cancelled"].includes(agent.status)

    ctx.metadata({
      title: `Agent ${agent.status}`,
      metadata: {
        agentId: agent.id,
        status: agent.status,
        isTerminal,
      },
    })

    return {
      title: `Agent ${agent.status}`,
      metadata: {
        agentId: agent.id,
        status: agent.status,
        isTerminal,
      } as CheckSessionMetadata,
      output: formatAgentStatus(agent, params.includeOutput),
    }
  },
})

/**
 * Format agent status for output
 */
function formatAgentStatus(agent: BackgroundAgent, includeOutput: boolean): string {
  const isTerminal = ["completed", "failed", "cancelled"].includes(agent.status)

  const lines = [
    `Background Agent Status`,
    `=======================`,
    `Agent ID: ${agent.id}`,
    `Status: ${agent.status}`,
    `Task: ${agent.task}`,
    `Parent Session: ${agent.parentSessionID}`,
    `Session ID: ${agent.sessionID}`,
  ]

  if (agent.sandboxID) {
    lines.push(`Sandbox ID: ${agent.sandboxID}`)
  }

  lines.push(`Created: ${new Date(agent.createdAt).toISOString()}`)

  if (agent.startedAt) {
    lines.push(`Started: ${new Date(agent.startedAt).toISOString()}`)
  }

  if (agent.completedAt) {
    lines.push(`Completed: ${new Date(agent.completedAt).toISOString()}`)
    const duration = agent.completedAt - (agent.startedAt || agent.createdAt)
    lines.push(`Duration: ${(duration / 1000).toFixed(1)}s`)
  }

  if (agent.error) {
    lines.push(``, `Error:`, agent.error)
  }

  if (includeOutput && agent.output) {
    lines.push(``, `Output:`, String(agent.output))
  } else if (!includeOutput && agent.output) {
    lines.push(``, `(Output available - use includeOutput=true to see it)`)
  }

  if (!isTerminal) {
    lines.push(``, `The agent is still ${agent.status}. Check again later for updates.`)
  }

  return lines.join("\n")
}

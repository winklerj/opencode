import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { BackgroundService } from "../background/service"
import { Agent, AgentStatus, isTerminal } from "@opencode-ai/background"
import z from "zod"
import { errors } from "./error"

/**
 * Background Agent API Routes
 *
 * Implements the Background Agent API from the specification:
 * - POST   /background/spawn     Spawn background agent
 * - GET    /background/:id       Get agent status
 * - GET    /background           List agents
 * - POST   /background/:id/cancel Cancel agent
 * - GET    /background/:id/output Get agent output
 * - GET    /background/:id/events Stream agent events (SSE)
 */
export const BackgroundRoute = new Hono()
  // POST /background/spawn - Spawn a background agent
  .post(
    "/spawn",
    describeRoute({
      summary: "Spawn background agent",
      description: "Spawn a new background coding agent for parallel work or research.",
      operationId: "background.spawn",
      responses: {
        200: {
          description: "Agent spawned successfully",
          content: {
            "application/json": {
              schema: resolver(Agent),
            },
          },
        },
        ...errors(400, 500),
      },
    }),
    validator(
      "json",
      z.object({
        parentSessionID: z.string().describe("ID of the parent session"),
        task: z.string().describe("Task for the agent to accomplish"),
        type: z.enum(["research", "parallel-work", "review"]).optional(),
        repository: z.string().optional().describe("Repository to work with"),
        branch: z.string().optional().describe("Branch to work on"),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json")

      const result = await BackgroundService.spawn({
        parentSessionID: body.parentSessionID,
        task: body.task,
        type: body.type,
        repository: body.repository,
        branch: body.branch,
      })

      if (!result.success) {
        return c.json({ error: result.error }, 400)
      }

      return c.json(result.agent)
    },
  )
  // GET /background/:id - Get agent status
  .get(
    "/:id",
    describeRoute({
      summary: "Get agent status",
      description: "Get the current status and details of a background agent.",
      operationId: "background.get",
      responses: {
        200: {
          description: "Agent information",
          content: {
            "application/json": {
              schema: resolver(Agent),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")
      const agent = await BackgroundService.get(id)

      if (!agent) {
        return c.json({ error: "Agent not found" }, 404)
      }

      return c.json(agent)
    },
  )
  // GET /background - List all agents
  .get(
    "/",
    describeRoute({
      summary: "List agents",
      description: "List all background agents, optionally filtered by parent session.",
      operationId: "background.list",
      responses: {
        200: {
          description: "List of agents",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  agents: Agent.array(),
                  stats: z.object({
                    queued: z.number(),
                    running: z.number(),
                    completed: z.number(),
                    failed: z.number(),
                  }),
                }),
              ),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        parentSessionID: z.string().optional().describe("Filter by parent session ID"),
      }),
    ),
    async (c) => {
      const { parentSessionID } = c.req.valid("query")

      let agents
      if (parentSessionID) {
        agents = await BackgroundService.byParentSession(parentSessionID)
      } else {
        const stats = await BackgroundService.stats()
        // Return all agents via scheduler
        const scheduler = await BackgroundService.getScheduler()
        agents = scheduler.all()
      }

      const stats = await BackgroundService.stats()

      return c.json({
        agents,
        stats,
      })
    },
  )
  // POST /background/:id/cancel - Cancel an agent
  .post(
    "/:id/cancel",
    describeRoute({
      summary: "Cancel agent",
      description: "Cancel a running or queued background agent.",
      operationId: "background.cancel",
      responses: {
        200: {
          description: "Agent cancelled",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")
      const success = await BackgroundService.cancel(id)

      if (!success) {
        return c.json({ error: "Agent not found or already completed" }, 404)
      }

      return c.json({ success: true })
    },
  )
  // GET /background/:id/output - Get agent output
  .get(
    "/:id/output",
    describeRoute({
      summary: "Get agent output",
      description: "Get the output from a completed background agent.",
      operationId: "background.output",
      responses: {
        200: {
          description: "Agent output",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  id: z.string(),
                  status: AgentStatus,
                  output: z.unknown().optional(),
                  error: z.string().optional(),
                }),
              ),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")
      const agent = await BackgroundService.get(id)

      if (!agent) {
        return c.json({ error: "Agent not found" }, 404)
      }

      return c.json({
        id: agent.id,
        status: agent.status,
        output: agent.output,
        error: agent.error,
      })
    },
  )
  // GET /background/:id/events - Stream agent events (SSE)
  .get(
    "/:id/events",
    describeRoute({
      summary: "Stream agent events",
      description: "Subscribe to real-time events from a background agent using server-sent events.",
      operationId: "background.events",
      responses: {
        200: {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: resolver(
                z.object({
                  type: z.enum(["status", "output", "error", "complete"]),
                  agent: Agent.optional(),
                  data: z.unknown().optional(),
                }),
              ),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")
      const agent = await BackgroundService.get(id)

      if (!agent) {
        return c.json({ error: "Agent not found" }, 404)
      }

      return streamSSE(c, async (stream) => {
        // Send initial status
        await stream.writeSSE({
          event: "status",
          data: JSON.stringify({ type: "status", agent }),
        })

        // If already terminal, send complete and close
        if (isTerminal(agent.status)) {
          await stream.writeSSE({
            event: "complete",
            data: JSON.stringify({
              type: "complete",
              agent,
              data: agent.output,
            }),
          })
          return
        }

        // Poll for status changes
        let lastStatus = agent.status
        const pollInterval = setInterval(async () => {
          const currentAgent = await BackgroundService.get(id)
          if (!currentAgent) {
            clearInterval(pollInterval)
            return
          }

          if (currentAgent.status !== lastStatus) {
            lastStatus = currentAgent.status
            await stream.writeSSE({
              event: "status",
              data: JSON.stringify({ type: "status", agent: currentAgent }),
            })

            if (isTerminal(currentAgent.status)) {
              await stream.writeSSE({
                event: "complete",
                data: JSON.stringify({
                  type: "complete",
                  agent: currentAgent,
                  data: currentAgent.output,
                }),
              })
              clearInterval(pollInterval)
            }
          }
        }, 500)

        // Clean up on disconnect
        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            clearInterval(pollInterval)
            resolve()
          })
        })
      })
    },
  )
  // GET /background/stats - Get scheduler statistics
  .get(
    "/stats",
    describeRoute({
      summary: "Get background agent statistics",
      description: "Get statistics about the background agent scheduler.",
      operationId: "background.stats",
      responses: {
        200: {
          description: "Scheduler statistics",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  queued: z.number(),
                  running: z.number(),
                  completed: z.number(),
                  failed: z.number(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const stats = await BackgroundService.stats()
      return c.json(stats)
    },
  )

import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import { MultiplayerService } from "../multiplayer/service"
import { Multiplayer, WebSocketMessage, type MultiplayerEvent } from "@opencode-ai/multiplayer"
import { Prompt, PromptPriority } from "@opencode-ai/background"
import z from "zod"
import { errors } from "./error"
import type { WSContext } from "hono/ws"

/**
 * Multiplayer API Routes
 *
 * Implements the Multiplayer API from the specification:
 * - POST   /multiplayer/:sessionID/join     Join session
 * - POST   /multiplayer/:sessionID/leave    Leave session
 * - PUT    /multiplayer/:sessionID/cursor   Update cursor position
 * - POST   /multiplayer/:sessionID/lock     Acquire edit lock
 * - DELETE /multiplayer/:sessionID/lock     Release edit lock
 * - GET    /multiplayer/:sessionID          Get session info
 * - GET    /multiplayer                     List sessions
 * - POST   /multiplayer                     Create session
 * - DELETE /multiplayer/:sessionID          Delete session
 * - GET    /multiplayer/:sessionID/ws       WebSocket connection
 */
export const MultiplayerRoute = new Hono()
  // POST /multiplayer - Create a new multiplayer session
  .post(
    "/",
    describeRoute({
      summary: "Create multiplayer session",
      description: "Create a new multiplayer session for real-time collaboration.",
      operationId: "multiplayer.create",
      responses: {
        200: {
          description: "Session created successfully",
          content: {
            "application/json": {
              schema: resolver(Multiplayer.Session),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", Multiplayer.CreateInput),
    async (c) => {
      const body = c.req.valid("json")
      const session = await MultiplayerService.create(body)
      return c.json(session)
    },
  )
  // GET /multiplayer - List all sessions
  .get(
    "/",
    describeRoute({
      summary: "List multiplayer sessions",
      description: "Get a list of all multiplayer sessions.",
      operationId: "multiplayer.list",
      responses: {
        200: {
          description: "List of sessions",
          content: {
            "application/json": {
              schema: resolver(Multiplayer.Session.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      const sessions = await MultiplayerService.all()
      return c.json(sessions)
    },
  )
  // GET /multiplayer/:sessionID - Get session info
  .get(
    "/:sessionID",
    describeRoute({
      summary: "Get multiplayer session",
      description: "Get details of a specific multiplayer session.",
      operationId: "multiplayer.get",
      responses: {
        200: {
          description: "Session information",
          content: {
            "application/json": {
              schema: resolver(Multiplayer.Session),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const session = await MultiplayerService.get(sessionID)

      if (!session) {
        return c.json({ error: "Session not found" }, 404)
      }

      return c.json(session)
    },
  )
  // DELETE /multiplayer/:sessionID - Delete session
  .delete(
    "/:sessionID",
    describeRoute({
      summary: "Delete multiplayer session",
      description: "Delete a multiplayer session.",
      operationId: "multiplayer.delete",
      responses: {
        200: {
          description: "Session deleted",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const success = await MultiplayerService.remove(sessionID)

      if (!success) {
        return c.json({ error: "Session not found" }, 404)
      }

      return c.json({ success: true })
    },
  )
  // POST /multiplayer/:sessionID/join - Join session
  .post(
    "/:sessionID/join",
    describeRoute({
      summary: "Join multiplayer session",
      description: "Join a multiplayer session as a user.",
      operationId: "multiplayer.join",
      responses: {
        200: {
          description: "Successfully joined",
          content: {
            "application/json": {
              schema: resolver(Multiplayer.User),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", Multiplayer.JoinInput),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const body = c.req.valid("json")

      const user = await MultiplayerService.join(sessionID, body)

      if (!user) {
        return c.json({ error: "Failed to join session (not found or full)" }, 400)
      }

      return c.json(user)
    },
  )
  // POST /multiplayer/:sessionID/leave - Leave session
  .post(
    "/:sessionID/leave",
    describeRoute({
      summary: "Leave multiplayer session",
      description: "Leave a multiplayer session.",
      operationId: "multiplayer.leave",
      responses: {
        200: {
          description: "Successfully left",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", z.object({ userID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { userID } = c.req.valid("json")

      const success = await MultiplayerService.leave(sessionID, userID)

      if (!success) {
        return c.json({ error: "Failed to leave session" }, 400)
      }

      return c.json({ success: true })
    },
  )
  // PUT /multiplayer/:sessionID/cursor - Update cursor position
  .put(
    "/:sessionID/cursor",
    describeRoute({
      summary: "Update cursor position",
      description: "Update a user's cursor position in a multiplayer session.",
      operationId: "multiplayer.updateCursor",
      responses: {
        200: {
          description: "Cursor updated",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator(
      "json",
      z.object({
        userID: z.string(),
        cursor: Multiplayer.Cursor,
      }),
    ),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { userID, cursor } = c.req.valid("json")

      const success = await MultiplayerService.updateCursor(sessionID, userID, cursor)

      if (!success) {
        return c.json({ error: "Failed to update cursor" }, 400)
      }

      return c.json({ success: true })
    },
  )
  // POST /multiplayer/:sessionID/lock - Acquire edit lock
  .post(
    "/:sessionID/lock",
    describeRoute({
      summary: "Acquire edit lock",
      description: "Acquire the edit lock for a multiplayer session.",
      operationId: "multiplayer.acquireLock",
      responses: {
        200: {
          description: "Lock result",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean(), reason: z.string().optional() })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", z.object({ userID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { userID } = c.req.valid("json")

      const success = await MultiplayerService.acquireLock(sessionID, userID)

      if (!success) {
        // Check if lock is held by someone else
        const session = await MultiplayerService.get(sessionID)
        if (!session) {
          return c.json({ error: "Session not found" }, 404)
        }
        if (session.state.editLock) {
          return c.json({ success: false, reason: `Lock held by ${session.state.editLock}` })
        }
        return c.json({ success: false, reason: "User not in session" })
      }

      return c.json({ success: true })
    },
  )
  // DELETE /multiplayer/:sessionID/lock - Release edit lock
  .delete(
    "/:sessionID/lock",
    describeRoute({
      summary: "Release edit lock",
      description: "Release the edit lock for a multiplayer session.",
      operationId: "multiplayer.releaseLock",
      responses: {
        200: {
          description: "Lock released",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", z.object({ userID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { userID } = c.req.valid("json")

      const success = await MultiplayerService.releaseLock(sessionID, userID)

      if (!success) {
        return c.json({ error: "Failed to release lock (not held by user)" }, 400)
      }

      return c.json({ success: true })
    },
  )
  // POST /multiplayer/:sessionID/connect - Connect a client
  .post(
    "/:sessionID/connect",
    describeRoute({
      summary: "Connect client",
      description: "Connect a client to a multiplayer session.",
      operationId: "multiplayer.connect",
      responses: {
        200: {
          description: "Client connected",
          content: {
            "application/json": {
              schema: resolver(Multiplayer.Client),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", Multiplayer.ConnectInput),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const body = c.req.valid("json")

      const client = await MultiplayerService.connect(sessionID, body)

      if (!client) {
        return c.json({ error: "Failed to connect (user not in session or client limit reached)" }, 400)
      }

      return c.json(client)
    },
  )
  // POST /multiplayer/:sessionID/disconnect - Disconnect a client
  .post(
    "/:sessionID/disconnect",
    describeRoute({
      summary: "Disconnect client",
      description: "Disconnect a client from a multiplayer session.",
      operationId: "multiplayer.disconnect",
      responses: {
        200: {
          description: "Client disconnected",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator("json", z.object({ clientID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { clientID } = c.req.valid("json")

      const success = await MultiplayerService.disconnect(sessionID, clientID)

      if (!success) {
        return c.json({ error: "Failed to disconnect" }, 400)
      }

      return c.json({ success: true })
    },
  )
  // GET /multiplayer/:sessionID/users - Get users in session
  .get(
    "/:sessionID/users",
    describeRoute({
      summary: "Get session users",
      description: "Get all users in a multiplayer session.",
      operationId: "multiplayer.users",
      responses: {
        200: {
          description: "List of users",
          content: {
            "application/json": {
              schema: resolver(Multiplayer.User.array()),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const users = await MultiplayerService.getUsers(sessionID)
      return c.json(users)
    },
  )
  // GET /multiplayer/:sessionID/clients - Get clients in session
  .get(
    "/:sessionID/clients",
    describeRoute({
      summary: "Get session clients",
      description: "Get all connected clients in a multiplayer session.",
      operationId: "multiplayer.clients",
      responses: {
        200: {
          description: "List of clients",
          content: {
            "application/json": {
              schema: resolver(Multiplayer.Client.array()),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const clients = await MultiplayerService.getClients(sessionID)
      return c.json(clients)
    },
  )
  // PUT /multiplayer/:sessionID/state - Update session state
  .put(
    "/:sessionID/state",
    describeRoute({
      summary: "Update session state",
      description: "Update the state of a multiplayer session.",
      operationId: "multiplayer.updateState",
      responses: {
        200: {
          description: "State updated",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator(
      "json",
      z.object({
        gitSyncStatus: Multiplayer.GitSyncStatus.optional(),
        agentStatus: Multiplayer.AgentStatus.optional(),
      }),
    ),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const updates = c.req.valid("json")

      const success = await MultiplayerService.updateState(sessionID, updates)

      if (!success) {
        return c.json({ error: "Failed to update state" }, 400)
      }

      return c.json({ success: true })
    },
  )
  // ============================================
  // Prompt Queue Endpoints
  // ============================================
  // POST /multiplayer/:sessionID/prompt - Add prompt to queue
  .post(
    "/:sessionID/prompt",
    describeRoute({
      summary: "Queue prompt",
      description: "Add a prompt to the session queue.",
      operationId: "multiplayer.queuePrompt",
      responses: {
        200: {
          description: "Prompt queued",
          content: {
            "application/json": {
              schema: resolver(Prompt),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator(
      "json",
      z.object({
        userID: z.string().describe("ID of the user submitting the prompt"),
        content: z.string().describe("The prompt content"),
        priority: PromptPriority.optional().describe("Priority level (normal, high, urgent)"),
      }),
    ),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const { userID, content, priority } = c.req.valid("json")

      const prompt = await MultiplayerService.addPrompt(sessionID, userID, content, priority)

      if (!prompt) {
        return c.json({ error: "Failed to queue prompt (session not found or user not in session)" }, 400)
      }

      return c.json(prompt)
    },
  )
  // GET /multiplayer/:sessionID/prompts - Get all prompts in queue
  .get(
    "/:sessionID/prompts",
    describeRoute({
      summary: "Get prompt queue",
      description: "Get all prompts in the session queue.",
      operationId: "multiplayer.getPrompts",
      responses: {
        200: {
          description: "List of prompts",
          content: {
            "application/json": {
              schema: resolver(Prompt.array()),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const prompts = await MultiplayerService.getPrompts(sessionID)
      return c.json(prompts)
    },
  )
  // GET /multiplayer/:sessionID/prompt/:promptID - Get specific prompt
  .get(
    "/:sessionID/prompt/:promptID",
    describeRoute({
      summary: "Get prompt",
      description: "Get a specific prompt by ID.",
      operationId: "multiplayer.getPrompt",
      responses: {
        200: {
          description: "Prompt information",
          content: {
            "application/json": {
              schema: resolver(Prompt),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ sessionID: z.string(), promptID: z.string() })),
    async (c) => {
      const { sessionID, promptID } = c.req.valid("param")
      const prompt = await MultiplayerService.getPrompt(sessionID, promptID)

      if (!prompt) {
        return c.json({ error: "Prompt not found" }, 404)
      }

      return c.json(prompt)
    },
  )
  // DELETE /multiplayer/:sessionID/prompt/:promptID - Cancel prompt
  .delete(
    "/:sessionID/prompt/:promptID",
    describeRoute({
      summary: "Cancel prompt",
      description: "Cancel a queued prompt (users can only cancel their own prompts).",
      operationId: "multiplayer.cancelPrompt",
      responses: {
        200: {
          description: "Prompt cancelled",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string(), promptID: z.string() })),
    validator("json", z.object({ userID: z.string() })),
    async (c) => {
      const { sessionID, promptID } = c.req.valid("param")
      const { userID } = c.req.valid("json")

      const success = await MultiplayerService.cancelPrompt(sessionID, promptID, userID)

      if (!success) {
        return c.json({ error: "Failed to cancel prompt (not found, already executing, or not your prompt)" }, 400)
      }

      return c.json({ success: true })
    },
  )
  // PUT /multiplayer/:sessionID/prompt/:promptID/reorder - Reorder prompt
  .put(
    "/:sessionID/prompt/:promptID/reorder",
    describeRoute({
      summary: "Reorder prompt",
      description: "Move a prompt to a new position in the queue (users can only reorder their own prompts).",
      operationId: "multiplayer.reorderPrompt",
      responses: {
        200: {
          description: "Prompt reordered",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string(), promptID: z.string() })),
    validator(
      "json",
      z.object({
        userID: z.string(),
        newIndex: z.number().describe("New position in the queue (0-based)"),
      }),
    ),
    async (c) => {
      const { sessionID, promptID } = c.req.valid("param")
      const { userID, newIndex } = c.req.valid("json")

      const success = await MultiplayerService.reorderPrompt(sessionID, promptID, userID, newIndex)

      if (!success) {
        return c.json({ error: "Failed to reorder prompt" }, 400)
      }

      return c.json({ success: true })
    },
  )
  // GET /multiplayer/:sessionID/queue/status - Get queue status
  .get(
    "/:sessionID/queue/status",
    describeRoute({
      summary: "Get queue status",
      description: "Get the current status of the prompt queue.",
      operationId: "multiplayer.queueStatus",
      responses: {
        200: {
          description: "Queue status",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  length: z.number(),
                  hasExecuting: z.boolean(),
                  isFull: z.boolean(),
                }),
              ),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const status = await MultiplayerService.getQueueStatus(sessionID)

      if (!status) {
        return c.json({ error: "Session not found" }, 404)
      }

      return c.json(status)
    },
  )
  // POST /multiplayer/:sessionID/queue/start - Start next prompt
  .post(
    "/:sessionID/queue/start",
    describeRoute({
      summary: "Start next prompt",
      description: "Start executing the next prompt in the queue.",
      operationId: "multiplayer.startNextPrompt",
      responses: {
        200: {
          description: "Prompt started or null if none available",
          content: {
            "application/json": {
              schema: resolver(Prompt.nullable()),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const prompt = await MultiplayerService.startNextPrompt(sessionID)
      return c.json(prompt ?? null)
    },
  )
  // POST /multiplayer/:sessionID/queue/complete - Complete current prompt
  .post(
    "/:sessionID/queue/complete",
    describeRoute({
      summary: "Complete current prompt",
      description: "Mark the currently executing prompt as complete.",
      operationId: "multiplayer.completePrompt",
      responses: {
        200: {
          description: "Completed prompt or null if none executing",
          content: {
            "application/json": {
              schema: resolver(Prompt.nullable()),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const prompt = await MultiplayerService.completePrompt(sessionID)
      return c.json(prompt ?? null)
    },
  )
  // GET /multiplayer/:sessionID/queue/executing - Get currently executing prompt
  .get(
    "/:sessionID/queue/executing",
    describeRoute({
      summary: "Get executing prompt",
      description: "Get the currently executing prompt.",
      operationId: "multiplayer.executingPrompt",
      responses: {
        200: {
          description: "Executing prompt or null",
          content: {
            "application/json": {
              schema: resolver(Prompt.nullable()),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      const prompt = await MultiplayerService.getExecutingPrompt(sessionID)
      return c.json(prompt ?? null)
    },
  )
  // GET /multiplayer/:sessionID/ws - WebSocket connection for real-time sync
  .get(
    "/:sessionID/ws",
    describeRoute({
      summary: "WebSocket connection",
      description:
        "Establish a WebSocket connection for real-time multiplayer sync. " +
        "Clients receive events for user join/leave, cursor updates, lock changes, and state changes. " +
        "Clients can send cursor updates, lock requests, and ping messages.",
      operationId: "multiplayer.websocket",
      responses: {
        101: {
          description: "WebSocket upgrade successful",
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: z.string() })),
    validator(
      "query",
      z.object({
        userID: z.string().describe("User ID for the WebSocket connection"),
        clientType: Multiplayer.ClientType.optional().describe("Client type (defaults to web)"),
      }),
    ),
    upgradeWebSocket((c) => {
      const { sessionID } = c.req.param() as { sessionID: string }
      const query = c.req.query()
      const userID = query.userID
      const clientType = (query.clientType as Multiplayer.ClientType) || "web"

      let client: Multiplayer.Client | null = null
      let unsubscribe: (() => void) | null = null
      let wsRef: WSContext | null = null

      return {
        async onOpen(_event, ws) {
          wsRef = ws

          // Check if session exists
          const session = await MultiplayerService.get(sessionID)
          if (!session) {
            sendMessage(ws, {
              type: "error",
              message: "Session not found",
              code: "SESSION_NOT_FOUND",
            })
            ws.close(1008, "Session not found")
            return
          }

          // Check if user is in session
          const users = await MultiplayerService.getUsers(sessionID)
          if (!users.some((u) => u.id === userID)) {
            sendMessage(ws, {
              type: "error",
              message: "User not in session",
              code: "USER_NOT_IN_SESSION",
            })
            ws.close(1008, "User not in session")
            return
          }

          // Connect client
          client = await MultiplayerService.connect(sessionID, {
            userID,
            type: clientType,
          })

          if (!client) {
            sendMessage(ws, {
              type: "error",
              message: "Failed to connect client (limit reached)",
              code: "CLIENT_LIMIT_REACHED",
            })
            ws.close(1008, "Client limit reached")
            return
          }

          // Send initial session snapshot
          const currentSession = await MultiplayerService.get(sessionID)
          if (currentSession) {
            sendMessage(ws, {
              type: "session.snapshot",
              session: currentSession,
            })
          }

          // Subscribe to session events
          unsubscribe = await MultiplayerService.subscribe((event: MultiplayerEvent) => {
            // Only forward events for this session
            if ("sessionID" in event && event.sessionID !== sessionID) {
              return
            }
            // Forward the event to the client
            sendMessage(ws, event)
          })
        },

        async onMessage(event) {
          if (!client || !wsRef) return

          try {
            const data = JSON.parse(String(event.data))
            const parsed = WebSocketMessage.ClientMessage.safeParse(data)

            if (!parsed.success) {
              sendMessage(wsRef, {
                type: "error",
                message: "Invalid message format",
                code: "INVALID_MESSAGE",
              })
              return
            }

            const message = parsed.data

            switch (message.type) {
              case "cursor.update":
                await MultiplayerService.updateCursor(sessionID, userID, message.cursor)
                break

              case "lock.acquire":
                const acquired = await MultiplayerService.acquireLock(sessionID, userID)
                if (!acquired) {
                  const session = await MultiplayerService.get(sessionID)
                  sendMessage(wsRef, {
                    type: "error",
                    message: session?.state.editLock
                      ? `Lock held by ${session.state.editLock}`
                      : "Failed to acquire lock",
                    code: "LOCK_HELD",
                  })
                }
                break

              case "lock.release":
                await MultiplayerService.releaseLock(sessionID, userID)
                break

              case "ping":
                sendMessage(wsRef, { type: "pong" })
                break
            }
          } catch {
            sendMessage(wsRef, {
              type: "error",
              message: "Failed to parse message",
              code: "PARSE_ERROR",
            })
          }
        },

        async onClose() {
          // Unsubscribe from events
          if (unsubscribe) {
            unsubscribe()
          }

          // Disconnect client
          if (client) {
            await MultiplayerService.disconnect(sessionID, client.id)
          }
        },

        onError() {
          // Cleanup on error
          if (unsubscribe) {
            unsubscribe()
          }
          if (client) {
            MultiplayerService.disconnect(sessionID, client.id)
          }
        },
      }
    }),
  )

/**
 * Send a message over WebSocket with proper JSON serialization
 */
function sendMessage(ws: WSContext, message: WebSocketMessage.ServerMessage): void {
  try {
    ws.send(JSON.stringify(message))
  } catch {
    // Ignore send errors (connection may be closing)
  }
}

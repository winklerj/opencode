import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import { MultiplayerService } from "../multiplayer/service"
import { Multiplayer } from "@opencode-ai/multiplayer"
import z from "zod"
import { errors } from "./error"

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

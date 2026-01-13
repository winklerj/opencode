import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { PRSessionService } from "../pr-session/service"
import z from "zod"
import { errors } from "./error"

/**
 * PR Session API Routes
 *
 * Implements the PR Session API from the specification:
 * - POST   /pr-session                    Create session from PR
 * - GET    /pr-session/:prNumber          Get session for PR
 * - GET    /pr-session/:prNumber/comments List addressed comments
 * - POST   /pr-session/:prNumber/respond  Post response to PR comment
 */
export const PRSessionRoute = new Hono()
  // POST / - Create PR session
  .post(
    "/",
    describeRoute({
      summary: "Create PR session",
      description: "Create a new session associated with a GitHub Pull Request.",
      operationId: "prSession.create",
      responses: {
        200: {
          description: "PR session created",
          content: {
            "application/json": {
              schema: resolver(PRSessionService.PRSession),
            },
          },
        },
        ...errors(400, 409),
      },
    }),
    validator("json", PRSessionService.CreateInput),
    async (c) => {
      const body = c.req.valid("json")

      try {
        const session = await PRSessionService.create(body)
        return c.json(session)
      } catch (error) {
        if (error instanceof PRSessionService.AlreadyExistsError) {
          return c.json({ error: "PR session already exists" }, 409)
        }
        throw error
      }
    },
  )
  // GET / - List all PR sessions
  .get(
    "/",
    describeRoute({
      summary: "List PR sessions",
      description: "Get a list of all active PR sessions.",
      operationId: "prSession.list",
      responses: {
        200: {
          description: "List of PR sessions",
          content: {
            "application/json": {
              schema: resolver(PRSessionService.PRSession.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      const sessions = PRSessionService.list()
      return c.json(sessions)
    },
  )
  // GET /:prNumber - Get PR session
  .get(
    "/:prNumber",
    describeRoute({
      summary: "Get PR session",
      description: "Get the session associated with a specific Pull Request.",
      operationId: "prSession.get",
      responses: {
        200: {
          description: "PR session information",
          content: {
            "application/json": {
              schema: resolver(PRSessionService.PRSession),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ prNumber: z.string().transform(Number) })),
    async (c) => {
      const { prNumber } = c.req.valid("param")

      if (isNaN(prNumber)) {
        return c.json({ error: "Invalid PR number" }, 400)
      }

      const session = PRSessionService.get(prNumber)
      if (!session) {
        return c.json({ error: "PR session not found" }, 404)
      }

      return c.json(session)
    },
  )
  // DELETE /:prNumber - Delete PR session
  .delete(
    "/:prNumber",
    describeRoute({
      summary: "Delete PR session",
      description: "Delete the session associated with a Pull Request.",
      operationId: "prSession.delete",
      responses: {
        200: {
          description: "PR session deleted",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ prNumber: z.string().transform(Number) })),
    async (c) => {
      const { prNumber } = c.req.valid("param")

      if (isNaN(prNumber)) {
        return c.json({ error: "Invalid PR number" }, 400)
      }

      const deleted = PRSessionService.remove(prNumber)
      if (!deleted) {
        return c.json({ error: "PR session not found" }, 404)
      }

      return c.json({ success: true })
    },
  )
  // GET /:prNumber/comments - List comments
  .get(
    "/:prNumber/comments",
    describeRoute({
      summary: "List PR comments",
      description: "Get all comments for a Pull Request, optionally filtered by status.",
      operationId: "prSession.listComments",
      responses: {
        200: {
          description: "List of comments",
          content: {
            "application/json": {
              schema: resolver(PRSessionService.Comment.array()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ prNumber: z.string().transform(Number) })),
    validator(
      "query",
      z.object({
        status: PRSessionService.CommentStatus.optional().describe("Filter by comment status"),
      }),
    ),
    async (c) => {
      const { prNumber } = c.req.valid("param")
      const { status } = c.req.valid("query")

      if (isNaN(prNumber)) {
        return c.json({ error: "Invalid PR number" }, 400)
      }

      try {
        const comments = PRSessionService.getComments(prNumber, status)
        return c.json(comments)
      } catch (error) {
        if (error instanceof PRSessionService.NotFoundError) {
          return c.json({ error: "PR session not found" }, 404)
        }
        throw error
      }
    },
  )
  // POST /:prNumber/respond - Respond to a comment
  .post(
    "/:prNumber/respond",
    describeRoute({
      summary: "Respond to PR comment",
      description: "Post a response to a PR comment and optionally update its status.",
      operationId: "prSession.respond",
      responses: {
        200: {
          description: "Comment updated",
          content: {
            "application/json": {
              schema: resolver(PRSessionService.Comment),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ prNumber: z.string().transform(Number) })),
    validator("json", PRSessionService.RespondInput),
    async (c) => {
      const { prNumber } = c.req.valid("param")
      const body = c.req.valid("json")

      if (isNaN(prNumber)) {
        return c.json({ error: "Invalid PR number" }, 400)
      }

      try {
        const comment = await PRSessionService.respond(prNumber, body)
        return c.json(comment)
      } catch (error) {
        if (error instanceof PRSessionService.NotFoundError) {
          return c.json({ error: "PR session not found" }, 404)
        }
        if (error instanceof PRSessionService.CommentNotFoundError) {
          return c.json({ error: "Comment not found" }, 404)
        }
        throw error
      }
    },
  )

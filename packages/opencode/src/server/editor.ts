import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { EditorService } from "../editor/service"
import { SandboxService } from "../sandbox/service"
import z from "zod"
import { errors } from "./error"

/**
 * Editor API Routes
 *
 * Implements the Editor API from the specification:
 * - GET    /sandbox/:id/editor        Get editor URL (redirects to code-server)
 * - POST   /sandbox/:id/editor/start  Start code-server if not running
 * - POST   /sandbox/:id/editor/stop   Stop code-server
 *
 * These routes are mounted under /sandbox/:sandboxID/editor
 */
export const EditorRoute = new Hono()
  // GET / - Get editor URL
  .get(
    "/",
    describeRoute({
      summary: "Get editor URL",
      description:
        "Get the URL for the web-based code editor (code-server). If autoStart is true and the editor is not running, it will be started.",
      operationId: "editor.get",
      responses: {
        200: {
          description: "Editor information",
          content: {
            "application/json": {
              schema: resolver(EditorService.EditorInfo),
            },
          },
        },
        302: {
          description: "Redirect to editor URL (when redirect=true)",
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "query",
      z.object({
        redirect: z.string().optional().describe("If 'true', redirect to editor URL instead of returning JSON"),
        autoStart: z.string().optional().describe("If 'true', automatically start editor if not running"),
      }),
    ),
    async (c) => {
      const sandboxID = c.req.param("sandboxID")
      if (!sandboxID) {
        return c.json({ error: "Sandbox ID is required" }, 400)
      }

      // Verify sandbox exists
      const sandbox = await SandboxService.get(sandboxID)
      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      const { redirect, autoStart } = c.req.valid("query")
      const shouldAutoStart = autoStart === "true"
      const shouldRedirect = redirect === "true"

      let editor = EditorService.get(sandboxID)

      // Auto-start if requested and not running
      if (shouldAutoStart && editor.status !== "running") {
        try {
          editor = await EditorService.start(sandboxID)
        } catch (error) {
          if (!(error instanceof EditorService.AlreadyRunningError)) {
            throw error
          }
          editor = EditorService.get(sandboxID)
        }
      }

      // Redirect to editor URL if requested
      if (shouldRedirect && editor.url) {
        return c.redirect(editor.url)
      }

      return c.json(editor)
    },
  )
  // POST /start - Start editor
  .post(
    "/start",
    describeRoute({
      summary: "Start editor",
      description: "Start the web-based code editor (code-server) for this sandbox.",
      operationId: "editor.start",
      responses: {
        200: {
          description: "Editor started",
          content: {
            "application/json": {
              schema: resolver(EditorService.EditorInfo),
            },
          },
        },
        ...errors(400, 404, 409),
      },
    }),
    validator(
      "json",
      z
        .object({
          type: EditorService.EditorType.optional().describe("Editor type (default: code-server)"),
          port: z.number().optional().describe("Port to run on (default: 8080)"),
        })
        .optional(),
    ),
    async (c) => {
      const sandboxID = c.req.param("sandboxID")
      if (!sandboxID) {
        return c.json({ error: "Sandbox ID is required" }, 400)
      }

      // Verify sandbox exists
      const sandbox = await SandboxService.get(sandboxID)
      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      const body = c.req.valid("json")

      try {
        const editor = await EditorService.start(sandboxID, body?.type, body?.port)
        return c.json(editor)
      } catch (error) {
        if (error instanceof EditorService.AlreadyRunningError) {
          return c.json({ error: "Editor is already running for this sandbox" }, 409)
        }
        throw error
      }
    },
  )
  // POST /stop - Stop editor
  .post(
    "/stop",
    describeRoute({
      summary: "Stop editor",
      description: "Stop the web-based code editor for this sandbox.",
      operationId: "editor.stop",
      responses: {
        200: {
          description: "Editor stopped",
          content: {
            "application/json": {
              schema: resolver(EditorService.EditorInfo),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    async (c) => {
      const sandboxID = c.req.param("sandboxID")
      if (!sandboxID) {
        return c.json({ error: "Sandbox ID is required" }, 400)
      }

      // Verify sandbox exists
      const sandbox = await SandboxService.get(sandboxID)
      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      try {
        const editor = await EditorService.stop(sandboxID)
        return c.json(editor)
      } catch (error) {
        if (error instanceof EditorService.NotRunningError) {
          return c.json({ error: "Editor is not running for this sandbox" }, 404)
        }
        throw error
      }
    },
  )

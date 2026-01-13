import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import { DesktopService } from "../desktop/service"
import { SandboxService } from "../sandbox/service"
import z from "zod"
import { errors } from "./error"

/**
 * Desktop API Routes
 *
 * Implements the Desktop API from the specification:
 * - GET    /sandbox/:id/desktop             Get desktop stream info
 * - POST   /sandbox/:id/desktop/start       Start desktop environment
 * - POST   /sandbox/:id/desktop/stop        Stop desktop environment
 * - GET    /sandbox/:id/desktop/screenshot  Capture screenshot
 * - GET    /sandbox/:id/desktop/ws          WebSocket for VNC stream
 *
 * These routes are mounted under /sandbox/:sandboxID/desktop
 */
export const DesktopRoute = new Hono()
  // GET / - Get desktop stream info
  .get(
    "/",
    describeRoute({
      summary: "Get desktop info",
      description: "Get the current desktop environment status and connection info for a sandbox.",
      operationId: "desktop.get",
      responses: {
        200: {
          description: "Desktop information",
          content: {
            "application/json": {
              schema: resolver(DesktopService.DesktopInfo),
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

      const desktop = DesktopService.get(sandboxID)
      return c.json(desktop)
    },
  )
  // POST /start - Start desktop environment
  .post(
    "/start",
    describeRoute({
      summary: "Start desktop",
      description:
        "Start the desktop environment for visual verification. This starts a VNC server in the sandbox.",
      operationId: "desktop.start",
      responses: {
        200: {
          description: "Desktop started",
          content: {
            "application/json": {
              schema: resolver(DesktopService.DesktopInfo),
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
          width: z.number().optional().describe("Desktop width in pixels (default: 1280)"),
          height: z.number().optional().describe("Desktop height in pixels (default: 720)"),
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
        const desktop = await DesktopService.start(sandboxID, body)
        return c.json(desktop)
      } catch (error) {
        if (error instanceof DesktopService.AlreadyRunningError) {
          return c.json({ error: "Desktop is already running for this sandbox" }, 409)
        }
        throw error
      }
    },
  )
  // POST /stop - Stop desktop environment
  .post(
    "/stop",
    describeRoute({
      summary: "Stop desktop",
      description: "Stop the desktop environment for a sandbox.",
      operationId: "desktop.stop",
      responses: {
        200: {
          description: "Desktop stopped",
          content: {
            "application/json": {
              schema: resolver(DesktopService.DesktopInfo),
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
        const desktop = await DesktopService.stop(sandboxID)
        return c.json(desktop)
      } catch (error) {
        if (error instanceof DesktopService.NotRunningError) {
          return c.json({ error: "Desktop is not running for this sandbox" }, 404)
        }
        throw error
      }
    },
  )
  // GET /screenshot - Capture screenshot
  .get(
    "/screenshot",
    describeRoute({
      summary: "Capture screenshot",
      description: "Capture a screenshot of the current desktop state for visual verification.",
      operationId: "desktop.screenshot",
      responses: {
        200: {
          description: "Screenshot captured",
          content: {
            "application/json": {
              schema: resolver(DesktopService.Screenshot),
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
        const screenshot = await DesktopService.screenshot(sandboxID)
        return c.json(screenshot)
      } catch (error) {
        if (error instanceof DesktopService.NotRunningError) {
          return c.json({ error: "Desktop is not running for this sandbox" }, 404)
        }
        if (error instanceof DesktopService.ScreenshotError) {
          return c.json({ error: error.data.message }, 500)
        }
        throw error
      }
    },
  )
  // GET /ws - WebSocket for VNC stream
  .get(
    "/ws",
    describeRoute({
      summary: "Desktop WebSocket",
      description:
        "WebSocket endpoint for streaming VNC desktop data. Connect to this endpoint to receive real-time desktop updates.",
      operationId: "desktop.ws",
      responses: {
        101: {
          description: "WebSocket connection upgraded",
        },
        ...errors(400, 404),
      },
    }),
    upgradeWebSocket(async (c) => {
      const sandboxID = c.req.param("sandboxID")

      return {
        onOpen(_evt, ws) {
          // Check if desktop is running
          const desktop = DesktopService.get(sandboxID ?? "")
          if (!desktop || desktop.status !== "running") {
            ws.send(JSON.stringify({ type: "error", message: "Desktop not running" }))
            ws.close()
            return
          }

          // Send initial connection info
          ws.send(
            JSON.stringify({
              type: "connected",
              sandboxID,
              vncUrl: desktop.vncUrl,
              resolution: desktop.resolution,
            }),
          )
        },
        onMessage(evt, ws) {
          // In production, this would handle VNC protocol messages
          // For now, echo back acknowledgment
          const data = typeof evt.data === "string" ? evt.data : evt.data.toString()
          try {
            const msg = JSON.parse(data)
            ws.send(JSON.stringify({ type: "ack", received: msg.type }))
          } catch {
            ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }))
          }
        },
        onClose() {
          // Cleanup if needed
        },
        onError(evt) {
          console.error("Desktop WebSocket error:", evt)
        },
      }
    }),
  )

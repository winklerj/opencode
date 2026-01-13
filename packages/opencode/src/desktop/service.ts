import z from "zod"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"

/**
 * Desktop Service
 *
 * Manages desktop environments (VNC-based) for sandboxes.
 * Provides visual verification capabilities for frontend work.
 */
export namespace DesktopService {
  const log = Log.create({ service: "desktop" })

  /**
   * Desktop environment status
   */
  export const Status = z.enum(["stopped", "starting", "running", "stopping", "error"])
  export type Status = z.infer<typeof Status>

  /**
   * Desktop resolution configuration
   */
  export const Resolution = z.object({
    width: z.number().default(1280),
    height: z.number().default(720),
  })
  export type Resolution = z.infer<typeof Resolution>

  /**
   * Desktop environment info
   */
  export const DesktopInfo = z.object({
    sandboxID: z.string(),
    status: Status,
    vncUrl: z.string().optional(),
    vncPort: z.number().optional(),
    resolution: Resolution.optional(),
    startedAt: z.number().optional(),
    error: z.string().optional(),
  })
  export type DesktopInfo = z.infer<typeof DesktopInfo>

  /**
   * Screenshot result
   */
  export const Screenshot = z.object({
    sandboxID: z.string(),
    data: z.string().describe("Base64-encoded PNG image data"),
    mimeType: z.literal("image/png"),
    width: z.number(),
    height: z.number(),
    capturedAt: z.number(),
  })
  export type Screenshot = z.infer<typeof Screenshot>

  // Events
  export const Event = {
    Started: BusEvent.define(
      "desktop.started",
      z.object({
        sandboxID: z.string(),
        vncUrl: z.string(),
      }),
    ),
    Stopped: BusEvent.define(
      "desktop.stopped",
      z.object({
        sandboxID: z.string(),
      }),
    ),
    Error: BusEvent.define(
      "desktop.error",
      z.object({
        sandboxID: z.string(),
        error: z.string(),
      }),
    ),
  }

  // Errors
  export const NotFoundError = NamedError.create(
    "DesktopNotFoundError",
    z.object({
      sandboxID: z.string(),
    }),
  )

  export const AlreadyRunningError = NamedError.create(
    "DesktopAlreadyRunningError",
    z.object({
      sandboxID: z.string(),
    }),
  )

  export const NotRunningError = NamedError.create(
    "DesktopNotRunningError",
    z.object({
      sandboxID: z.string(),
    }),
  )

  export const ScreenshotError = NamedError.create(
    "DesktopScreenshotError",
    z.object({
      sandboxID: z.string(),
      message: z.string(),
    }),
  )

  // In-memory state for desktop sessions
  const desktops = new Map<string, DesktopInfo>()

  /**
   * Get desktop stream info for a sandbox
   */
  export function get(sandboxID: string): DesktopInfo {
    const desktop = desktops.get(sandboxID)
    if (!desktop) {
      return {
        sandboxID,
        status: "stopped",
      }
    }
    return desktop
  }

  /**
   * Start desktop environment for a sandbox
   */
  export async function start(
    sandboxID: string,
    resolution?: { width?: number; height?: number },
  ): Promise<DesktopInfo> {
    log.info("starting desktop environment", { sandboxID, resolution })

    const existing = desktops.get(sandboxID)
    if (existing && (existing.status === "running" || existing.status === "starting")) {
      throw new AlreadyRunningError({ sandboxID })
    }

    const desktopInfo: DesktopInfo = {
      sandboxID,
      status: "starting",
      resolution: {
        width: resolution?.width ?? 1280,
        height: resolution?.height ?? 720,
      },
      startedAt: Date.now(),
    }

    desktops.set(sandboxID, desktopInfo)

    try {
      // In production, this would start a VNC server in the sandbox
      // For now, simulate startup with a placeholder URL
      const vncPort = 5900 + Math.floor(Math.random() * 100)
      const vncUrl = `vnc://localhost:${vncPort}`

      desktopInfo.status = "running"
      desktopInfo.vncUrl = vncUrl
      desktopInfo.vncPort = vncPort

      await Bus.publish(Event.Started, { sandboxID, vncUrl })
      log.info("desktop environment started", { sandboxID, vncUrl })

      return desktopInfo
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      desktopInfo.status = "error"
      desktopInfo.error = message

      await Bus.publish(Event.Error, { sandboxID, error: message })
      throw error
    }
  }

  /**
   * Stop desktop environment for a sandbox
   */
  export async function stop(sandboxID: string): Promise<DesktopInfo> {
    log.info("stopping desktop environment", { sandboxID })

    const existing = desktops.get(sandboxID)
    if (!existing || existing.status === "stopped") {
      throw new NotRunningError({ sandboxID })
    }

    existing.status = "stopping"

    try {
      // In production, this would stop the VNC server
      existing.status = "stopped"
      existing.vncUrl = undefined
      existing.vncPort = undefined

      await Bus.publish(Event.Stopped, { sandboxID })
      log.info("desktop environment stopped", { sandboxID })

      return existing
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      existing.status = "error"
      existing.error = message

      await Bus.publish(Event.Error, { sandboxID, error: message })
      throw error
    }
  }

  /**
   * Capture a screenshot of the desktop
   */
  export async function screenshot(sandboxID: string): Promise<Screenshot> {
    log.info("capturing desktop screenshot", { sandboxID })

    const desktop = desktops.get(sandboxID)
    if (!desktop || desktop.status !== "running") {
      throw new NotRunningError({ sandboxID })
    }

    try {
      // In production, this would capture the actual VNC screen
      // For now, return a placeholder response
      const resolution = desktop.resolution ?? { width: 1280, height: 720 }

      // This would be the actual screenshot data
      const placeholderData = "" // Base64-encoded PNG would go here

      const result: Screenshot = {
        sandboxID,
        data: placeholderData,
        mimeType: "image/png",
        width: resolution.width,
        height: resolution.height,
        capturedAt: Date.now(),
      }

      log.info("desktop screenshot captured", { sandboxID, width: result.width, height: result.height })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      throw new ScreenshotError({ sandboxID, message })
    }
  }

  /**
   * Clean up desktop session
   */
  export function cleanup(sandboxID: string): void {
    desktops.delete(sandboxID)
    log.info("desktop session cleaned up", { sandboxID })
  }

  /**
   * List all active desktop sessions
   */
  export function listActive(): DesktopInfo[] {
    return Array.from(desktops.values()).filter((d) => d.status === "running")
  }
}

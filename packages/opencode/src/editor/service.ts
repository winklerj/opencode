import z from "zod"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"

/**
 * Editor Service
 *
 * Manages code-server (VS Code) instances for sandboxes.
 * Provides web-based IDE capabilities in the sandbox.
 */
export namespace EditorService {
  const log = Log.create({ service: "editor" })

  /**
   * Editor type
   */
  export const EditorType = z.enum(["code-server", "openvscode-server"])
  export type EditorType = z.infer<typeof EditorType>

  /**
   * Editor status
   */
  export const Status = z.enum(["stopped", "starting", "running", "stopping", "error"])
  export type Status = z.infer<typeof Status>

  /**
   * Editor info
   */
  export const EditorInfo = z.object({
    sandboxID: z.string(),
    type: EditorType,
    status: Status,
    url: z.string().optional(),
    port: z.number().optional(),
    startedAt: z.number().optional(),
    error: z.string().optional(),
  })
  export type EditorInfo = z.infer<typeof EditorInfo>

  // Events
  export const Event = {
    Started: BusEvent.define(
      "editor.started",
      z.object({
        sandboxID: z.string(),
        url: z.string(),
      }),
    ),
    Stopped: BusEvent.define(
      "editor.stopped",
      z.object({
        sandboxID: z.string(),
      }),
    ),
    Error: BusEvent.define(
      "editor.error",
      z.object({
        sandboxID: z.string(),
        error: z.string(),
      }),
    ),
  }

  // Errors
  export const AlreadyRunningError = NamedError.create(
    "EditorAlreadyRunningError",
    z.object({
      sandboxID: z.string(),
    }),
  )

  export const NotRunningError = NamedError.create(
    "EditorNotRunningError",
    z.object({
      sandboxID: z.string(),
    }),
  )

  // In-memory state for editor sessions
  const editors = new Map<string, EditorInfo>()

  /**
   * Get editor info for a sandbox
   */
  export function get(sandboxID: string): EditorInfo {
    const editor = editors.get(sandboxID)
    if (!editor) {
      return {
        sandboxID,
        type: "code-server",
        status: "stopped",
      }
    }
    return editor
  }

  /**
   * Start editor (code-server) for a sandbox
   */
  export async function start(
    sandboxID: string,
    type: EditorType = "code-server",
    port: number = 8080,
  ): Promise<EditorInfo> {
    log.info("starting editor", { sandboxID, type, port })

    const existing = editors.get(sandboxID)
    if (existing && (existing.status === "running" || existing.status === "starting")) {
      throw new AlreadyRunningError({ sandboxID })
    }

    const editorInfo: EditorInfo = {
      sandboxID,
      type,
      status: "starting",
      port,
      startedAt: Date.now(),
    }

    editors.set(sandboxID, editorInfo)

    try {
      // In production, this would start code-server in the sandbox
      // For now, simulate startup with a placeholder URL
      const url = `http://localhost:${port}/?folder=/workspace`

      editorInfo.status = "running"
      editorInfo.url = url

      await Bus.publish(Event.Started, { sandboxID, url })
      log.info("editor started", { sandboxID, url })

      return editorInfo
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      editorInfo.status = "error"
      editorInfo.error = message

      await Bus.publish(Event.Error, { sandboxID, error: message })
      throw error
    }
  }

  /**
   * Stop editor for a sandbox
   */
  export async function stop(sandboxID: string): Promise<EditorInfo> {
    log.info("stopping editor", { sandboxID })

    const existing = editors.get(sandboxID)
    if (!existing || existing.status === "stopped") {
      throw new NotRunningError({ sandboxID })
    }

    existing.status = "stopping"

    try {
      // In production, this would stop code-server
      existing.status = "stopped"
      existing.url = undefined

      await Bus.publish(Event.Stopped, { sandboxID })
      log.info("editor stopped", { sandboxID })

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
   * Get editor URL (convenience method that auto-starts if not running)
   */
  export async function getUrl(
    sandboxID: string,
    autoStart: boolean = true,
  ): Promise<string | undefined> {
    const editor = editors.get(sandboxID)

    if (editor?.status === "running" && editor.url) {
      return editor.url
    }

    if (autoStart) {
      const started = await start(sandboxID)
      return started.url
    }

    return undefined
  }

  /**
   * Clean up editor session
   */
  export function cleanup(sandboxID: string): void {
    editors.delete(sandboxID)
    log.info("editor session cleaned up", { sandboxID })
  }

  /**
   * List all active editor sessions
   */
  export function listActive(): EditorInfo[] {
    return Array.from(editors.values()).filter((e) => e.status === "running")
  }
}

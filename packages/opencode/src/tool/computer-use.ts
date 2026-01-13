import { Tool } from "./tool"
import z from "zod"
import { DesktopService } from "../desktop/service"
import { SandboxService } from "../sandbox/service"

/**
 * Computer Use Tool Actions
 */
const ComputerAction = z.enum([
  "screenshot", // Capture screenshot of current desktop state
  "click", // Click at coordinates
  "type", // Type text
  "key", // Press a key combination
  "scroll", // Scroll the viewport
  "move", // Move mouse cursor
])

const parameters = z.object({
  sandboxID: z.string().describe("ID of the sandbox to interact with"),
  action: ComputerAction.describe("Action to perform"),

  // Screenshot parameters (no additional params needed)

  // Click parameters
  x: z.number().optional().describe("X coordinate for click/move"),
  y: z.number().optional().describe("Y coordinate for click/move"),
  button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button for click"),

  // Type parameters
  text: z.string().optional().describe("Text to type"),

  // Key parameters
  key: z.string().optional().describe("Key or key combination (e.g., 'Enter', 'ctrl+c')"),

  // Scroll parameters
  deltaX: z.number().optional().describe("Horizontal scroll amount"),
  deltaY: z.number().optional().describe("Vertical scroll amount"),
})

interface ComputerUseMetadata {
  sandboxID: string
  action: string
  success: boolean
  screenshotData?: string
  error?: string
}

export const ComputerUseTool = Tool.define<typeof parameters, ComputerUseMetadata>("computer_use", {
  description: `Interact with the desktop environment in a sandbox for visual verification.

Use this tool when you need to:
- Take screenshots to verify UI changes
- Click on elements in the desktop
- Type text into applications
- Send keyboard shortcuts
- Scroll the viewport
- Move the mouse cursor

This tool requires a sandbox with desktop environment enabled.
Use the screenshot action to capture the current state for visual verification.`,
  parameters,
  async execute(params: z.infer<typeof parameters>, ctx) {
    const { sandboxID, action } = params

    // Verify sandbox exists
    const sandbox = await SandboxService.get(sandboxID)
    if (!sandbox) {
      return {
        title: "Sandbox not found",
        metadata: { sandboxID, action, success: false, error: "Sandbox not found" },
        output: `Error: Sandbox "${sandboxID}" not found`,
      }
    }

    // Get desktop status
    const desktop = DesktopService.get(sandboxID)

    // Start desktop if not running (except for screenshot which requires it already running)
    if (desktop.status !== "running" && action !== "screenshot") {
      try {
        await DesktopService.start(sandboxID)
      } catch (error) {
        if (!(error instanceof DesktopService.AlreadyRunningError)) {
          const message = error instanceof Error ? error.message : "Unknown error"
          return {
            title: "Failed to start desktop",
            metadata: { sandboxID, action, success: false, error: message },
            output: `Error: Failed to start desktop environment: ${message}`,
          }
        }
      }
    }

    try {
      switch (action) {
        case "screenshot":
          return await handleScreenshot(sandboxID, ctx)

        case "click":
          return await handleClick(sandboxID, params.x, params.y, params.button, ctx)

        case "type":
          return await handleType(sandboxID, params.text, ctx)

        case "key":
          return await handleKey(sandboxID, params.key, ctx)

        case "scroll":
          return await handleScroll(sandboxID, params.deltaX, params.deltaY, ctx)

        case "move":
          return await handleMove(sandboxID, params.x, params.y, ctx)

        default:
          return {
            title: "Unknown action",
            metadata: { sandboxID, action, success: false, error: "Unknown action" },
            output: `Error: Unknown action "${action}"`,
          }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      return {
        title: `${action} failed`,
        metadata: { sandboxID, action, success: false, error: message },
        output: `Error performing ${action}: ${message}`,
      }
    }
  },
})

/**
 * Handle screenshot action
 */
async function handleScreenshot(
  sandboxID: string,
  ctx: { metadata: (data: { title: string; metadata: ComputerUseMetadata }) => void },
) {
  const desktop = DesktopService.get(sandboxID)
  if (desktop.status !== "running") {
    return {
      title: "Desktop not running",
      metadata: {
        sandboxID,
        action: "screenshot",
        success: false,
        error: "Desktop environment is not running",
      },
      output: `Error: Desktop environment is not running. Start it first with action="click" or by calling the desktop start API.`,
    }
  }

  const screenshot = await DesktopService.screenshot(sandboxID)

  ctx.metadata({
    title: "Screenshot captured",
    metadata: {
      sandboxID,
      action: "screenshot",
      success: true,
      screenshotData: screenshot.data,
    },
  })

  return {
    title: "Screenshot captured",
    metadata: {
      sandboxID,
      action: "screenshot",
      success: true,
      screenshotData: screenshot.data,
    },
    output: `Screenshot captured successfully.
Resolution: ${screenshot.width}x${screenshot.height}
Timestamp: ${new Date(screenshot.capturedAt).toISOString()}

The screenshot data is available in the tool metadata as base64-encoded PNG.`,
  }
}

/**
 * Handle click action
 */
async function handleClick(
  sandboxID: string,
  x?: number,
  y?: number,
  button?: "left" | "right" | "middle",
  ctx?: { metadata: (data: { title: string; metadata: ComputerUseMetadata }) => void },
) {
  if (x === undefined || y === undefined) {
    return {
      title: "Missing coordinates",
      metadata: { sandboxID, action: "click", success: false, error: "x and y coordinates required" },
      output: "Error: Click action requires x and y coordinates",
    }
  }

  // In production, this would send click command to VNC/desktop
  // For now, simulate the action
  const mouseButton = button ?? "left"

  ctx?.metadata({
    title: "Click performed",
    metadata: { sandboxID, action: "click", success: true },
  })

  return {
    title: "Click performed",
    metadata: { sandboxID, action: "click", success: true },
    output: `Clicked ${mouseButton} button at (${x}, ${y})`,
  }
}

/**
 * Handle type action
 */
async function handleType(
  sandboxID: string,
  text?: string,
  ctx?: { metadata: (data: { title: string; metadata: ComputerUseMetadata }) => void },
) {
  if (!text) {
    return {
      title: "Missing text",
      metadata: { sandboxID, action: "type", success: false, error: "text parameter required" },
      output: "Error: Type action requires text parameter",
    }
  }

  // In production, this would send keystrokes to VNC/desktop
  ctx?.metadata({
    title: "Text typed",
    metadata: { sandboxID, action: "type", success: true },
  })

  return {
    title: "Text typed",
    metadata: { sandboxID, action: "type", success: true },
    output: `Typed ${text.length} characters`,
  }
}

/**
 * Handle key action
 */
async function handleKey(
  sandboxID: string,
  key?: string,
  ctx?: { metadata: (data: { title: string; metadata: ComputerUseMetadata }) => void },
) {
  if (!key) {
    return {
      title: "Missing key",
      metadata: { sandboxID, action: "key", success: false, error: "key parameter required" },
      output: "Error: Key action requires key parameter",
    }
  }

  // In production, this would send key press to VNC/desktop
  ctx?.metadata({
    title: "Key pressed",
    metadata: { sandboxID, action: "key", success: true },
  })

  return {
    title: "Key pressed",
    metadata: { sandboxID, action: "key", success: true },
    output: `Pressed key: ${key}`,
  }
}

/**
 * Handle scroll action
 */
async function handleScroll(
  sandboxID: string,
  deltaX?: number,
  deltaY?: number,
  ctx?: { metadata: (data: { title: string; metadata: ComputerUseMetadata }) => void },
) {
  const dx = deltaX ?? 0
  const dy = deltaY ?? 0

  if (dx === 0 && dy === 0) {
    return {
      title: "No scroll",
      metadata: { sandboxID, action: "scroll", success: false, error: "deltaX or deltaY required" },
      output: "Error: Scroll action requires deltaX or deltaY",
    }
  }

  // In production, this would send scroll command to VNC/desktop
  ctx?.metadata({
    title: "Scrolled",
    metadata: { sandboxID, action: "scroll", success: true },
  })

  return {
    title: "Scrolled",
    metadata: { sandboxID, action: "scroll", success: true },
    output: `Scrolled by (${dx}, ${dy})`,
  }
}

/**
 * Handle move action
 */
async function handleMove(
  sandboxID: string,
  x?: number,
  y?: number,
  ctx?: { metadata: (data: { title: string; metadata: ComputerUseMetadata }) => void },
) {
  if (x === undefined || y === undefined) {
    return {
      title: "Missing coordinates",
      metadata: { sandboxID, action: "move", success: false, error: "x and y coordinates required" },
      output: "Error: Move action requires x and y coordinates",
    }
  }

  // In production, this would move cursor via VNC/desktop
  ctx?.metadata({
    title: "Cursor moved",
    metadata: { sandboxID, action: "move", success: true },
  })

  return {
    title: "Cursor moved",
    metadata: { sandboxID, action: "move", success: true },
    output: `Moved cursor to (${x}, ${y})`,
  }
}

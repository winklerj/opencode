import { ExtensionMessage, type SelectionResult, type ElementInfo } from "./types"
import { SelectionOverlay } from "./selection-overlay"
import { detectReact } from "./dom-extractor"

/**
 * Content script for Chrome Extension.
 *
 * This script runs in the context of web pages and handles:
 * - Communication between the page and the sidebar
 * - Managing the selection overlay
 * - Extracting DOM/React information
 */

let overlay: SelectionOverlay | null = null
let isInitialized = false

/**
 * Initialize the content script
 */
function initialize(): void {
  if (isInitialized) return
  isInitialized = true

  // Listen for messages from the extension
  chrome.runtime.onMessage.addListener(handleMessage)

  // Notify that content script is ready
  sendToBackground({ type: "content.ready", url: window.location.href })
}

/**
 * Handle messages from the extension (sidebar or background)
 */
function handleMessage(
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
  const parsed = ExtensionMessage.safeParse(message)

  if (!parsed.success) {
    console.warn("[OpenCode] Invalid message:", message)
    sendResponse({ error: "Invalid message format" })
    return false
  }

  const msg = parsed.data

  switch (msg.type) {
    case "selection.start":
      startSelection()
      sendResponse({ ok: true })
      break

    case "selection.cancel":
      cancelSelection()
      sendResponse({ ok: true })
      break

    case "config.update":
      // Store config updates
      sendResponse({ ok: true })
      break

    default:
      sendResponse({ error: "Unknown message type" })
  }

  return true // Keep the message channel open for async response
}

/**
 * Start element selection mode
 */
function startSelection(): void {
  if (overlay?.active) {
    overlay.cancel()
  }

  overlay = new SelectionOverlay()

  overlay.start({
    onHover: (element: ElementInfo | null) => {
      if (element) {
        sendToBackground({
          type: "selection.hover",
          element,
        })
      }
    },
    onSelect: (_elements: ElementInfo[]) => {
      // Update sidebar with current selection
    },
    onComplete: (result: SelectionResult) => {
      sendToBackground({
        type: "selection.complete",
        result,
      })
      overlay = null
    },
    onCancel: () => {
      sendToBackground({ type: "selection.cancel" })
      overlay = null
    },
  })
}

/**
 * Cancel current selection
 */
function cancelSelection(): void {
  overlay?.cancel()
  overlay = null
}

/**
 * Send message to background script
 */
function sendToBackground(message: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      // Extension context may be invalidated
    })
  } catch {
    // Extension not available
  }
}

/**
 * Get page information
 */
export function getPageInfo(): {
  url: string
  title: string
  hasReact: boolean
  reactVersion?: string
} {
  const reactInfo = detectReact()
  return {
    url: window.location.href,
    title: document.title,
    hasReact: reactInfo.hasReact,
    reactVersion: reactInfo.version,
  }
}

// Initialize when the DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize)
} else {
  initialize()
}

// Export for testing
export { initialize, handleMessage, startSelection, cancelSelection }

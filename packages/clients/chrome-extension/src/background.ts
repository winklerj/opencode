import { ExtensionMessage, ExtensionConfig, type TabSession, type SelectionResult } from "./types"

/**
 * Background service worker for Chrome Extension.
 *
 * This script handles:
 * - Communication between content scripts and sidebar
 * - Tab session management
 * - API communication with OpenCode server
 * - Extension lifecycle events
 */

const tabSessions: Map<number, TabSession> = new Map()
let config: ReturnType<typeof ExtensionConfig.parse> | null = null

/**
 * Initialize the background script
 */
function initialize(): void {
  // Load saved configuration
  loadConfig()

  // Set up message listeners
  chrome.runtime.onMessage.addListener(handleMessage)

  // Set up tab event listeners
  chrome.tabs.onRemoved.addListener(handleTabRemoved)
  chrome.tabs.onUpdated.addListener(handleTabUpdated)

  // Set up side panel behavior
  chrome.sidePanel?.setOptions?.({
    enabled: true,
    path: "sidepanel.html",
  })

  // Handle action button click to open side panel
  chrome.action?.onClicked.addListener(async (tab) => {
    if (tab.id) {
      await chrome.sidePanel?.open?.({ tabId: tab.id })
    }
  })
}

/**
 * Load configuration from storage
 */
async function loadConfig(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get("config")
    if (result.config) {
      config = ExtensionConfig.parse(result.config)
    }
  } catch {
    // Use default config
  }
}

/**
 * Save configuration to storage
 */
async function saveConfig(newConfig: Partial<ReturnType<typeof ExtensionConfig.parse>>): Promise<void> {
  const merged = { ...config, ...newConfig }
  config = ExtensionConfig.parse(merged)
  await chrome.storage.sync.set({ config })
}

/**
 * Handle messages from content scripts and sidebar
 */
function handleMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
  const tabId = sender.tab?.id

  // Handle internal messages (not ExtensionMessage format)
  if (typeof message === "object" && message !== null) {
    const msg = message as Record<string, unknown>

    switch (msg.type) {
      case "content.ready":
        if (tabId) {
          handleContentReady(tabId, msg.url as string)
        }
        sendResponse({ ok: true })
        return true

      case "selection.hover":
        // Forward to sidebar
        forwardToSidePanel(message)
        sendResponse({ ok: true })
        return true

      case "selection.complete":
        if (tabId) {
          handleSelectionComplete(tabId, msg.result as SelectionResult)
        }
        forwardToSidePanel(message)
        sendResponse({ ok: true })
        return true

      case "selection.cancel":
        forwardToSidePanel(message)
        sendResponse({ ok: true })
        return true

      case "sidebar.startSelection":
        handleStartSelection(msg.tabId as number)
        sendResponse({ ok: true })
        return true

      case "sidebar.cancelSelection":
        handleCancelSelection(msg.tabId as number)
        sendResponse({ ok: true })
        return true

      case "sidebar.createSession":
        handleCreateSession(msg.tabId as number, msg.prompt as string, msg.selection as SelectionResult | undefined)
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ error: error.message }))
        return true // Async response

      case "sidebar.getTabInfo":
        getTabInfo(msg.tabId as number)
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ error: error.message }))
        return true // Async response

      case "config.get":
        sendResponse({ config })
        return true

      case "config.update":
        saveConfig(msg.config as Partial<ReturnType<typeof ExtensionConfig.parse>>)
          .then(() => sendResponse({ ok: true }))
          .catch((error) => sendResponse({ error: error.message }))
        return true
    }
  }

  sendResponse({ error: "Unknown message type" })
  return true
}

/**
 * Handle content script ready event
 */
function handleContentReady(tabId: number, url: string): void {
  // Initialize tab session if needed
  if (!tabSessions.has(tabId)) {
    tabSessions.set(tabId, {
      tabId,
      lastUpdate: Date.now(),
    })
  }
}

/**
 * Handle selection complete event
 */
function handleSelectionComplete(tabId: number, result: SelectionResult): void {
  const session = tabSessions.get(tabId)
  if (session) {
    session.selection = result
    session.lastUpdate = Date.now()
  }
}

/**
 * Start selection in a tab
 */
async function handleStartSelection(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: "selection.start" })
}

/**
 * Cancel selection in a tab
 */
async function handleCancelSelection(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: "selection.cancel" })
}

/**
 * Create a session with OpenCode
 */
async function handleCreateSession(
  tabId: number,
  prompt: string,
  selection?: SelectionResult,
): Promise<{ sessionID?: string; error?: string }> {
  if (!config?.apiBaseUrl) {
    return { error: "API URL not configured" }
  }

  try {
    const response = await fetch(`${config.apiBaseUrl}/background/spawn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
      },
      body: JSON.stringify({
        task: formatPromptWithContext(prompt, selection),
        type: "parallel-work",
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return { error: `API error: ${error}` }
    }

    const data = (await response.json()) as { id?: string }
    const sessionID = data.id

    if (sessionID) {
      const session = tabSessions.get(tabId)
      if (session) {
        session.sessionID = sessionID
        session.lastUpdate = Date.now()
      }
    }

    return { sessionID }
  } catch (error) {
    return { error: `Request failed: ${error instanceof Error ? error.message : "Unknown error"}` }
  }
}

/**
 * Format prompt with selection context
 */
function formatPromptWithContext(prompt: string, selection?: SelectionResult): string {
  if (!selection?.elements?.length) {
    return prompt
  }

  const contextLines: string[] = [
    `Page: ${selection.pageTitle} (${selection.pageUrl})`,
    selection.hasReact ? `React ${selection.reactVersion ?? "detected"}` : "No React detected",
    "",
    "Selected elements:",
    "",
  ]

  for (const element of selection.elements) {
    contextLines.push(formatElementInfo(element, 0))
  }

  contextLines.push("", "User request:", prompt)

  return contextLines.join("\n")
}

/**
 * Format element info for context
 */
function formatElementInfo(element: { tagName: string; className?: string; id?: string; textContent?: string; reactComponent?: { name: string; props: Record<string, unknown> } }, depth: number): string {
  const indent = "  ".repeat(depth)
  let line = indent

  if (element.reactComponent?.name) {
    line += `<${element.reactComponent.name}>`
  } else {
    line += `<${element.tagName}>`
  }

  if (element.id) {
    line += ` id="${element.id}"`
  }

  if (element.className) {
    line += ` class="${element.className}"`
  }

  if (element.textContent) {
    line += ` "${element.textContent}"`
  }

  return line
}

/**
 * Get tab information
 */
async function getTabInfo(tabId: number): Promise<{
  url?: string
  title?: string
  session?: TabSession
}> {
  try {
    const tab = await chrome.tabs.get(tabId)
    const session = tabSessions.get(tabId)

    return {
      url: tab.url,
      title: tab.title,
      session,
    }
  } catch {
    return {}
  }
}

/**
 * Forward message to side panel
 */
function forwardToSidePanel(message: unknown): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel may not be open
  })
}

/**
 * Handle tab removed event
 */
function handleTabRemoved(tabId: number): void {
  tabSessions.delete(tabId)
}

/**
 * Handle tab updated event
 */
function handleTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo): void {
  if (changeInfo.status === "loading") {
    // Clear session on navigation
    const session = tabSessions.get(tabId)
    if (session) {
      session.selection = undefined
      session.lastUpdate = Date.now()
    }
  }
}

// Initialize background script
initialize()

// Export for testing
export {
  initialize,
  handleMessage,
  handleStartSelection,
  handleCancelSelection,
  handleCreateSession,
  getTabInfo,
  loadConfig,
  saveConfig,
}

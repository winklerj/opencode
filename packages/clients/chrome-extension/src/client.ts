import {
  type ExtensionConfig,
  ExtensionConfig as ExtensionConfigSchema,
  type ExtensionEvent,
  type SelectionResult,
  type TabSession,
} from "./types"

/**
 * ChromeExtensionClient is the main entry point for the Chrome extension integration.
 *
 * This client provides a unified API for:
 * - Managing element selection
 * - Creating sessions with OpenCode
 * - Handling communication between components
 * - Managing extension configuration
 *
 * Note: This client is designed to be used in the sidebar panel context.
 */
export class ChromeExtensionClient {
  private config: ReturnType<typeof ExtensionConfigSchema.parse>
  private listeners: Set<(event: ExtensionEvent) => void> = new Set()
  private currentTabId: number | null = null
  private currentSelection: SelectionResult | null = null

  constructor(config: ExtensionConfig) {
    this.config = ExtensionConfigSchema.parse(config)
    this.setupMessageListener()
  }

  /**
   * Initialize with the current tab
   */
  async initialize(): Promise<void> {
    const tab = await this.getCurrentTab()
    if (tab?.id) {
      this.currentTabId = tab.id
      await this.injectContentScript(tab.id)
    }
  }

  /**
   * Start element selection mode
   */
  async startSelection(): Promise<void> {
    if (!this.currentTabId) {
      throw new Error("No active tab")
    }

    await this.sendToBackground({
      type: "sidebar.startSelection",
      tabId: this.currentTabId,
    })

    this.emit({ type: "selection.started" })
  }

  /**
   * Cancel current selection
   */
  async cancelSelection(): Promise<void> {
    if (!this.currentTabId) return

    await this.sendToBackground({
      type: "sidebar.cancelSelection",
      tabId: this.currentTabId,
    })

    this.currentSelection = null
    this.emit({ type: "selection.cancelled" })
  }

  /**
   * Get current selection
   */
  getSelection(): SelectionResult | null {
    return this.currentSelection
  }

  /**
   * Create a session with OpenCode
   */
  async createSession(prompt: string): Promise<{ sessionID?: string; error?: string }> {
    if (!this.currentTabId) {
      return { error: "No active tab" }
    }

    const result = await this.sendToBackground({
      type: "sidebar.createSession",
      tabId: this.currentTabId,
      prompt,
      selection: this.currentSelection ?? undefined,
    })

    if (typeof result.sessionID === "string") {
      this.emit({ type: "session.created", sessionID: result.sessionID })
    } else if (typeof result.error === "string") {
      this.emit({ type: "error", message: result.error })
    }

    return result
  }

  /**
   * Get information about the current tab
   */
  async getTabInfo(): Promise<{
    url?: string
    title?: string
    session?: TabSession
  }> {
    if (!this.currentTabId) {
      return {}
    }

    return this.sendToBackground({
      type: "sidebar.getTabInfo",
      tabId: this.currentTabId,
    })
  }

  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<ExtensionConfig>): Promise<void> {
    await this.sendToBackground({
      type: "config.update",
      config: updates,
    })

    this.config = ExtensionConfigSchema.parse({ ...this.config, ...updates })
  }

  /**
   * Get current configuration
   */
  getConfig(): ReturnType<typeof ExtensionConfigSchema.parse> {
    return this.config
  }

  /**
   * Subscribe to events
   */
  subscribe(listener: (event: ExtensionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.listeners.clear()
    chrome.runtime?.onMessage.removeListener(this.handleMessage)
  }

  // Private methods

  private async getCurrentTab(): Promise<chrome.tabs.Tab | undefined> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab
  }

  private async injectContentScript(tabId: number): Promise<void> {
    try {
      // Check if content script is already injected
      await chrome.tabs.sendMessage(tabId, { type: "ping" })
    } catch {
      // Content script not injected, inject it
      await chrome.scripting?.executeScript({
        target: { tabId },
        files: ["content.js"],
      })
    }
  }

  private setupMessageListener(): void {
    chrome.runtime?.onMessage.addListener(this.handleMessage)
  }

  private handleMessage = (message: unknown): void => {
    if (typeof message !== "object" || message === null) return

    const msg = message as Record<string, unknown>

    switch (msg.type) {
      case "selection.hover":
        // Could emit hover events if needed
        break

      case "selection.complete":
        this.currentSelection = msg.result as SelectionResult
        this.emit({ type: "selection.completed", result: this.currentSelection })
        break

      case "selection.cancel":
        this.currentSelection = null
        this.emit({ type: "selection.cancelled" })
        break
    }
  }

  private async sendToBackground(message: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve((response as Record<string, unknown>) || {})
      })
    })
  }

  private emit(event: ExtensionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }
}

/**
 * Create a Chrome extension client
 */
export function createChromeExtensionClient(config: ExtensionConfig): ChromeExtensionClient {
  return new ChromeExtensionClient(config)
}

import { WebClient, type ChatPostMessageResponse } from "@slack/web-api"
import {
  type SlackBotConfig,
  type SlackBotEvent,
  type ThreadConversation,
  SlackBotConfig as SlackBotConfigSchema,
} from "./types"
import { WebhookHandler } from "./webhook-handler"
import { ThreadManager } from "./thread-manager"
import { RepositoryClassifier } from "./repository-classifier"
import { BlockKit, type BlockKitMessage } from "./block-kit"

/**
 * SlackBotClient is the main entry point for the Slack bot integration.
 *
 * It provides:
 * - Webhook handling for Slack events
 * - Thread conversation management
 * - Repository classification
 * - Block Kit UI responses
 * - Slack Web API integration
 */
export class SlackBotClient {
  /** Slack Web API client */
  private webClient: WebClient

  /** Webhook handler */
  private webhookHandler: WebhookHandler

  /** Thread manager */
  private threadManager: ThreadManager

  /** Repository classifier */
  private repositoryClassifier: RepositoryClassifier

  /** Configuration */
  private config: ReturnType<typeof SlackBotConfigSchema.parse>

  /** Event listeners */
  private listeners: Set<(event: SlackBotEvent) => void> = new Set()

  constructor(config: SlackBotConfig) {
    this.config = SlackBotConfigSchema.parse(config)

    // Initialize Slack Web API client
    this.webClient = new WebClient(this.config.token)

    // Initialize thread manager
    this.threadManager = new ThreadManager()

    // Initialize repository classifier
    this.repositoryClassifier = new RepositoryClassifier({
      defaultRepository: this.config.defaultRepository,
      defaultBranch: this.config.defaultBranch,
    })

    // Initialize webhook handler
    this.webhookHandler = new WebhookHandler(
      {
        signingSecret: this.config.signingSecret,
        botUserID: this.config.botUserID,
      },
      this.threadManager,
      this.repositoryClassifier,
    )

    // Forward events from webhook handler
    this.webhookHandler.subscribe((event) => this.emit(event))
  }

  /**
   * Handle incoming webhook payload
   */
  async handleWebhook(
    payload: unknown,
    headers?: { timestamp?: string; signature?: string },
  ): Promise<{ handled: boolean; challenge?: string; error?: string }> {
    // Verify signature if provided
    if (headers?.timestamp && headers?.signature && typeof payload === "string") {
      if (!this.webhookHandler.verifySignature(payload, headers.timestamp, headers.signature)) {
        return { handled: false, error: "Invalid signature" }
      }
    }

    return this.webhookHandler.handle(payload)
  }

  /**
   * Post a message to a channel/thread
   */
  async postMessage(
    channel: string,
    message: BlockKitMessage | string,
    threadTs?: string,
  ): Promise<ChatPostMessageResponse> {
    const msg = typeof message === "string" ? { text: message } : message

    const response = await this.webClient.chat.postMessage({
      channel,
      text: msg.text ?? "",
      blocks: msg.blocks,
      attachments: msg.attachments,
      thread_ts: threadTs ?? msg.thread_ts,
      unfurl_links: msg.unfurl_links ?? false,
      unfurl_media: msg.unfurl_media ?? false,
    })

    if (response.ok && response.ts) {
      this.emit({
        type: "response.posted",
        channelID: channel,
        ts: response.ts,
        threadTs,
      })
    }

    return response
  }

  /**
   * Update an existing message
   */
  async updateMessage(
    channel: string,
    ts: string,
    message: BlockKitMessage | string,
  ): Promise<void> {
    const msg = typeof message === "string" ? { text: message } : message

    await this.webClient.chat.update({
      channel,
      ts,
      text: msg.text ?? "",
      blocks: msg.blocks,
      attachments: msg.attachments,
    })
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(channel: string, ts: string, reaction: string): Promise<void> {
    await this.webClient.reactions.add({
      channel,
      timestamp: ts,
      name: reaction,
    })
  }

  /**
   * Remove a reaction from a message
   */
  async removeReaction(channel: string, ts: string, reaction: string): Promise<void> {
    await this.webClient.reactions.remove({
      channel,
      timestamp: ts,
      name: reaction,
    })
  }

  /**
   * Send a processing status message
   */
  async sendProcessingStatus(channel: string, task: string, threadTs?: string): Promise<string> {
    const thread = threadTs ? this.threadManager.get(channel, threadTs) : undefined
    const message = BlockKit.processingMessage(task, thread)

    if (thread) {
      this.threadManager.processing(channel, threadTs!)
    }

    const response = await this.postMessage(channel, message, threadTs)
    return response.ts ?? ""
  }

  /**
   * Send a progress update message
   */
  async sendProgressUpdate(
    channel: string,
    ts: string,
    step: string,
    progress: number,
    details?: string,
  ): Promise<void> {
    const message = BlockKit.progressMessage(step, progress, details)
    await this.updateMessage(channel, ts, message)
  }

  /**
   * Send a completion message
   */
  async sendCompletion(
    channel: string,
    summary: string,
    options?: { threadTs?: string; prUrl?: string; artifacts?: string[] },
  ): Promise<void> {
    if (options?.threadTs) {
      this.threadManager.complete(channel, options.threadTs)
    }

    const message = BlockKit.completeMessage(summary, options)
    await this.postMessage(channel, message, options?.threadTs)

    // Add checkmark reaction to original message
    if (options?.threadTs) {
      try {
        await this.addReaction(channel, options.threadTs, "white_check_mark")
      } catch {
        // Ignore reaction errors
      }
    }
  }

  /**
   * Send an error message
   */
  async sendError(
    channel: string,
    error: string,
    options?: { threadTs?: string; details?: string },
  ): Promise<void> {
    if (options?.threadTs) {
      this.threadManager.error(channel, options.threadTs, error)
    }

    const message = BlockKit.errorMessage(error, options?.details)
    await this.postMessage(channel, message, options?.threadTs)

    this.emit({
      type: "error",
      message: error,
      channelID: channel,
      threadTs: options?.threadTs,
    })
  }

  /**
   * Send a welcome/help message
   */
  async sendWelcome(channel: string, threadTs?: string): Promise<void> {
    const message = BlockKit.welcomeMessage()
    await this.postMessage(channel, message, threadTs)
  }

  /**
   * Send repository context info
   */
  async sendRepositoryContext(channel: string, threadTs?: string): Promise<void> {
    const thread = threadTs ? this.threadManager.get(channel, threadTs) : undefined

    if (thread?.repository) {
      const message = BlockKit.repositoryContextMessage(thread.repository)
      await this.postMessage(channel, message, threadTs)
    }
  }

  /**
   * Send session info
   */
  async sendSessionInfo(channel: string, threadTs: string): Promise<void> {
    const thread = this.threadManager.get(channel, threadTs)
    if (thread) {
      const message = BlockKit.sessionInfoMessage(thread)
      await this.postMessage(channel, message, threadTs)
    }
  }

  /**
   * Associate a session with a thread
   */
  setSession(channel: string, threadTs: string, sessionID: string): void {
    const thread = this.threadManager.setSession(channel, threadTs, sessionID)
    if (thread) {
      this.emit({
        type: "session.created",
        thread,
        sessionID,
      })
    }
  }

  /**
   * Get thread for channel/timestamp
   */
  getThread(channel: string, threadTs: string): ThreadConversation | undefined {
    return this.threadManager.get(channel, threadTs)
  }

  /**
   * Get thread by session ID
   */
  getThreadBySession(sessionID: string): ThreadConversation | undefined {
    return this.threadManager.getBySession(sessionID)
  }

  /**
   * Configure a channel's default repository
   */
  configureChannel(
    channelID: string,
    options: { repository?: string; branch?: string; enabled?: boolean },
  ): void {
    this.repositoryClassifier.configureChannel({
      channelID,
      defaultRepository: options.repository,
      defaultBranch: options.branch,
      enabled: options.enabled ?? true,
    })
  }

  /**
   * Get channel info
   */
  async getChannelInfo(channelID: string): Promise<{ name?: string; topic?: string } | null> {
    try {
      const response = await this.webClient.conversations.info({ channel: channelID })
      if (response.ok && response.channel) {
        const channel = response.channel as { name?: string; topic?: { value?: string } }
        return {
          name: channel.name,
          topic: channel.topic?.value,
        }
      }
    } catch {
      // Ignore errors
    }
    return null
  }

  /**
   * Get user info
   */
  async getUserInfo(userID: string): Promise<{ name?: string; email?: string } | null> {
    try {
      const response = await this.webClient.users.info({ user: userID })
      if (response.ok && response.user) {
        const user = response.user as { name?: string; profile?: { email?: string } }
        return {
          name: user.name,
          email: user.profile?.email,
        }
      }
    } catch {
      // Ignore errors
    }
    return null
  }

  /**
   * Subscribe to events
   */
  subscribe(listener: (event: SlackBotEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Emit an event
   */
  private emit(event: SlackBotEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Get statistics
   */
  stats(): {
    threads: ReturnType<ThreadManager["stats"]>
    channels: number
  } {
    return {
      threads: this.threadManager.stats(),
      channels: this.repositoryClassifier.listChannelConfigs().length,
    }
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.threadManager.dispose()
    this.listeners.clear()
  }
}

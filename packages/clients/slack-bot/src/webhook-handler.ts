import { z } from "zod"
import { createHmac, timingSafeEqual } from "crypto"
import {
  type SlackMessage,
  type SlackBotEvent,
  type SlackBotConfig,
  type ThreadConversation,
  type RepositoryContext,
  SlackWebhook,
} from "./types"
import { ThreadManager } from "./thread-manager"
import { RepositoryClassifier } from "./repository-classifier"

/**
 * Webhook handler configuration
 */
interface WebhookHandlerConfig {
  signingSecret?: string
  botUserID?: string
}

/**
 * Result from handling a webhook
 */
export interface WebhookHandlerResult {
  handled: boolean
  event?: SlackBotEvent
  challenge?: string
  error?: string
}

/**
 * WebhookHandler processes incoming Slack webhook events.
 *
 * Supported events:
 * - app_mention: Bot was mentioned in a channel
 * - message: Message posted in a channel (for thread replies)
 * - reaction_added: Reaction added to a message
 */
export class WebhookHandler {
  private config: WebhookHandlerConfig
  private threadManager: ThreadManager
  private repositoryClassifier: RepositoryClassifier
  private listeners: Set<(event: SlackBotEvent) => void> = new Set()

  constructor(
    config: Pick<SlackBotConfig, "signingSecret" | "botUserID">,
    threadManager: ThreadManager,
    repositoryClassifier: RepositoryClassifier,
  ) {
    this.config = {
      signingSecret: config.signingSecret,
      botUserID: config.botUserID,
    }
    this.threadManager = threadManager
    this.repositoryClassifier = repositoryClassifier
  }

  /**
   * Verify Slack webhook signature
   */
  verifySignature(body: string, timestamp: string, signature: string): boolean {
    if (!this.config.signingSecret) {
      // No secret configured, skip verification
      return true
    }

    if (!signature || !timestamp) return false

    // Check timestamp is not too old (5 minutes)
    const time = parseInt(timestamp, 10)
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - time) > 300) return false

    const baseString = `v0:${timestamp}:${body}`
    const expected = `v0=${createHmac("sha256", this.config.signingSecret).update(baseString).digest("hex")}`

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    } catch {
      return false
    }
  }

  /**
   * Handle incoming webhook event
   */
  async handle(payload: unknown): Promise<WebhookHandlerResult> {
    // Handle URL verification first
    const urlVerification = SlackWebhook.URLVerification.safeParse(payload)
    if (urlVerification.success) {
      return { handled: true, challenge: urlVerification.data.challenge }
    }

    // Handle event callbacks
    const eventCallback = SlackWebhook.EventCallback.safeParse(payload)
    if (!eventCallback.success) {
      return { handled: false, error: "Invalid event callback payload" }
    }

    const data = eventCallback.data
    const event = data.event

    try {
      switch (event.type) {
        case "app_mention":
          return this.handleAppMention(event)
        case "message":
          return this.handleMessage(event)
        case "reaction_added":
          return this.handleReaction(event)
        default:
          return { handled: false, error: `Unsupported event type: ${event.type}` }
      }
    } catch (err) {
      return { handled: false, error: err instanceof Error ? err.message : "Unknown error" }
    }
  }

  /**
   * Handle app_mention event
   */
  private async handleAppMention(event: Record<string, unknown>): Promise<WebhookHandlerResult> {
    const parsed = SlackWebhook.AppMention.safeParse(event)
    if (!parsed.success) {
      return { handled: false, error: `Invalid app_mention payload: ${parsed.error.message}` }
    }

    const data = parsed.data

    // Ignore messages from the bot itself
    if (this.config.botUserID && data.user === this.config.botUserID) {
      return { handled: true }
    }

    const message = this.extractMessage(data)

    // Classify repository from context
    const repository = await this.repositoryClassifier.classify({
      channelID: data.channel,
      text: data.text,
    })

    // Create or get thread for this conversation
    const threadTs = data.thread_ts ?? data.ts
    let thread = this.threadManager.get(data.channel, threadTs)

    if (!thread) {
      thread = this.threadManager.create({
        threadTs,
        channelID: data.channel,
        initiatorUserID: data.user,
        repository,
      })

      const startEvent: SlackBotEvent = { type: "thread.started", thread }
      this.emit(startEvent)
    } else {
      thread = this.threadManager.touch(data.channel, threadTs)
    }

    const botEvent: SlackBotEvent = { type: "mention.received", message, repository }
    this.emit(botEvent)

    return { handled: true, event: botEvent }
  }

  /**
   * Handle message event
   */
  private async handleMessage(event: Record<string, unknown>): Promise<WebhookHandlerResult> {
    const parsed = SlackWebhook.Message.safeParse(event)
    if (!parsed.success) {
      return { handled: false, error: `Invalid message payload: ${parsed.error.message}` }
    }

    const data = parsed.data

    // Ignore bot messages and message subtypes we don't care about
    if (data.subtype && data.subtype !== "file_share") {
      return { handled: true }
    }

    // Ignore messages from the bot itself
    if (this.config.botUserID && data.user === this.config.botUserID) {
      return { handled: true }
    }

    // Only process messages in existing threads
    if (!data.thread_ts) {
      return { handled: true }
    }

    const thread = this.threadManager.get(data.channel, data.thread_ts)
    if (!thread) {
      // Not a thread we're tracking
      return { handled: true }
    }

    const message = this.extractMessage(data)

    // Update thread with new message
    this.threadManager.addMessage(data.channel, data.thread_ts)

    const botEvent: SlackBotEvent = { type: "message.received", message, thread }
    this.emit(botEvent)

    return { handled: true, event: botEvent }
  }

  /**
   * Handle reaction_added event
   */
  private async handleReaction(event: Record<string, unknown>): Promise<WebhookHandlerResult> {
    const parsed = SlackWebhook.ReactionAdded.safeParse(event)
    if (!parsed.success) {
      return { handled: false, error: `Invalid reaction_added payload: ${parsed.error.message}` }
    }

    const data = parsed.data

    // Only handle reactions on messages
    if (data.item.type !== "message" || !data.item.channel || !data.item.ts) {
      return { handled: true }
    }

    // Check if this is a thread we're tracking
    const thread = this.threadManager.get(data.item.channel, data.item.ts)
    if (!thread) {
      return { handled: true }
    }

    // Handle specific reactions (e.g., checkmark to complete, x to cancel)
    switch (data.reaction) {
      case "white_check_mark":
      case "heavy_check_mark":
        this.threadManager.complete(data.item.channel, data.item.ts)
        const completedThread = this.threadManager.get(data.item.channel, data.item.ts)
        if (completedThread) {
          const completeEvent: SlackBotEvent = { type: "thread.completed", thread: completedThread }
          this.emit(completeEvent)
          return { handled: true, event: completeEvent }
        }
        break
    }

    return { handled: true }
  }

  /**
   * Extract SlackMessage from event data
   */
  private extractMessage(data: {
    ts: string
    thread_ts?: string
    channel: string
    user?: string
    text?: string
    files?: Array<{ id: string; name?: string; mimetype?: string; url_private?: string }>
  }): SlackMessage {
    // Extract user mentions from text
    const mentionPattern = /<@([A-Z0-9]+)>/g
    const mentions: string[] = []
    let match
    while ((match = mentionPattern.exec(data.text ?? "")) !== null) {
      mentions.push(match[1]!)
    }

    return {
      ts: data.ts,
      threadTs: data.thread_ts,
      channelID: data.channel,
      userID: data.user ?? "",
      text: data.text ?? "",
      mentions: mentions.length > 0 ? mentions : undefined,
      files: data.files?.map((f) => ({
        id: f.id,
        name: f.name ?? "unknown",
        mimetype: f.mimetype ?? "application/octet-stream",
        url: f.url_private,
      })),
      timestamp: parseFloat(data.ts) * 1000,
    }
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
}

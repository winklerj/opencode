import { z } from "zod"

/**
 * Types for the Slack Bot Client.
 *
 * This client handles:
 * - Receiving Slack events and routing to appropriate handlers
 * - Managing channel/message context for repository classification
 * - Thread conversation tracking for follow-up prompts
 * - Block Kit UI for status updates
 */

/**
 * Repository context inferred from channel/message
 */
export const RepositoryContext = z.object({
  /** Owner/repo format */
  repository: z.string().optional(),
  /** Branch name if determinable */
  branch: z.string().optional(),
  /** How the repository was determined */
  source: z.enum(["channel_topic", "channel_name", "mention", "link", "history", "default"]),
  /** Confidence score 0-1 */
  confidence: z.number().min(0).max(1),
})
export type RepositoryContext = z.infer<typeof RepositoryContext>

/**
 * Channel configuration for repository mapping
 */
export const ChannelConfig = z.object({
  channelID: z.string(),
  channelName: z.string().optional(),
  /** Default repository for this channel */
  defaultRepository: z.string().optional(),
  /** Default branch for this channel */
  defaultBranch: z.string().optional(),
  /** Whether this channel is enabled for the bot */
  enabled: z.boolean().default(true),
})
export type ChannelConfig = z.infer<typeof ChannelConfig>

/**
 * Thread conversation tracking
 */
export const ThreadConversation = z.object({
  /** Slack thread timestamp */
  threadTs: z.string(),
  /** Channel ID */
  channelID: z.string(),
  /** OpenCode session ID */
  sessionID: z.string().optional(),
  /** Repository context for this thread */
  repository: RepositoryContext.optional(),
  /** User who started the thread */
  initiatorUserID: z.string(),
  /** Timestamp when conversation started */
  startedAt: z.number(),
  /** Timestamp of last activity */
  lastActivityAt: z.number(),
  /** Number of messages in thread */
  messageCount: z.number(),
  /** Current status */
  status: z.enum(["active", "processing", "waiting", "completed", "error"]),
  /** Error message if status is error */
  errorMessage: z.string().optional(),
})
export type ThreadConversation = z.infer<typeof ThreadConversation>

/**
 * Slack message for processing
 */
export const SlackMessage = z.object({
  /** Message timestamp (unique ID) */
  ts: z.string(),
  /** Thread timestamp (parent message) */
  threadTs: z.string().optional(),
  /** Channel ID */
  channelID: z.string(),
  /** User ID who sent the message */
  userID: z.string(),
  /** Message text content */
  text: z.string(),
  /** Mentioned users */
  mentions: z.array(z.string()).optional(),
  /** File attachments */
  files: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        mimetype: z.string(),
        url: z.string().optional(),
      }),
    )
    .optional(),
  /** Timestamp when message was sent */
  timestamp: z.number(),
})
export type SlackMessage = z.infer<typeof SlackMessage>

/**
 * Slack Bot client configuration
 */
export const SlackBotConfig = z.object({
  /** Slack Bot OAuth token */
  token: z.string(),
  /** Slack signing secret for webhook verification */
  signingSecret: z.string().optional(),
  /** Bot user ID (for ignoring self-mentions) */
  botUserID: z.string().optional(),
  /** Default repository for unmapped channels */
  defaultRepository: z.string().optional(),
  /** Default branch */
  defaultBranch: z.string().optional().default("main"),
  /** Enable debug logging */
  debug: z.boolean().default(false),
})
export type SlackBotConfig = z.input<typeof SlackBotConfig>

/**
 * Events emitted by the Slack Bot client
 */
export type SlackBotEvent =
  | { type: "mention.received"; message: SlackMessage; repository: RepositoryContext }
  | { type: "message.received"; message: SlackMessage; thread: ThreadConversation }
  | { type: "thread.started"; thread: ThreadConversation }
  | { type: "thread.updated"; thread: ThreadConversation }
  | { type: "thread.completed"; thread: ThreadConversation }
  | { type: "session.created"; thread: ThreadConversation; sessionID: string }
  | { type: "response.posted"; channelID: string; ts: string; threadTs?: string }
  | { type: "error"; message: string; channelID?: string; threadTs?: string }

/**
 * Webhook event types from Slack Events API
 */
export namespace SlackWebhook {
  export const EventCallback = z.object({
    type: z.literal("event_callback"),
    token: z.string().optional(),
    team_id: z.string(),
    api_app_id: z.string(),
    event: z.object({
      type: z.string(),
      user: z.string().optional(),
      channel: z.string().optional(),
      text: z.string().optional(),
      ts: z.string().optional(),
      thread_ts: z.string().optional(),
      event_ts: z.string().optional(),
      reaction: z.string().optional(),
      subtype: z.string().optional(),
      item: z
        .object({
          type: z.string(),
          channel: z.string().optional(),
          ts: z.string().optional(),
        })
        .optional(),
      files: z
        .array(
          z.object({
            id: z.string(),
            name: z.string().optional(),
            mimetype: z.string().optional(),
            url_private: z.string().optional(),
          }),
        )
        .optional(),
    }),
    event_id: z.string(),
    event_time: z.number(),
  })
  export type EventCallback = z.infer<typeof EventCallback>

  export const URLVerification = z.object({
    type: z.literal("url_verification"),
    token: z.string().optional(),
    challenge: z.string(),
  })
  export type URLVerification = z.infer<typeof URLVerification>

  export const AppMention = z.object({
    type: z.literal("app_mention"),
    user: z.string(),
    text: z.string(),
    ts: z.string(),
    channel: z.string(),
    thread_ts: z.string().optional(),
    event_ts: z.string(),
  })
  export type AppMention = z.infer<typeof AppMention>

  export const Message = z.object({
    type: z.literal("message"),
    subtype: z.string().optional(),
    user: z.string().optional(),
    text: z.string().optional(),
    ts: z.string(),
    channel: z.string(),
    thread_ts: z.string().optional(),
    channel_type: z.string().optional(),
    files: z
      .array(
        z.object({
          id: z.string(),
          name: z.string().optional(),
          mimetype: z.string().optional(),
          url_private: z.string().optional(),
        }),
      )
      .optional(),
  })
  export type Message = z.infer<typeof Message>

  export const ReactionAdded = z.object({
    type: z.literal("reaction_added"),
    user: z.string(),
    reaction: z.string(),
    item: z.object({
      type: z.string(),
      channel: z.string().optional(),
      ts: z.string().optional(),
    }),
    event_ts: z.string(),
  })
  export type ReactionAdded = z.infer<typeof ReactionAdded>
}

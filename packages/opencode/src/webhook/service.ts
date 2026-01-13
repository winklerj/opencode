import z from "zod"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { createHmac, timingSafeEqual } from "crypto"

/**
 * Webhook Service
 *
 * Handles incoming webhooks from external integrations:
 * - GitHub (pull requests, comments, etc.)
 * - Slack (events, interactions)
 */
export namespace WebhookService {
  const log = Log.create({ service: "webhook" })

  /**
   * GitHub webhook event types
   */
  export const GitHubEventType = z.enum([
    "pull_request",
    "pull_request_review",
    "pull_request_review_comment",
    "issue_comment",
    "push",
    "check_run",
    "check_suite",
    "workflow_run",
    "ping",
  ])
  export type GitHubEventType = z.infer<typeof GitHubEventType>

  /**
   * GitHub webhook payload
   */
  export const GitHubPayload = z.object({
    action: z.string().optional(),
    repository: z
      .object({
        full_name: z.string(),
        html_url: z.string(),
      })
      .optional(),
    pull_request: z
      .object({
        number: z.number(),
        title: z.string(),
        html_url: z.string(),
        user: z.object({
          login: z.string(),
        }),
        head: z.object({
          ref: z.string(),
        }),
        base: z.object({
          ref: z.string(),
        }),
      })
      .optional(),
    comment: z
      .object({
        id: z.number(),
        body: z.string(),
        user: z.object({
          login: z.string(),
        }),
        html_url: z.string(),
      })
      .optional(),
    sender: z
      .object({
        login: z.string(),
      })
      .optional(),
  })
  export type GitHubPayload = z.infer<typeof GitHubPayload>

  /**
   * GitHub webhook result
   */
  export const GitHubResult = z.object({
    received: z.boolean(),
    event: GitHubEventType,
    action: z.string().optional(),
    repository: z.string().optional(),
    handled: z.boolean(),
  })
  export type GitHubResult = z.infer<typeof GitHubResult>

  /**
   * Slack event types
   */
  export const SlackEventType = z.enum([
    "url_verification",
    "app_mention",
    "message",
    "reaction_added",
    "reaction_removed",
    "app_home_opened",
    "member_joined_channel",
  ])
  export type SlackEventType = z.infer<typeof SlackEventType>

  /**
   * Slack event payload
   */
  export const SlackEventPayload = z.object({
    type: z.string(),
    challenge: z.string().optional(), // For url_verification
    token: z.string().optional(),
    team_id: z.string().optional(),
    event: z
      .object({
        type: z.string(),
        user: z.string().optional(),
        channel: z.string().optional(),
        text: z.string().optional(),
        ts: z.string().optional(),
        thread_ts: z.string().optional(),
      })
      .optional(),
  })
  export type SlackEventPayload = z.infer<typeof SlackEventPayload>

  /**
   * Slack event result
   */
  export const SlackEventResult = z.object({
    received: z.boolean(),
    type: z.string(),
    challenge: z.string().optional(),
    handled: z.boolean(),
  })
  export type SlackEventResult = z.infer<typeof SlackEventResult>

  /**
   * Slack interaction payload
   */
  export const SlackInteractionPayload = z.object({
    type: z.string(),
    trigger_id: z.string().optional(),
    user: z
      .object({
        id: z.string(),
        name: z.string().optional(),
      })
      .optional(),
    channel: z
      .object({
        id: z.string(),
        name: z.string().optional(),
      })
      .optional(),
    actions: z
      .array(
        z.object({
          action_id: z.string(),
          value: z.string().optional(),
        }),
      )
      .optional(),
    message: z
      .object({
        ts: z.string(),
        text: z.string().optional(),
      })
      .optional(),
    response_url: z.string().optional(),
  })
  export type SlackInteractionPayload = z.infer<typeof SlackInteractionPayload>

  /**
   * Slack interaction result
   */
  export const SlackInteractionResult = z.object({
    received: z.boolean(),
    type: z.string(),
    handled: z.boolean(),
    response: z.unknown().optional(),
  })
  export type SlackInteractionResult = z.infer<typeof SlackInteractionResult>

  // Events
  export const Event = {
    GitHubReceived: BusEvent.define(
      "webhook.github.received",
      z.object({
        event: GitHubEventType,
        action: z.string().optional(),
        repository: z.string().optional(),
      }),
    ),
    SlackEventReceived: BusEvent.define(
      "webhook.slack.event.received",
      z.object({
        type: z.string(),
        channel: z.string().optional(),
        user: z.string().optional(),
      }),
    ),
    SlackInteractionReceived: BusEvent.define(
      "webhook.slack.interaction.received",
      z.object({
        type: z.string(),
        user: z.string().optional(),
      }),
    ),
  }

  // Errors
  export const InvalidSignatureError = NamedError.create(
    "WebhookInvalidSignatureError",
    z.object({
      source: z.enum(["github", "slack"]),
    }),
  )

  export const InvalidPayloadError = NamedError.create(
    "WebhookInvalidPayloadError",
    z.object({
      source: z.enum(["github", "slack"]),
      message: z.string(),
    }),
  )

  /**
   * Verify GitHub webhook signature
   */
  export function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
    if (!signature) return false

    const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    } catch {
      return false
    }
  }

  /**
   * Verify Slack request signature
   */
  export function verifySlackSignature(
    body: string,
    timestamp: string,
    signature: string,
    secret: string,
  ): boolean {
    if (!signature || !timestamp) return false

    // Check timestamp is not too old (5 minutes)
    const time = parseInt(timestamp, 10)
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - time) > 300) return false

    const baseString = `v0:${timestamp}:${body}`
    const expected = `v0=${createHmac("sha256", secret).update(baseString).digest("hex")}`

    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    } catch {
      return false
    }
  }

  /**
   * Handle GitHub webhook
   */
  export async function handleGitHub(event: GitHubEventType, payload: GitHubPayload): Promise<GitHubResult> {
    log.info("handling GitHub webhook", {
      event,
      action: payload.action,
      repository: payload.repository?.full_name,
    })

    const result: GitHubResult = {
      received: true,
      event,
      action: payload.action,
      repository: payload.repository?.full_name,
      handled: false,
    }

    // Publish event for other components to handle
    await Bus.publish(Event.GitHubReceived, {
      event,
      action: payload.action,
      repository: payload.repository?.full_name,
    })

    // In production, this would route to appropriate handlers
    // For now, just acknowledge receipt
    switch (event) {
      case "ping":
        result.handled = true
        break
      case "pull_request":
      case "pull_request_review_comment":
      case "issue_comment":
        // These would trigger PR session handling
        result.handled = true
        break
      default:
        result.handled = false
    }

    log.info("GitHub webhook handled", result)
    return result
  }

  /**
   * Handle Slack event
   */
  export async function handleSlackEvent(payload: SlackEventPayload): Promise<SlackEventResult> {
    log.info("handling Slack event", { type: payload.type })

    // Handle URL verification challenge
    if (payload.type === "url_verification") {
      return {
        received: true,
        type: payload.type,
        challenge: payload.challenge,
        handled: true,
      }
    }

    const result: SlackEventResult = {
      received: true,
      type: payload.event?.type ?? payload.type,
      handled: false,
    }

    // Publish event for other components to handle
    await Bus.publish(Event.SlackEventReceived, {
      type: payload.event?.type ?? payload.type,
      channel: payload.event?.channel,
      user: payload.event?.user,
    })

    // In production, this would route to appropriate handlers
    switch (payload.event?.type) {
      case "app_mention":
      case "message":
        // Would trigger conversation handling
        result.handled = true
        break
      default:
        result.handled = false
    }

    log.info("Slack event handled", result)
    return result
  }

  /**
   * Handle Slack interaction
   */
  export async function handleSlackInteraction(
    payload: SlackInteractionPayload,
  ): Promise<SlackInteractionResult> {
    log.info("handling Slack interaction", { type: payload.type })

    const result: SlackInteractionResult = {
      received: true,
      type: payload.type,
      handled: false,
    }

    // Publish event for other components to handle
    await Bus.publish(Event.SlackInteractionReceived, {
      type: payload.type,
      user: payload.user?.id,
    })

    // In production, this would route to appropriate handlers
    switch (payload.type) {
      case "block_actions":
      case "view_submission":
      case "shortcut":
        result.handled = true
        break
      default:
        result.handled = false
    }

    log.info("Slack interaction handled", result)
    return result
  }
}

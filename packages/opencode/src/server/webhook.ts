import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { WebhookService } from "../webhook/service"
import z from "zod"
import { errors } from "./error"

/**
 * Webhook API Routes
 *
 * Implements the Integration Webhooks API from the specification:
 * - POST   /webhook/github             GitHub webhook receiver
 * - POST   /webhook/slack/events       Slack events
 * - POST   /webhook/slack/interactions Slack interactions
 */
export const WebhookRoute = new Hono()
  // POST /github - GitHub webhook receiver
  .post(
    "/github",
    describeRoute({
      summary: "GitHub webhook",
      description:
        "Receive webhooks from GitHub for pull requests, comments, and other repository events.",
      operationId: "webhook.github",
      responses: {
        200: {
          description: "Webhook received",
          content: {
            "application/json": {
              schema: resolver(WebhookService.GitHubResult),
            },
          },
        },
        ...errors(400, 401),
      },
    }),
    async (c) => {
      // Get GitHub event type from header
      const eventType = c.req.header("X-GitHub-Event")
      if (!eventType) {
        return c.json({ error: "Missing X-GitHub-Event header" }, 400)
      }

      // Validate event type
      const eventResult = WebhookService.GitHubEventType.safeParse(eventType)
      if (!eventResult.success) {
        return c.json({ error: `Unsupported event type: ${eventType}` }, 400)
      }

      // Parse payload
      let payload: WebhookService.GitHubPayload
      try {
        const body = await c.req.json()
        const payloadResult = WebhookService.GitHubPayload.safeParse(body)
        if (!payloadResult.success) {
          return c.json({ error: "Invalid payload format" }, 400)
        }
        payload = payloadResult.data
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400)
      }

      // In production, verify signature:
      // const signature = c.req.header("X-Hub-Signature-256")
      // const secret = process.env.GITHUB_WEBHOOK_SECRET
      // if (secret && signature) {
      //   const rawBody = await c.req.text()
      //   if (!WebhookService.verifyGitHubSignature(rawBody, signature, secret)) {
      //     return c.json({ error: "Invalid signature" }, 401)
      //   }
      // }

      const result = await WebhookService.handleGitHub(eventResult.data, payload)
      return c.json(result)
    },
  )
  // POST /slack/events - Slack events
  .post(
    "/slack/events",
    describeRoute({
      summary: "Slack events",
      description:
        "Receive events from Slack including app mentions, messages, and reactions.",
      operationId: "webhook.slackEvents",
      responses: {
        200: {
          description: "Event received",
          content: {
            "application/json": {
              schema: resolver(
                z.union([
                  WebhookService.SlackEventResult,
                  z.object({ challenge: z.string() }), // URL verification response
                ]),
              ),
            },
          },
        },
        ...errors(400, 401),
      },
    }),
    async (c) => {
      // Parse payload
      let payload: WebhookService.SlackEventPayload
      try {
        const body = await c.req.json()
        const payloadResult = WebhookService.SlackEventPayload.safeParse(body)
        if (!payloadResult.success) {
          return c.json({ error: "Invalid payload format" }, 400)
        }
        payload = payloadResult.data
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400)
      }

      // In production, verify signature:
      // const timestamp = c.req.header("X-Slack-Request-Timestamp")
      // const signature = c.req.header("X-Slack-Signature")
      // const secret = process.env.SLACK_SIGNING_SECRET
      // if (secret && timestamp && signature) {
      //   const rawBody = await c.req.text()
      //   if (!WebhookService.verifySlackSignature(rawBody, timestamp, signature, secret)) {
      //     return c.json({ error: "Invalid signature" }, 401)
      //   }
      // }

      const result = await WebhookService.handleSlackEvent(payload)

      // For URL verification, return just the challenge
      if (result.challenge) {
        return c.json({ challenge: result.challenge })
      }

      return c.json(result)
    },
  )
  // POST /slack/interactions - Slack interactions
  .post(
    "/slack/interactions",
    describeRoute({
      summary: "Slack interactions",
      description:
        "Receive interaction payloads from Slack for button clicks, modal submissions, and shortcuts.",
      operationId: "webhook.slackInteractions",
      responses: {
        200: {
          description: "Interaction received",
          content: {
            "application/json": {
              schema: resolver(WebhookService.SlackInteractionResult),
            },
          },
        },
        ...errors(400, 401),
      },
    }),
    async (c) => {
      // Slack sends interaction payloads as form-encoded data with a 'payload' field
      let payload: WebhookService.SlackInteractionPayload
      try {
        const contentType = c.req.header("Content-Type")

        if (contentType?.includes("application/x-www-form-urlencoded")) {
          const formData = await c.req.parseBody()
          const payloadStr = formData["payload"]
          if (typeof payloadStr !== "string") {
            return c.json({ error: "Missing payload field" }, 400)
          }
          const parsed = JSON.parse(payloadStr)
          const payloadResult = WebhookService.SlackInteractionPayload.safeParse(parsed)
          if (!payloadResult.success) {
            return c.json({ error: "Invalid payload format" }, 400)
          }
          payload = payloadResult.data
        } else {
          // Also support JSON for testing
          const body = await c.req.json()
          const payloadResult = WebhookService.SlackInteractionPayload.safeParse(body)
          if (!payloadResult.success) {
            return c.json({ error: "Invalid payload format" }, 400)
          }
          payload = payloadResult.data
        }
      } catch {
        return c.json({ error: "Invalid request body" }, 400)
      }

      // In production, verify signature (same as events)

      const result = await WebhookService.handleSlackInteraction(payload)
      return c.json(result)
    },
  )

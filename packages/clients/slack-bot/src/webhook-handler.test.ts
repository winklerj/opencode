import { describe, test, expect, beforeEach } from "bun:test"
import { WebhookHandler } from "./webhook-handler"
import { ThreadManager } from "./thread-manager"
import { RepositoryClassifier } from "./repository-classifier"
import type { SlackBotEvent } from "./types"

describe("WebhookHandler", () => {
  let handler: WebhookHandler
  let threadManager: ThreadManager
  let repositoryClassifier: RepositoryClassifier
  let events: SlackBotEvent[]

  beforeEach(() => {
    threadManager = new ThreadManager({ cleanupIntervalMs: 1000000 }) // Disable cleanup
    repositoryClassifier = new RepositoryClassifier()
    handler = new WebhookHandler(
      { signingSecret: undefined, botUserID: "U_BOT" },
      threadManager,
      repositoryClassifier,
    )
    events = []
    handler.subscribe((event) => events.push(event))
  })

  describe("verifySignature", () => {
    test("returns true when no secret configured", () => {
      expect(handler.verifySignature("body", "123", "sig")).toBe(true)
    })

    test("returns false for invalid timestamp", () => {
      const handlerWithSecret = new WebhookHandler(
        { signingSecret: "secret", botUserID: undefined },
        threadManager,
        repositoryClassifier,
      )
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600)
      expect(handlerWithSecret.verifySignature("body", oldTimestamp, "sig")).toBe(false)
    })
  })

  describe("handle", () => {
    test("handles URL verification", async () => {
      const result = await handler.handle({
        type: "url_verification",
        challenge: "test-challenge",
      })

      expect(result.handled).toBe(true)
      expect(result.challenge).toBe("test-challenge")
    })

    test("handles app_mention event", async () => {
      const result = await handler.handle({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event: {
          type: "app_mention",
          user: "U_USER",
          text: "Hello <@U_BOT>",
          ts: "1234567890.123456",
          channel: "C123",
          event_ts: "1234567890.123456",
        },
        event_id: "E123",
        event_time: 1234567890,
      })

      expect(result.handled).toBe(true)
      expect(result.event?.type).toBe("mention.received")
      expect(events.length).toBe(2) // thread.started + mention.received
    })

    test("ignores app_mention from bot itself", async () => {
      const result = await handler.handle({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event: {
          type: "app_mention",
          user: "U_BOT",
          text: "Hello",
          ts: "1234567890.123456",
          channel: "C123",
          event_ts: "1234567890.123456",
        },
        event_id: "E123",
        event_time: 1234567890,
      })

      expect(result.handled).toBe(true)
      expect(result.event).toBeUndefined()
      expect(events.length).toBe(0)
    })

    test("handles message in tracked thread", async () => {
      // First create a thread via app_mention
      await handler.handle({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event: {
          type: "app_mention",
          user: "U_USER",
          text: "Start thread",
          ts: "1234567890.123456",
          channel: "C123",
          event_ts: "1234567890.123456",
        },
        event_id: "E123",
        event_time: 1234567890,
      })

      events = [] // Reset

      // Then send a follow-up message
      const result = await handler.handle({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event: {
          type: "message",
          user: "U_USER",
          text: "Follow up",
          ts: "1234567890.123457",
          thread_ts: "1234567890.123456",
          channel: "C123",
        },
        event_id: "E124",
        event_time: 1234567891,
      })

      expect(result.handled).toBe(true)
      expect(result.event?.type).toBe("message.received")
    })

    test("ignores message in untracked thread", async () => {
      const result = await handler.handle({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event: {
          type: "message",
          user: "U_USER",
          text: "Random message",
          ts: "1234567890.123456",
          thread_ts: "1234567890.000000",
          channel: "C123",
        },
        event_id: "E123",
        event_time: 1234567890,
      })

      expect(result.handled).toBe(true)
      expect(result.event).toBeUndefined()
    })

    test("ignores non-thread messages", async () => {
      const result = await handler.handle({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event: {
          type: "message",
          user: "U_USER",
          text: "Channel message",
          ts: "1234567890.123456",
          channel: "C123",
        },
        event_id: "E123",
        event_time: 1234567890,
      })

      expect(result.handled).toBe(true)
      expect(result.event).toBeUndefined()
    })

    test("handles reaction to complete thread", async () => {
      // Create a thread first
      await handler.handle({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event: {
          type: "app_mention",
          user: "U_USER",
          text: "Task",
          ts: "1234567890.123456",
          channel: "C123",
          event_ts: "1234567890.123456",
        },
        event_id: "E123",
        event_time: 1234567890,
      })

      events = []

      // Add checkmark reaction
      const result = await handler.handle({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event: {
          type: "reaction_added",
          user: "U_USER",
          reaction: "white_check_mark",
          item: {
            type: "message",
            channel: "C123",
            ts: "1234567890.123456",
          },
          event_ts: "1234567890.123457",
        },
        event_id: "E124",
        event_time: 1234567891,
      })

      expect(result.handled).toBe(true)
      expect(result.event?.type).toBe("thread.completed")
    })

    test("returns error for unsupported event type", async () => {
      const result = await handler.handle({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event: {
          type: "unknown_event",
        },
        event_id: "E123",
        event_time: 1234567890,
      })

      expect(result.handled).toBe(false)
      expect(result.error).toContain("Unsupported event type")
    })

    test("returns error for invalid payload", async () => {
      const result = await handler.handle({ invalid: "payload" })

      expect(result.handled).toBe(false)
      expect(result.error).toBe("Invalid event callback payload")
    })
  })

  describe("subscribe", () => {
    test("can unsubscribe from events", async () => {
      const unsubscribe = handler.subscribe(() => {})
      unsubscribe()

      await handler.handle({
        type: "event_callback",
        team_id: "T123",
        api_app_id: "A123",
        event: {
          type: "app_mention",
          user: "U_USER",
          text: "Hello",
          ts: "1234567890.123456",
          channel: "C123",
          event_ts: "1234567890.123456",
        },
        event_id: "E123",
        event_time: 1234567890,
      })

      // Only original listener should receive events
      expect(events.length).toBeGreaterThan(0)
    })
  })
})

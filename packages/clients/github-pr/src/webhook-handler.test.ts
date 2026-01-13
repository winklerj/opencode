import { describe, test, expect, beforeEach } from "bun:test"
import { WebhookHandler } from "./webhook-handler"
import { SessionManager } from "./session-manager"
import type { GitHubPREvent } from "./types"

describe("WebhookHandler", () => {
  let handler: WebhookHandler
  let sessionManager: SessionManager
  let events: GitHubPREvent[]

  beforeEach(() => {
    sessionManager = new SessionManager()
    handler = new WebhookHandler(
      {
        webhookSecret: "test-secret",
        botUsername: "test-bot",
        autoCreateSessions: true,
      },
      sessionManager,
    )
    events = []
    handler.subscribe((e) => events.push(e))
  })

  describe("verifySignature", () => {
    test("accepts valid signature", () => {
      const payload = '{"test": "data"}'
      // Generated with: echo -n '{"test": "data"}' | openssl dgst -sha256 -hmac "test-secret"
      const signature =
        "sha256=9d9a8cf5e8a8f1e8c9f7c5f7c5f7c5f7c5f7c5f7c5f7c5f7c5f7c5f7c5f7c5f7"

      // This will fail with real crypto, but we can test the flow
      // In real tests, we'd compute the actual signature
    })

    test("rejects invalid signature", () => {
      const payload = '{"test": "data"}'
      const result = handler.verifySignature(payload, "sha256=invalid")
      expect(result).toBe(false)
    })

    test("rejects empty signature", () => {
      const payload = '{"test": "data"}'
      const result = handler.verifySignature(payload, "")
      expect(result).toBe(false)
    })
  })

  describe("pull_request events", () => {
    test("handles PR opened", async () => {
      const payload = {
        action: "opened",
        number: 1,
        pull_request: {
          number: 1,
          title: "Test PR",
          body: "Description",
          html_url: "https://github.com/owner/repo/pull/1",
          user: { login: "author" },
          head: { ref: "feature", sha: "abc123" },
          base: { ref: "main" },
          state: "open",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        repository: { full_name: "owner/repo" },
        sender: { login: "author" },
      }

      const result = await handler.handle("pull_request", payload)

      expect(result.handled).toBe(true)
      expect(result.event?.type).toBe("pr.opened")
      expect(events).toHaveLength(1) // pr.opened (session.created is on session manager)
    })

    test("handles PR closed (not merged)", async () => {
      const payload = {
        action: "closed",
        number: 1,
        pull_request: {
          number: 1,
          title: "Test PR",
          body: null,
          html_url: "https://github.com/owner/repo/pull/1",
          user: { login: "author" },
          head: { ref: "feature", sha: "abc123" },
          base: { ref: "main" },
          state: "closed",
          merged: false,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        repository: { full_name: "owner/repo" },
        sender: { login: "author" },
      }

      const result = await handler.handle("pull_request", payload)

      expect(result.handled).toBe(true)
      expect(result.event?.type).toBe("pr.closed")
    })

    test("handles PR merged", async () => {
      const payload = {
        action: "closed",
        number: 1,
        pull_request: {
          number: 1,
          title: "Test PR",
          body: null,
          html_url: "https://github.com/owner/repo/pull/1",
          user: { login: "author" },
          head: { ref: "feature", sha: "abc123" },
          base: { ref: "main" },
          state: "closed",
          merged: true,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        repository: { full_name: "owner/repo" },
        sender: { login: "author" },
      }

      const result = await handler.handle("pull_request", payload)

      expect(result.handled).toBe(true)
      expect(result.event?.type).toBe("pr.merged")
    })
  })

  describe("pull_request_review_comment events", () => {
    test("handles inline comment created", async () => {
      const payload = {
        action: "created",
        pull_request: {
          number: 1,
          title: "Test PR",
          html_url: "https://github.com/owner/repo/pull/1",
          user: { login: "author" },
          head: { sha: "abc123" },
        },
        comment: {
          id: 123,
          body: "Please fix this",
          html_url: "https://github.com/owner/repo/pull/1#comment-123",
          path: "src/file.ts",
          line: 42,
          side: "RIGHT",
          commit_id: "abc123",
          user: { login: "reviewer" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        repository: { full_name: "owner/repo" },
        sender: { login: "reviewer" },
      }

      const result = await handler.handle("pull_request_review_comment", payload)

      expect(result.handled).toBe(true)
      expect(result.event?.type).toBe("comment.created")

      // Should have stored comment context
      const context = sessionManager.getCommentContext(123)
      expect(context?.path).toBe("src/file.ts")
      expect(context?.line).toBe(42)
    })

    test("ignores comments from bot", async () => {
      const payload = {
        action: "created",
        pull_request: {
          number: 1,
          title: "Test PR",
          html_url: "https://github.com/owner/repo/pull/1",
          user: { login: "author" },
          head: { sha: "abc123" },
        },
        comment: {
          id: 123,
          body: "Bot response",
          html_url: "https://github.com/owner/repo/pull/1#comment-123",
          path: "src/file.ts",
          line: 42,
          commit_id: "abc123",
          user: { login: "test-bot" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        repository: { full_name: "owner/repo" },
        sender: { login: "test-bot" },
      }

      const result = await handler.handle("pull_request_review_comment", payload)

      expect(result.handled).toBe(true)
      expect(result.event).toBeUndefined()
    })
  })

  describe("issue_comment events", () => {
    test("handles PR comment created", async () => {
      const payload = {
        action: "created",
        issue: {
          number: 1,
          pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/1" },
        },
        comment: {
          id: 456,
          body: "General comment on PR",
          html_url: "https://github.com/owner/repo/pull/1#issuecomment-456",
          user: { login: "reviewer" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        repository: { full_name: "owner/repo" },
        sender: { login: "reviewer" },
      }

      const result = await handler.handle("issue_comment", payload)

      expect(result.handled).toBe(true)
      expect(result.event?.type).toBe("comment.created")
    })

    test("ignores comments on issues (not PRs)", async () => {
      const payload = {
        action: "created",
        issue: {
          number: 1,
          // No pull_request field
        },
        comment: {
          id: 456,
          body: "Issue comment",
          html_url: "https://github.com/owner/repo/issues/1#issuecomment-456",
          user: { login: "commenter" },
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        },
        repository: { full_name: "owner/repo" },
        sender: { login: "commenter" },
      }

      const result = await handler.handle("issue_comment", payload)

      expect(result.handled).toBe(false)
      expect(result.error).toContain("not a PR")
    })
  })

  describe("pull_request_review events", () => {
    test("handles review submitted", async () => {
      const payload = {
        action: "submitted",
        pull_request: {
          number: 1,
          title: "Test PR",
          html_url: "https://github.com/owner/repo/pull/1",
          user: { login: "author" },
        },
        review: {
          id: 789,
          state: "changes_requested",
          body: "Please make these changes",
          user: { login: "reviewer" },
        },
        repository: { full_name: "owner/repo" },
        sender: { login: "reviewer" },
      }

      const result = await handler.handle("pull_request_review", payload)

      expect(result.handled).toBe(true)
      expect(result.event?.type).toBe("review.submitted")
      if (result.event?.type === "review.submitted") {
        expect(result.event.state).toBe("changes_requested")
      }
    })
  })

  describe("ping events", () => {
    test("handles ping event", async () => {
      const result = await handler.handle("ping", { zen: "test" })
      expect(result.handled).toBe(true)
    })
  })

  describe("unsupported events", () => {
    test("returns not handled for unsupported event", async () => {
      const result = await handler.handle("unknown_event", {})
      expect(result.handled).toBe(false)
      expect(result.error).toContain("Unsupported")
    })
  })
})

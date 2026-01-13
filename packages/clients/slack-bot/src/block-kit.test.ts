import { describe, test, expect } from "bun:test"
import { BlockKit, type Block } from "./block-kit"
import type { ThreadConversation, RepositoryContext } from "./types"

describe("BlockKit", () => {
  describe("text", () => {
    test("creates markdown text by default", () => {
      const result = BlockKit.text("Hello *world*")
      expect(result.type).toBe("mrkdwn")
      expect(result.text).toBe("Hello *world*")
    })

    test("creates plain text when markdown is false", () => {
      const result = BlockKit.text("Hello world", false)
      expect(result.type).toBe("plain_text")
      expect(result.emoji).toBe(true)
    })
  })

  describe("section", () => {
    test("creates section with text", () => {
      const result = BlockKit.section("Hello world")
      expect(result.type).toBe("section")
      expect(result.text?.text).toBe("Hello world")
    })

    test("creates section with fields", () => {
      const result = BlockKit.section("Title", ["Field 1", "Field 2"])
      expect(result.fields?.length).toBe(2)
      expect(result.fields?.[0]?.text).toBe("Field 1")
    })
  })

  describe("context", () => {
    test("creates context block with elements", () => {
      const result = BlockKit.context("Element 1", "Element 2")
      expect(result.type).toBe("context")
      expect(result.elements.length).toBe(2)
    })
  })

  describe("divider", () => {
    test("creates divider block", () => {
      const result = BlockKit.divider()
      expect(result.type).toBe("divider")
    })
  })

  describe("header", () => {
    test("creates header block", () => {
      const result = BlockKit.header("My Header")
      expect(result.type).toBe("header")
      expect(result.text.text).toBe("My Header")
      expect(result.text.type).toBe("plain_text")
    })
  })

  describe("button", () => {
    test("creates basic button", () => {
      const result = BlockKit.button("Click me", "button_action")
      expect(result.type).toBe("button")
      expect(result.text.text).toBe("Click me")
      expect(result.action_id).toBe("button_action")
    })

    test("creates button with options", () => {
      const result = BlockKit.button("Delete", "delete_action", {
        value: "item-123",
        style: "danger",
      })
      expect(result.value).toBe("item-123")
      expect(result.style).toBe("danger")
    })
  })

  describe("actions", () => {
    test("creates actions block with buttons", () => {
      const result = BlockKit.actions(
        BlockKit.button("OK", "ok_action"),
        BlockKit.button("Cancel", "cancel_action"),
      )
      expect(result.type).toBe("actions")
      expect(result.elements.length).toBe(2)
    })
  })

  describe("processingMessage", () => {
    test("creates processing message without thread", () => {
      const result = BlockKit.processingMessage("Building project")
      expect(result.text).toContain("Building project")
      expect(result.blocks?.length).toBeGreaterThan(0)
    })

    test("creates processing message with thread context", () => {
      const thread: ThreadConversation = {
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
        repository: { repository: "org/repo", source: "link", confidence: 1.0 },
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        messageCount: 1,
        status: "processing",
      }

      const result = BlockKit.processingMessage("Building", thread)
      const contextBlock = result.blocks?.find((b: Block) => b.type === "context")
      expect(contextBlock).toBeDefined()
    })
  })

  describe("progressMessage", () => {
    test("creates progress message with bar", () => {
      const result = BlockKit.progressMessage("Installing deps", 0.5)
      expect(result.text).toContain("50%")
      expect(result.blocks?.some((b: Block) => b.type === "section")).toBe(true)
    })

    test("creates progress message with details", () => {
      const result = BlockKit.progressMessage("Step 1", 0.25, "Extra info")
      const contextBlock = result.blocks?.find((b: Block) => b.type === "context")
      expect(contextBlock).toBeDefined()
    })
  })

  describe("completeMessage", () => {
    test("creates basic completion message", () => {
      const result = BlockKit.completeMessage("Task finished successfully")
      expect(result.text).toContain("Task finished")
      expect(result.blocks?.some((b: Block) => b.type === "section")).toBe(true)
    })

    test("creates completion message with PR URL", () => {
      const result = BlockKit.completeMessage("Created PR", {
        prUrl: "https://github.com/org/repo/pull/1",
      })
      const actionsBlock = result.blocks?.find((b: Block) => b.type === "actions")
      expect(actionsBlock).toBeDefined()
    })

    test("creates completion message with artifacts", () => {
      const result = BlockKit.completeMessage("Build done", {
        artifacts: ["bundle.js", "styles.css"],
      })
      const contextBlocks = result.blocks?.filter((b: Block) => b.type === "context")
      expect(contextBlocks?.length).toBeGreaterThan(0)
    })
  })

  describe("errorMessage", () => {
    test("creates error message", () => {
      const result = BlockKit.errorMessage("Build failed")
      expect(result.text).toContain("Build failed")
      expect(result.attachments?.[0]?.color).toBe("#ff0000")
    })

    test("creates error message with details", () => {
      const result = BlockKit.errorMessage("Error", "Stack trace here")
      const contextBlock = result.blocks?.find((b: Block) => b.type === "context")
      expect(contextBlock).toBeDefined()
    })
  })

  describe("codeMessage", () => {
    test("creates code snippet message", () => {
      const result = BlockKit.codeMessage("const x = 1", "typescript", "example.ts")
      expect(result.text).toBe("example.ts")
      const sectionBlock = result.blocks?.find((b: Block) => {
        const section = b as { text?: { text?: string } }
        return section.text?.text?.includes("```")
      })
      expect(sectionBlock).toBeDefined()
    })
  })

  describe("sessionInfoMessage", () => {
    test("creates session info message", () => {
      const thread: ThreadConversation = {
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
        sessionID: "session-abc123",
        repository: { repository: "org/repo", source: "link", confidence: 1.0 },
        startedAt: Date.now() - 60000,
        lastActivityAt: Date.now(),
        messageCount: 5,
        status: "active",
      }

      const result = BlockKit.sessionInfoMessage(thread)
      expect(result.blocks?.some((b: Block) => b.type === "header")).toBe(true)
    })

    test("includes error message when present", () => {
      const thread: ThreadConversation = {
        threadTs: "123.456",
        channelID: "C123",
        initiatorUserID: "U123",
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        messageCount: 1,
        status: "error",
        errorMessage: "Something went wrong",
      }

      const result = BlockKit.sessionInfoMessage(thread)
      const sectionBlocks = result.blocks?.filter((b: Block) => b.type === "section")
      const hasError = sectionBlocks?.some((b: Block) => {
        const section = b as { text?: { text?: string } }
        return section.text?.text?.includes("Something went wrong")
      })
      expect(hasError).toBe(true)
    })
  })

  describe("welcomeMessage", () => {
    test("creates welcome message with instructions", () => {
      const result = BlockKit.welcomeMessage()
      expect(result.text).toContain("Welcome")
      expect(result.blocks?.some((b: Block) => b.type === "header")).toBe(true)
      expect(result.blocks?.some((b: Block) => b.type === "divider")).toBe(true)
    })
  })

  describe("repositoryContextMessage", () => {
    test("creates message with repository info", () => {
      const repo: RepositoryContext = {
        repository: "org/repo",
        branch: "main",
        source: "link",
        confidence: 1.0,
      }

      const result = BlockKit.repositoryContextMessage(repo)
      expect(result.text).toBe("org/repo")
    })

    test("shows action buttons for low confidence", () => {
      const repo: RepositoryContext = {
        repository: "org/repo",
        source: "default",
        confidence: 0.3,
      }

      const result = BlockKit.repositoryContextMessage(repo)
      const actionsBlock = result.blocks?.find((b: Block) => b.type === "actions")
      expect(actionsBlock).toBeDefined()
    })

    test("shows action buttons when no repository", () => {
      const repo: RepositoryContext = {
        source: "default",
        confidence: 0,
      }

      const result = BlockKit.repositoryContextMessage(repo)
      const actionsBlock = result.blocks?.find((b: Block) => b.type === "actions")
      expect(actionsBlock).toBeDefined()
    })
  })
})

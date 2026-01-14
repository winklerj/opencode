import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { Braintrust } from "./braintrust"

describe("Braintrust", () => {
  beforeEach(() => {
    if (Braintrust.isInitialized()) {
      Braintrust.shutdown()
    }
  })

  afterEach(() => {
    if (Braintrust.isInitialized()) {
      Braintrust.shutdown()
    }
  })

  describe("init", () => {
    it("should initialize with required config", () => {
      Braintrust.init({
        apiKey: "test-api-key",
        projectName: "test-project",
      })

      expect(Braintrust.isInitialized()).toBe(true)
    })

    it("should not reinitialize if already initialized", () => {
      Braintrust.init({
        apiKey: "test-api-key",
        projectName: "test-project",
      })

      Braintrust.init({
        apiKey: "different-key",
        projectName: "different-project",
      })

      expect(Braintrust.isInitialized()).toBe(true)
    })

    it("should initialize with all config options", () => {
      Braintrust.init({
        apiKey: "test-api-key",
        projectName: "test-project",
        projectId: "proj-123",
        appUrl: "https://custom.braintrust.dev",
        asyncFlush: false,
        flushIntervalMs: 5000,
        enabled: true,
      })

      expect(Braintrust.isInitialized()).toBe(true)
    })

    it("should accept disabled config", () => {
      Braintrust.init({
        apiKey: "test-api-key",
        projectName: "test-project",
        enabled: false,
      })

      expect(Braintrust.isInitialized()).toBe(true)
    })
  })

  describe("shutdown", () => {
    it("should shutdown and clear state", () => {
      Braintrust.init({
        apiKey: "test-api-key",
        projectName: "test-project",
      })

      expect(Braintrust.isInitialized()).toBe(true)

      Braintrust.shutdown()

      expect(Braintrust.isInitialized()).toBe(false)
    })
  })

  describe("spans", () => {
    beforeEach(() => {
      Braintrust.init({
        apiKey: "test-api-key",
        projectName: "test-project",
        enabled: false,
      })
    })

    it("should start a span and return span ID", () => {
      const spanId = Braintrust.startSpan("test-span")

      expect(spanId).toBeDefined()
      expect(typeof spanId).toBe("string")
      expect(spanId.length).toBe(32)
    })

    it("should start a span with options", () => {
      const spanId = Braintrust.startSpan("llm-call", {
        type: "llm",
        metadata: { model: "gpt-4" },
      })

      expect(spanId).toBeDefined()
    })

    it("should log data to a span", () => {
      const spanId = Braintrust.startSpan("test-span")

      Braintrust.logSpan(spanId, {
        input: [{ role: "user", content: "Hello" }],
        metadata: { temperature: 0.7 },
      })
    })

    it("should end a span with final data", () => {
      const spanId = Braintrust.startSpan("test-span")

      Braintrust.logSpan(spanId, {
        input: [{ role: "user", content: "Hello" }],
      })

      Braintrust.endSpan(spanId, {
        output: "World",
        metrics: {
          prompt_tokens: 5,
          completion_tokens: 1,
        },
      })
    })

    it("should handle ending non-existent span gracefully", () => {
      Braintrust.endSpan("non-existent-span-id", { output: "test" })
    })

    it("should handle logging to non-existent span gracefully", () => {
      Braintrust.logSpan("non-existent-span-id", { output: "test" })
    })
  })

  describe("logLLMCall", () => {
    beforeEach(() => {
      Braintrust.init({
        apiKey: "test-api-key",
        projectName: "test-project",
        enabled: false,
      })
    })

    it("should log an LLM call", async () => {
      await Braintrust.logLLMCall({
        model: "gpt-4",
        input: [{ role: "user", content: "Hello" }],
        output: "Hi there!",
        promptTokens: 5,
        completionTokens: 3,
        latencyMs: 500,
      })
    })

    it("should log an LLM call with string input", async () => {
      await Braintrust.logLLMCall({
        model: "claude-3-sonnet",
        input: "What is 2+2?",
        output: "4",
        promptTokens: 10,
        completionTokens: 1,
      })
    })

    it("should log an LLM call with metadata", async () => {
      await Braintrust.logLLMCall({
        model: "gpt-4-turbo",
        input: [{ role: "user", content: "Hello" }],
        output: "Hi",
        metadata: {
          temperature: 0.7,
          max_tokens: 100,
        },
        tags: ["production", "chat"],
      })
    })

    it("should log an LLM call with error", async () => {
      await Braintrust.logLLMCall({
        model: "gpt-4",
        input: "Test",
        output: "",
        error: "Rate limit exceeded",
      })
    })
  })

  describe("logEval", () => {
    beforeEach(() => {
      Braintrust.init({
        apiKey: "test-api-key",
        projectName: "test-project",
        enabled: false,
      })
    })

    it("should log an evaluation", async () => {
      await Braintrust.logEval({
        input: "What is 2+2?",
        output: "4",
        expected: "4",
        scores: {
          exactMatch: 1,
          semanticSimilarity: 1,
        },
      })
    })

    it("should log an evaluation with metadata", async () => {
      await Braintrust.logEval({
        input: { question: "What is AI?" },
        output: "Artificial Intelligence",
        expected: "Artificial Intelligence",
        scores: { accuracy: 1 },
        metadata: { category: "definitions" },
        tags: ["eval-run-1"],
      })
    })
  })

  describe("Helpers", () => {
    beforeEach(() => {
      Braintrust.init({
        apiKey: "test-api-key",
        projectName: "test-project",
        enabled: false,
      })
    })

    it("should trace an async function", async () => {
      const result = await Braintrust.Helpers.traced(
        async () => {
          return "result"
        },
        { name: "test-function" },
      )

      expect(result).toBe("result")
    })

    it("should trace and handle errors", async () => {
      await expect(
        Braintrust.Helpers.traced(async () => {
          throw new Error("Test error")
        }),
      ).rejects.toThrow("Test error")
    })

    it("should format messages correctly", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ]

      const formatted = Braintrust.Helpers.formatMessages(messages)

      expect(formatted).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ])
    })

    it("should calculate exact match score", () => {
      expect(Braintrust.Helpers.calculateScore("hello", "hello")).toBe(1)
    })

    it("should calculate case-insensitive score", () => {
      expect(Braintrust.Helpers.calculateScore("Hello", "hello")).toBe(0.9)
    })

    it("should calculate partial match score", () => {
      expect(Braintrust.Helpers.calculateScore("hello world", "hello")).toBe(0.5)
    })

    it("should calculate no match score", () => {
      expect(Braintrust.Helpers.calculateScore("foo", "bar")).toBe(0)
    })
  })

  describe("Metrics", () => {
    beforeEach(() => {
      Braintrust.init({
        apiKey: "test-api-key",
        projectName: "test-project",
        enabled: false,
      })
    })

    describe("Agent", () => {
      it("should track agent task lifecycle", () => {
        const spanId = Braintrust.Metrics.Agent.taskStarted("agent-1", "Fix bug", {
          repository: "my-repo",
        })

        expect(spanId).toBeDefined()

        Braintrust.Metrics.Agent.taskCompleted(spanId, "Bug fixed", {
          success: 1,
        })
      })

      it("should track agent task failure", () => {
        const spanId = Braintrust.Metrics.Agent.taskStarted("agent-2", "Deploy")

        Braintrust.Metrics.Agent.taskFailed(spanId, "Deployment failed")
      })
    })

    describe("LLM", () => {
      it("should track LLM call", async () => {
        await Braintrust.Metrics.LLM.call({
          model: "gpt-4",
          input: [{ role: "user", content: "Hello" }],
          output: "Hi",
          promptTokens: 5,
          completionTokens: 1,
          latencyMs: 100,
        })
      })

      it("should track LLM call with string input", async () => {
        await Braintrust.Metrics.LLM.call({
          model: "claude-3",
          input: "Hello",
          output: "Hi",
        })
      })
    })

    describe("Eval", () => {
      it("should track evaluation", async () => {
        await Braintrust.Metrics.Eval.log(
          "What is 2+2?",
          "4",
          "4",
          { accuracy: 1, relevance: 1 },
          { evaluator: "human" },
        )
      })
    })

    describe("Session", () => {
      it("should track session prompt lifecycle", () => {
        const spanId = Braintrust.Metrics.Session.promptStarted("session-1", "Fix the bug", {
          user: "user-1",
        })

        expect(spanId).toBeDefined()

        Braintrust.Metrics.Session.promptCompleted(spanId, "Bug has been fixed", {
          userSatisfaction: 0.9,
        })
      })
    })
  })

  describe("when disabled", () => {
    beforeEach(() => {
      Braintrust.init({
        apiKey: "test-api-key",
        projectName: "test-project",
        enabled: false,
      })
    })

    it("should not crash when logging while disabled", async () => {
      await Braintrust.logLLMCall({
        model: "gpt-4",
        input: "test",
        output: "test",
      })
    })

    it("should not crash when flushing while disabled", async () => {
      await Braintrust.flush()
    })
  })

  describe("when not initialized", () => {
    it("should return false for isInitialized", () => {
      expect(Braintrust.isInitialized()).toBe(false)
    })

    it("should not crash when logging", async () => {
      await Braintrust.logLLMCall({
        model: "gpt-4",
        input: "test",
        output: "test",
      })
    })

    it("should not crash when flushing", async () => {
      await Braintrust.flush()
    })

    it("should not crash when starting span", () => {
      const spanId = Braintrust.startSpan("test")
      expect(spanId).toBeDefined()
    })

    it("should clean up span even when not initialized", () => {
      const spanId = Braintrust.startSpan("test")
      Braintrust.endSpan(spanId, { output: "result" })
    })
  })
})

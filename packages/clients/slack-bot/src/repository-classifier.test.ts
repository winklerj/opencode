import { describe, test, expect, beforeEach } from "bun:test"
import { RepositoryClassifier } from "./repository-classifier"

describe("RepositoryClassifier", () => {
  let classifier: RepositoryClassifier

  beforeEach(() => {
    classifier = new RepositoryClassifier({
      defaultRepository: "org/default-repo",
      defaultBranch: "main",
    })
  })

  describe("classify", () => {
    test("extracts repository from GitHub URL", async () => {
      const result = await classifier.classify({
        channelID: "C123",
        text: "Check out https://github.com/owner/repo/pull/123",
      })

      expect(result.repository).toBe("owner/repo")
      expect(result.source).toBe("link")
      expect(result.confidence).toBe(1.0)
    })

    test("extracts branch from GitHub URL", async () => {
      const result = await classifier.classify({
        channelID: "C123",
        text: "See https://github.com/owner/repo/tree/feature-branch",
      })

      expect(result.repository).toBe("owner/repo")
      expect(result.branch).toBe("feature-branch")
      expect(result.source).toBe("link")
    })

    test("extracts repository from mention pattern", async () => {
      const result = await classifier.classify({
        channelID: "C123",
        text: "Fix the bug in company/frontend-app",
      })

      expect(result.repository).toBe("company/frontend-app")
      expect(result.source).toBe("mention")
      expect(result.confidence).toBe(0.9)
    })

    test("extracts repository from 'in repo' pattern", async () => {
      const result = await classifier.classify({
        channelID: "C123",
        text: "Deploy changes in org/backend-service",
      })

      expect(result.repository).toBe("org/backend-service")
      expect(result.source).toBe("mention")
    })

    test("extracts from channel topic", async () => {
      const result = await classifier.classify({
        channelID: "C123",
        text: "Hello",
        channelTopic: "Discussions for acme/widgets",
      })

      expect(result.repository).toBe("acme/widgets")
      expect(result.source).toBe("channel_topic")
      expect(result.confidence).toBe(0.7)
    })

    test("uses channel config when no other source", async () => {
      classifier.configureChannel({
        channelID: "C123",
        channelName: "eng-backend",
        defaultRepository: "company/backend",
        defaultBranch: "develop",
        enabled: true,
      })

      const result = await classifier.classify({
        channelID: "C123",
        text: "Hello",
      })

      expect(result.repository).toBe("company/backend")
      expect(result.branch).toBe("develop")
      expect(result.confidence).toBe(0.8)
    })

    test("falls back to default repository", async () => {
      const result = await classifier.classify({
        channelID: "C999",
        text: "Hello",
      })

      expect(result.repository).toBe("org/default-repo")
      expect(result.source).toBe("default")
      expect(result.confidence).toBe(0.3)
    })

    test("returns empty when no repository found and no default", async () => {
      const noDefaultClassifier = new RepositoryClassifier()
      const result = await noDefaultClassifier.classify({
        channelID: "C123",
        text: "Hello",
      })

      expect(result.repository).toBeUndefined()
      expect(result.confidence).toBe(0)
    })

    test("prioritizes link over mention", async () => {
      const result = await classifier.classify({
        channelID: "C123",
        text: "Check org/other-repo at https://github.com/owner/repo",
      })

      expect(result.repository).toBe("owner/repo")
      expect(result.source).toBe("link")
    })
  })

  describe("configureChannel", () => {
    test("stores channel configuration", () => {
      classifier.configureChannel({
        channelID: "C123",
        channelName: "engineering",
        defaultRepository: "org/repo",
        enabled: true,
      })

      const config = classifier.getChannelConfig("C123")
      expect(config?.defaultRepository).toBe("org/repo")
    })

    test("can remove channel configuration", () => {
      classifier.configureChannel({
        channelID: "C123",
        defaultRepository: "org/repo",
        enabled: true,
      })

      const removed = classifier.removeChannelConfig("C123")
      expect(removed).toBe(true)
      expect(classifier.getChannelConfig("C123")).toBeUndefined()
    })

    test("lists all channel configs", () => {
      classifier.configureChannel({
        channelID: "C1",
        defaultRepository: "org/repo1",
        enabled: true,
      })
      classifier.configureChannel({
        channelID: "C2",
        defaultRepository: "org/repo2",
        enabled: true,
      })

      const configs = classifier.listChannelConfigs()
      expect(configs.length).toBe(2)
    })
  })

  describe("enhanceWithHistory", () => {
    test("enhances low-confidence result with history", async () => {
      const current = {
        repository: undefined,
        source: "default" as const,
        confidence: 0.3,
      }

      const result = await classifier.enhanceWithHistory(current, [
        { text: "Working on https://github.com/found/repo", ts: "123" },
      ])

      expect(result.repository).toBe("found/repo")
      expect(result.source).toBe("history")
    })

    test("keeps high-confidence result unchanged", async () => {
      const current = {
        repository: "original/repo",
        source: "link" as const,
        confidence: 0.9,
      }

      const result = await classifier.enhanceWithHistory(current, [
        { text: "Different https://github.com/other/repo", ts: "123" },
      ])

      expect(result.repository).toBe("original/repo")
      expect(result.source).toBe("link")
    })
  })
})

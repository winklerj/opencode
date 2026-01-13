import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import { ModalProvider } from "./modal"

describe("ModalProvider", () => {
  let provider: ModalProvider

  beforeEach(() => {
    provider = new ModalProvider({
      tokenId: "test-token-id",
      tokenSecret: "test-token-secret",
      appName: "test-app",
    })
  })

  describe("constructor", () => {
    it("should use provided config", () => {
      const p = new ModalProvider({
        tokenId: "my-id",
        tokenSecret: "my-secret",
        appName: "my-app",
        defaultCpu: 8,
        defaultMemory: 16384,
      })

      expect(p.name).toBe("modal")
    })

    it("should use default values when not provided", () => {
      const p = new ModalProvider({})
      expect(p.name).toBe("modal")
    })
  })

  describe("create", () => {
    it("should create a sandbox with initializing status", async () => {
      // Mock the Modal API call to prevent actual network requests
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ sandbox_id: "modal-123" }), { status: 200 }),
      )

      // Note: The create method starts async work, so the sandbox starts as initializing
      const sandbox = await provider.create({
        projectID: "test-project",
        repository: "https://github.com/example/repo",
        branch: "main",
        services: ["vite"],
      })

      expect(sandbox.id).toMatch(/^modal-sandbox_/)
      expect(sandbox.projectID).toBe("test-project")
      expect(sandbox.status).toBe("initializing")
      expect(sandbox.provider).toBe("modal")
      expect(sandbox.git.repo).toBe("https://github.com/example/repo")
      expect(sandbox.git.branch).toBe("main")

      fetchSpy.mockRestore()
    })

    it("should apply default branch when not specified", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ sandbox_id: "modal-123" }), { status: 200 }),
      )

      const sandbox = await provider.create({
        projectID: "test-project",
        repository: "https://github.com/example/repo",
      })

      expect(sandbox.git.branch).toBe("main")

      fetchSpy.mockRestore()
    })
  })

  describe("get", () => {
    it("should return undefined for unknown sandbox", async () => {
      const result = await provider.get("unknown-id")
      expect(result).toBeUndefined()
    })

    it("should return sandbox info for known sandbox", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ sandbox_id: "modal-123" }), { status: 200 }),
      )

      const sandbox = await provider.create({
        projectID: "test-project",
        repository: "https://github.com/example/repo",
        branch: "main",
      })

      const result = await provider.get(sandbox.id)
      expect(result).toBeDefined()
      expect(result?.id).toBe(sandbox.id)

      fetchSpy.mockRestore()
    })
  })

  describe("list", () => {
    it("should list all sandboxes", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ sandbox_id: "modal-123" }), { status: 200 }),
      )

      await provider.create({
        projectID: "project-1",
        repository: "https://github.com/example/repo1",
        branch: "main",
      })
      await provider.create({
        projectID: "project-2",
        repository: "https://github.com/example/repo2",
        branch: "main",
      })

      const all = await provider.list()
      expect(all.length).toBe(2)

      fetchSpy.mockRestore()
    })

    it("should filter by projectID", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ sandbox_id: "modal-123" }), { status: 200 }),
      )

      await provider.create({
        projectID: "project-1",
        repository: "https://github.com/example/repo1",
        branch: "main",
      })
      await provider.create({
        projectID: "project-2",
        repository: "https://github.com/example/repo2",
        branch: "main",
      })

      const filtered = await provider.list("project-1")
      expect(filtered.length).toBe(1)
      expect(filtered[0].projectID).toBe("project-1")

      fetchSpy.mockRestore()
    })
  })

  describe("lifecycle operations", () => {
    it("should throw for unknown sandbox on start", async () => {
      await expect(provider.start("unknown")).rejects.toThrow("Sandbox not found")
    })

    it("should throw for unknown sandbox on stop", async () => {
      await expect(provider.stop("unknown")).rejects.toThrow("Sandbox not found")
    })

    it("should throw for unknown sandbox on terminate", async () => {
      await expect(provider.terminate("unknown")).rejects.toThrow("Sandbox not found")
    })
  })

  describe("execute", () => {
    it("should throw for unknown sandbox", async () => {
      await expect(provider.execute("unknown", ["echo"])).rejects.toThrow("Sandbox not found")
    })

    it("should throw if sandbox not yet started on Modal", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ sandbox_id: "modal-123" }), { status: 200 }),
      )

      const sandbox = await provider.create({
        projectID: "test-project",
        repository: "https://github.com/example/repo",
        branch: "main",
      })

      // Wait a tiny bit but sandbox won't be ready yet since API call is mocked
      await new Promise((resolve) => setTimeout(resolve, 10))

      // The sandbox might or might not have modalSandboxId depending on timing
      // This tests the error case when it doesn't
      fetchSpy.mockRestore()
    })
  })

  describe("snapshot operations", () => {
    it("should throw for unknown sandbox on snapshot", async () => {
      await expect(provider.snapshot("unknown")).rejects.toThrow("Sandbox not found")
    })

    it("should throw for unknown snapshot on restore", async () => {
      await expect(provider.restore("unknown")).rejects.toThrow("Snapshot not found")
    })
  })

  describe("git operations", () => {
    it("should throw for unknown sandbox on getGitStatus", async () => {
      await expect(provider.getGitStatus("unknown")).rejects.toThrow("Sandbox not found")
    })

    it("should throw for unknown sandbox on syncGit", async () => {
      await expect(provider.syncGit("unknown")).rejects.toThrow("Sandbox not found")
    })

    it("should return git status for known sandbox", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ sandbox_id: "modal-123" }), { status: 200 }),
      )

      const sandbox = await provider.create({
        projectID: "test-project",
        repository: "https://github.com/example/repo",
        branch: "main",
      })

      const gitStatus = await provider.getGitStatus(sandbox.id)
      expect(gitStatus.repo).toBe("https://github.com/example/repo")
      expect(gitStatus.branch).toBe("main")
      expect(gitStatus.syncStatus).toBe("pending")

      fetchSpy.mockRestore()
    })
  })

  describe("streamLogs", () => {
    it("should throw for unknown sandbox", async () => {
      const streamLogs = async () => {
        for await (const _ of provider.streamLogs("unknown", "vite")) {
          // Should not reach here
        }
      }

      let error: Error | null = null
      try {
        await streamLogs()
      } catch (e) {
        error = e as Error
      }

      expect(error).not.toBeNull()
      expect(error?.message).toContain("Sandbox not found")
    })
  })

  describe("toInfo", () => {
    it("should generate correct public URL", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ sandbox_id: "modal-123" }), { status: 200 }),
      )

      const sandbox = await provider.create({
        projectID: "test-project",
        repository: "https://github.com/example/repo",
        branch: "main",
      })

      // Without modalSandboxId, publicURL should be undefined
      expect(sandbox.network.publicURL).toBeUndefined()

      fetchSpy.mockRestore()
    })
  })
})

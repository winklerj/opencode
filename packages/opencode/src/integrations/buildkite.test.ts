import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { Buildkite } from "./buildkite"

// Helper to create typed mock fetch
const mockFetch = <T extends (...args: never[]) => Promise<Response>>(fn: T) =>
  mock(fn) as unknown as typeof fetch

describe("Buildkite", () => {
  const mockConfig = {
    apiToken: "test-token-123",
    organization: "test-org",
    defaultPipeline: "test-pipeline",
    enabled: true,
  }

  const mockBuild: Buildkite.Build = {
    id: "build-123",
    graphql_id: "graphql-build-123",
    url: "https://api.buildkite.com/v2/organizations/test-org/pipelines/test-pipeline/builds/1",
    web_url: "https://buildkite.com/test-org/test-pipeline/builds/1",
    number: 1,
    state: "passed",
    blocked: false,
    message: "Test commit",
    commit: "abc123def456",
    branch: "main",
    env: {},
    source: "api",
    created_at: "2026-01-14T00:00:00Z",
    scheduled_at: "2026-01-14T00:00:00Z",
    started_at: "2026-01-14T00:00:01Z",
    finished_at: "2026-01-14T00:00:30Z",
    meta_data: {},
    creator: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      avatar_url: "https://example.com/avatar.png",
    },
    pipeline: {
      id: "pipeline-123",
      graphql_id: "graphql-pipeline-123",
      url: "https://api.buildkite.com/v2/organizations/test-org/pipelines/test-pipeline",
      web_url: "https://buildkite.com/test-org/test-pipeline",
      name: "Test Pipeline",
      slug: "test-pipeline",
    },
    jobs: [
      {
        id: "job-123",
        graphql_id: "graphql-job-123",
        type: "script",
        name: "Test Job",
        state: "passed",
        agent_query_rules: [],
        web_url: "https://buildkite.com/test-org/test-pipeline/builds/1#job-123",
        log_url: "https://api.buildkite.com/v2/organizations/test-org/pipelines/test-pipeline/builds/1/jobs/job-123/log",
        raw_log_url:
          "https://api.buildkite.com/v2/organizations/test-org/pipelines/test-pipeline/builds/1/jobs/job-123/log.txt",
        command: "bun test",
        exit_status: 0,
        artifact_paths: "",
        created_at: "2026-01-14T00:00:00Z",
        scheduled_at: "2026-01-14T00:00:00Z",
        runnable_at: "2026-01-14T00:00:00Z",
        started_at: "2026-01-14T00:00:01Z",
        finished_at: "2026-01-14T00:00:30Z",
        retried: false,
        retried_in_job_id: null,
        retries_count: 0,
        parallel_group_index: null,
        parallel_group_total: null,
      },
    ],
  }

  const mockAnnotation: Buildkite.Annotation = {
    id: "annotation-123",
    context: "test-context",
    style: "success",
    body_html: "<p>Test annotation</p>",
    created_at: "2026-01-14T00:00:00Z",
    updated_at: "2026-01-14T00:00:00Z",
  }

  const mockAgent: Buildkite.Agent = {
    id: "agent-123",
    graphql_id: "graphql-agent-123",
    url: "https://api.buildkite.com/v2/organizations/test-org/agents/agent-123",
    web_url: "https://buildkite.com/organizations/test-org/agents/agent-123",
    name: "test-agent",
    connection_state: "connected",
    hostname: "localhost",
    ip_address: "127.0.0.1",
    user_agent: "buildkite-agent/3.0.0",
    version: "3.0.0",
    created_at: "2026-01-14T00:00:00Z",
    job: null,
    last_job_finished_at: null,
    priority: 0,
    meta_data: ["queue=default"],
  }

  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    Buildkite.init(mockConfig)
  })

  afterEach(() => {
    Buildkite.shutdown()
    globalThis.fetch = originalFetch
  })

  describe("init/shutdown", () => {
    test("initializes with config", () => {
      Buildkite.shutdown()
      expect(Buildkite.isInitialized()).toBe(false)

      Buildkite.init(mockConfig)
      expect(Buildkite.isInitialized()).toBe(true)
    })

    test("warns if already initialized", () => {
      // Already initialized in beforeEach
      Buildkite.init(mockConfig) // Should warn but not throw
      expect(Buildkite.isInitialized()).toBe(true)
    })

    test("shuts down correctly", () => {
      expect(Buildkite.isInitialized()).toBe(true)
      Buildkite.shutdown()
      expect(Buildkite.isInitialized()).toBe(false)
    })
  })

  describe("createBuild", () => {
    test("creates a build", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json(mockBuild)
      )

      const build = await Buildkite.createBuild({
        commit: "abc123",
        branch: "main",
        message: "Test build",
      })

      expect(build.number).toBe(1)
      expect(build.state).toBe("passed")
      expect(build.commit).toBe("abc123def456")
    })

    test("uses default pipeline", async () => {
      let capturedUrl = ""
      globalThis.fetch = mockFetch(async (url: string) => {
        capturedUrl = url
        return Response.json(mockBuild)
      })

      await Buildkite.createBuild({
        commit: "abc123",
        branch: "main",
      })

      expect(capturedUrl).toContain("/pipelines/test-pipeline/builds")
    })

    test("uses specified pipeline", async () => {
      let capturedUrl = ""
      globalThis.fetch = mockFetch(async (url: string) => {
        capturedUrl = url
        return Response.json(mockBuild)
      })

      await Buildkite.createBuild({
        commit: "abc123",
        branch: "main",
        pipeline: "other-pipeline",
      })

      expect(capturedUrl).toContain("/pipelines/other-pipeline/builds")
    })

    test("includes env and metadata", async () => {
      let capturedBody: Record<string, unknown> = {}
      globalThis.fetch = mockFetch(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string)
        return Response.json(mockBuild)
      })

      await Buildkite.createBuild({
        commit: "abc123",
        branch: "main",
        env: { FOO: "bar" },
        meta_data: { key: "value" },
      })

      expect(capturedBody.env).toEqual({ FOO: "bar" })
      expect(capturedBody.meta_data).toEqual({ key: "value" })
    })

    test("throws on API error", async () => {
      globalThis.fetch = mockFetch(async () =>
        new Response("Not Found", { status: 404 })
      )

      await expect(
        Buildkite.createBuild({
          commit: "abc123",
          branch: "main",
        })
      ).rejects.toThrow("Buildkite API error: 404")
    })

    test("throws when not initialized", async () => {
      Buildkite.shutdown()

      await expect(
        Buildkite.createBuild({
          commit: "abc123",
          branch: "main",
        })
      ).rejects.toThrow("Buildkite not initialized")
    })
  })

  describe("getBuild", () => {
    test("gets a build by number", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json(mockBuild)
      )

      const build = await Buildkite.getBuild(1)
      expect(build.number).toBe(1)
      expect(build.state).toBe("passed")
    })

    test("uses specified pipeline", async () => {
      let capturedUrl = ""
      globalThis.fetch = mockFetch(async (url: string) => {
        capturedUrl = url
        return Response.json(mockBuild)
      })

      await Buildkite.getBuild(1, "other-pipeline")
      expect(capturedUrl).toContain("/pipelines/other-pipeline/builds/1")
    })
  })

  describe("listBuilds", () => {
    test("lists builds for organization", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json([mockBuild])
      )

      const builds = await Buildkite.listBuilds()
      expect(builds).toHaveLength(1)
      expect(builds[0].number).toBe(1)
    })

    test("filters by pipeline", async () => {
      let capturedUrl = ""
      globalThis.fetch = mockFetch(async (url: string) => {
        capturedUrl = url
        return Response.json([mockBuild])
      })

      await Buildkite.listBuilds({ pipeline: "test-pipeline" })
      expect(capturedUrl).toContain("/pipelines/test-pipeline/builds")
    })

    test("filters by branch", async () => {
      let capturedUrl = ""
      globalThis.fetch = mockFetch(async (url: string) => {
        capturedUrl = url
        return Response.json([mockBuild])
      })

      await Buildkite.listBuilds({ branch: "feature" })
      expect(capturedUrl).toContain("branch=feature")
    })

    test("filters by state array", async () => {
      let capturedUrl = ""
      globalThis.fetch = mockFetch(async (url: string) => {
        capturedUrl = url
        return Response.json([mockBuild])
      })

      await Buildkite.listBuilds({ state: ["running", "scheduled"] })
      // URL encoding converts [] to %5B%5D
      expect(capturedUrl).toContain("state%5B%5D=running")
      expect(capturedUrl).toContain("state%5B%5D=scheduled")
    })

    test("supports pagination", async () => {
      let capturedUrl = ""
      globalThis.fetch = mockFetch(async (url: string) => {
        capturedUrl = url
        return Response.json([mockBuild])
      })

      await Buildkite.listBuilds({ page: 2, per_page: 50 })
      expect(capturedUrl).toContain("page=2")
      expect(capturedUrl).toContain("per_page=50")
    })
  })

  describe("cancelBuild", () => {
    test("cancels a build", async () => {
      const canceledBuild = { ...mockBuild, state: "canceled" as const }
      globalThis.fetch = mockFetch(async () =>
        Response.json(canceledBuild)
      )

      const build = await Buildkite.cancelBuild(1)
      expect(build.state).toBe("canceled")
    })

    test("uses correct URL", async () => {
      let capturedUrl = ""
      globalThis.fetch = mockFetch(async (url: string) => {
        capturedUrl = url
        return Response.json({ ...mockBuild, state: "canceled" })
      })

      await Buildkite.cancelBuild(1, "other-pipeline")
      expect(capturedUrl).toContain("/pipelines/other-pipeline/builds/1/cancel")
    })
  })

  describe("rebuildBuild", () => {
    test("rebuilds a build", async () => {
      const newBuild = { ...mockBuild, number: 2 }
      globalThis.fetch = mockFetch(async () =>
        Response.json(newBuild)
      )

      const build = await Buildkite.rebuildBuild(1)
      expect(build.number).toBe(2)
    })
  })

  describe("annotations", () => {
    test("creates an annotation", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json(mockAnnotation)
      )

      const annotation = await Buildkite.createAnnotation({
        buildNumber: 1,
        context: "test-context",
        style: "success",
        body: "<p>Test</p>",
      })

      expect(annotation.context).toBe("test-context")
      expect(annotation.style).toBe("success")
    })

    test("creates annotation with append", async () => {
      let capturedBody: Record<string, unknown> = {}
      globalThis.fetch = mockFetch(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string)
        return Response.json(mockAnnotation)
      })

      await Buildkite.createAnnotation({
        buildNumber: 1,
        context: "test-context",
        style: "info",
        body: "<p>Appended</p>",
        append: true,
      })

      expect(capturedBody.append).toBe(true)
    })

    test("lists annotations", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json([mockAnnotation])
      )

      const annotations = await Buildkite.listAnnotations(1)
      expect(annotations).toHaveLength(1)
      expect(annotations[0].context).toBe("test-context")
    })

    test("deletes an annotation", async () => {
      let capturedUrl = ""
      let capturedMethod = ""
      globalThis.fetch = mockFetch(async (url: string, init?: RequestInit) => {
        capturedUrl = url
        capturedMethod = init?.method ?? "GET"
        return new Response(null, { status: 204 })
      })

      await Buildkite.deleteAnnotation(1, "test-context")
      expect(capturedMethod).toBe("DELETE")
      expect(capturedUrl).toContain("/annotations/test-context")
    })
  })

  describe("agents", () => {
    test("lists agents", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json([mockAgent])
      )

      const agents = await Buildkite.listAgents()
      expect(agents).toHaveLength(1)
      expect(agents[0].name).toBe("test-agent")
    })

    test("gets an agent", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json(mockAgent)
      )

      const agent = await Buildkite.getAgent("agent-123")
      expect(agent.id).toBe("agent-123")
      expect(agent.connection_state).toBe("connected")
    })

    test("stops an agent", async () => {
      let capturedBody: Record<string, unknown> = {}
      globalThis.fetch = mockFetch(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string)
        return new Response(null, { status: 204 })
      })

      await Buildkite.stopAgent("agent-123", true)
      expect(capturedBody.force).toBe(true)
    })
  })

  describe("jobs", () => {
    test("gets job log", async () => {
      globalThis.fetch = mockFetch(async () =>
        new Response("Test log output\nLine 2\n")
      )

      const log = await Buildkite.getJobLog(1, "job-123")
      expect(log).toContain("Test log output")
    })

    test("retries a job", async () => {
      const newJob = { ...mockBuild.jobs[0], id: "job-456" }
      globalThis.fetch = mockFetch(async () =>
        Response.json(newJob)
      )

      const job = await Buildkite.retryJob(1, "job-123")
      expect(job.id).toBe("job-456")
    })

    test("unblocks a job", async () => {
      let capturedBody: Record<string, unknown> = {}
      globalThis.fetch = mockFetch(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string)
        return Response.json(mockBuild.jobs[0])
      })

      await Buildkite.unblockJob(1, "job-123", undefined, { KEY: "value" }, {
        name: "Unblocker",
        email: "unblocker@example.com",
      })

      expect(capturedBody.fields).toEqual({ KEY: "value" })
      expect(capturedBody.unblocker).toEqual({
        name: "Unblocker",
        email: "unblocker@example.com",
      })
    })
  })

  describe("waitForBuild", () => {
    test("returns immediately if build is in terminal state", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json(mockBuild)
      )

      const build = await Buildkite.waitForBuild(1)
      expect(build.state).toBe("passed")
    })

    test("polls until terminal state", async () => {
      let callCount = 0
      globalThis.fetch = mockFetch(async () => {
        callCount++
        if (callCount < 3) {
          return Response.json({ ...mockBuild, state: "running" })
        }
        return Response.json(mockBuild)
      })

      const build = await Buildkite.waitForBuild(1, undefined, {
        pollIntervalMs: 10,
      })

      expect(build.state).toBe("passed")
      expect(callCount).toBe(3)
    })

    test("calls onPoll callback", async () => {
      let polled = false
      globalThis.fetch = mockFetch(async () =>
        Response.json(mockBuild)
      )

      await Buildkite.waitForBuild(1, undefined, {
        onPoll: () => {
          polled = true
        },
      })

      expect(polled).toBe(true)
    })

    test("throws on timeout", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json({ ...mockBuild, state: "running" })
      )

      await expect(
        Buildkite.waitForBuild(1, undefined, {
          pollIntervalMs: 10,
          timeoutMs: 50,
        })
      ).rejects.toThrow("did not complete within")
    })
  })

  describe("annotateAgentResult", () => {
    test("creates success annotation", async () => {
      let capturedBody: Record<string, unknown> = {}
      globalThis.fetch = mockFetch(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string)
        return Response.json(mockAnnotation)
      })

      await Buildkite.annotateAgentResult(1, {
        success: true,
        summary: "All tests passed",
      })

      expect(capturedBody.style).toBe("success")
      expect(capturedBody.context).toBe("opencode-agent")
      expect(capturedBody.body).toContain("All tests passed")
      expect(capturedBody.body).toContain("&#10003;") // Checkmark
    })

    test("creates error annotation", async () => {
      let capturedBody: Record<string, unknown> = {}
      globalThis.fetch = mockFetch(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string)
        return Response.json(mockAnnotation)
      })

      await Buildkite.annotateAgentResult(1, {
        success: false,
        summary: "Tests failed",
        details: "Error: assertion failed",
      })

      expect(capturedBody.style).toBe("error")
      expect(capturedBody.body).toContain("Tests failed")
      expect(capturedBody.body).toContain("Error: assertion failed")
      expect(capturedBody.body).toContain("&#10007;") // X mark
    })

    test("includes artifacts", async () => {
      let capturedBody: Record<string, unknown> = {}
      globalThis.fetch = mockFetch(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string)
        return Response.json(mockAnnotation)
      })

      await Buildkite.annotateAgentResult(1, {
        success: true,
        summary: "Build complete",
        artifacts: ["coverage.html", "report.pdf"],
      })

      expect(capturedBody.body).toContain("coverage.html")
      expect(capturedBody.body).toContain("report.pdf")
    })

    test("escapes HTML in content", async () => {
      let capturedBody: Record<string, unknown> = {}
      globalThis.fetch = mockFetch(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string)
        return Response.json(mockAnnotation)
      })

      await Buildkite.annotateAgentResult(1, {
        success: true,
        summary: "Test <script>alert('xss')</script>",
      })

      expect(capturedBody.body).not.toContain("<script>")
      expect(capturedBody.body).toContain("&lt;script&gt;")
    })
  })

  describe("CI helpers", () => {
    test("triggerAndWait creates and waits", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json(mockBuild)
      )

      const build = await Buildkite.CI.triggerAndWait({
        commit: "abc123",
        branch: "main",
      })

      expect(build.number).toBe(1)
      expect(build.state).toBe("passed")
    })

    test("getLatestBuild returns first build", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json([mockBuild])
      )

      const build = await Buildkite.CI.getLatestBuild("main")
      expect(build?.number).toBe(1)
    })

    test("getLatestBuild returns undefined for empty array", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json([])
      )

      const build = await Buildkite.CI.getLatestBuild("main")
      expect(build).toBeUndefined()
    })

    test("getRunningBuilds filters by state", async () => {
      let capturedUrl = ""
      globalThis.fetch = mockFetch(async (url: string) => {
        capturedUrl = url
        return Response.json([{ ...mockBuild, state: "running" }])
      })

      const builds = await Buildkite.CI.getRunningBuilds("main")
      // URL encoding converts [] to %5B%5D
      expect(capturedUrl).toContain("state%5B%5D=running")
      expect(capturedUrl).toContain("state%5B%5D=scheduled")
      expect(builds).toHaveLength(1)
    })

    test("hasPassingBuild returns true for passed build", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json([mockBuild])
      )

      const result = await Buildkite.CI.hasPassingBuild("abc123")
      expect(result).toBe(true)
    })

    test("hasPassingBuild returns false for no builds", async () => {
      globalThis.fetch = mockFetch(async () =>
        Response.json([])
      )

      const result = await Buildkite.CI.hasPassingBuild("abc123")
      expect(result).toBe(false)
    })

    test("getFailedJobs filters failed jobs", () => {
      const buildWithFailedJob: Buildkite.Build = {
        ...mockBuild,
        jobs: [
          { ...mockBuild.jobs[0], state: "passed" },
          { ...mockBuild.jobs[0], id: "job-456", state: "failed" },
          { ...mockBuild.jobs[0], id: "job-789", state: "passed" },
        ],
      }

      const failedJobs = Buildkite.CI.getFailedJobs(buildWithFailedJob)
      expect(failedJobs).toHaveLength(1)
      expect(failedJobs[0].id).toBe("job-456")
    })

    test("formatBuildStatus shows correct emoji", () => {
      const testCases: Array<[Buildkite.BuildState, string]> = [
        ["passed", "✅"],
        ["failed", "❌"],
        ["running", "🔄"],
        ["scheduled", "📅"],
        ["blocked", "🚫"],
        ["canceled", "🛑"],
      ]

      for (const [state, emoji] of testCases) {
        const build: Buildkite.Build = { ...mockBuild, state }
        const formatted = Buildkite.CI.formatBuildStatus(build)
        expect(formatted).toContain(emoji)
        expect(formatted).toContain(`Build #${build.number}`)
        expect(formatted).toContain(state)
      }
    })
  })

  describe("disabled state", () => {
    test("throws when disabled", async () => {
      Buildkite.shutdown()
      Buildkite.init({ ...mockConfig, enabled: false })

      await expect(
        Buildkite.createBuild({
          commit: "abc123",
          branch: "main",
        })
      ).rejects.toThrow("disabled")
    })
  })

  describe("no default pipeline", () => {
    test("throws when no pipeline specified and no default", async () => {
      Buildkite.shutdown()
      Buildkite.init({
        apiToken: "test-token",
        organization: "test-org",
        // No defaultPipeline
      })

      await expect(
        Buildkite.createBuild({
          commit: "abc123",
          branch: "main",
        })
      ).rejects.toThrow("No pipeline specified")
    })
  })
})

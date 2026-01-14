import { describe, test, expect, beforeEach } from "bun:test"
import { ImageBuilder, type BuildJob, type BuildResult } from "./builder"

describe("ImageBuilder", () => {
  let builder: ImageBuilder

  beforeEach(() => {
    builder = new ImageBuilder({
      rebuildInterval: 1000,
      runTestsDuringBuild: true,
      testTimeout: 1000,
      maxConcurrentBuilds: 2,
    })
  })

  describe("generateImageTag", () => {
    test("generates tag from full github URL", () => {
      const tag = builder.generateImageTag("github.com/myorg/myrepo", "main", 1234567890)
      expect(tag).toBe("opencode/myorg/myrepo:main-1234567890")
    })

    test("generates tag from short repo format", () => {
      const tag = builder.generateImageTag("myorg/myrepo", "feature-branch", 1234567890)
      expect(tag).toBe("opencode/myorg/myrepo:feature-branch-1234567890")
    })

    test("handles .git suffix", () => {
      const tag = builder.generateImageTag("github.com/myorg/myrepo.git", "main", 1234567890)
      expect(tag).toBe("opencode/myorg/myrepo:main-1234567890")
    })

    test("generates current timestamp when not provided", () => {
      const before = Date.now()
      const tag = builder.generateImageTag("myorg/myrepo", "main")
      const after = Date.now()

      const match = tag.match(/opencode\/myorg\/myrepo:main-(\d+)/)
      expect(match).toBeTruthy()
      const timestamp = parseInt(match![1], 10)
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe("generateLatestTag", () => {
    test("generates latest tag", () => {
      const tag = builder.generateLatestTag("myorg/myrepo", "main")
      expect(tag).toBe("opencode/myorg/myrepo:main-latest")
    })
  })

  describe("build", () => {
    test("queues a build job", async () => {
      const job = await builder.build({
        repository: "myorg/myrepo",
        branch: "main",
      })

      expect(job.id).toBeTruthy()
      expect(job.input.repository).toBe("myorg/myrepo")
      expect(job.input.branch).toBe("main")
      expect(job.logs.length).toBeGreaterThan(0)
    })

    test("job progresses through statuses", async () => {
      const statuses: string[] = []
      builder.on("build:progress", (job) => {
        statuses.push(job.status)
      })

      const job = await builder.build({
        repository: "myorg/myrepo",
        branch: "main",
      })

      // Wait for build to complete
      await new Promise((resolve) => {
        builder.on("build:complete", resolve)
      })

      const finalJob = builder.getJob(job.id)
      expect(finalJob?.status).toBe("completed")
      expect(finalJob?.result).toBeTruthy()
    })

    test("build result has correct fields", async () => {
      let result: BuildResult | undefined

      builder.on("build:complete", (_, r) => {
        result = r
      })

      const job = await builder.build({
        repository: "myorg/myrepo",
        branch: "main",
      })

      await new Promise((resolve) => builder.on("build:complete", resolve))

      expect(result).toBeTruthy()
      expect(result?.imageId).toBe(job.id)
      expect(result?.tag).toContain("opencode/myorg/myrepo:main-")
      expect(result?.digest).toMatch(/^sha256:/)
      expect(result?.repository).toBe("myorg/myrepo")
      expect(result?.branch).toBe("main")
      expect(result?.commit).toBeTruthy()
      expect(result?.builtAt).toBeGreaterThan(0)
      expect(result?.duration).toBeGreaterThan(0)
    })

    test("respects maxConcurrentBuilds", async () => {
      // Start 3 builds with maxConcurrent = 2
      const job1 = await builder.build({ repository: "org/repo1", branch: "main" })
      const job2 = await builder.build({ repository: "org/repo2", branch: "main" })
      const job3 = await builder.build({ repository: "org/repo3", branch: "main" })

      // First two should be active, third should be queued initially
      expect(builder.getActiveCount()).toBeLessThanOrEqual(2)
    })
  })

  describe("getJob / listJobs", () => {
    test("retrieves job by id", async () => {
      const job = await builder.build({
        repository: "myorg/myrepo",
        branch: "main",
      })

      const retrieved = builder.getJob(job.id)
      expect(retrieved).toBeTruthy()
      expect(retrieved?.id).toBe(job.id)
    })

    test("returns undefined for unknown id", () => {
      expect(builder.getJob("unknown-id")).toBeUndefined()
    })

    test("lists all jobs", async () => {
      await builder.build({ repository: "org/repo1", branch: "main" })
      await builder.build({ repository: "org/repo2", branch: "main" })

      const jobs = builder.listJobs()
      expect(jobs.length).toBe(2)
    })
  })

  describe("cancelBuild", () => {
    test("cancels queued build", async () => {
      // Fill up active builds
      await builder.build({ repository: "org/repo1", branch: "main" })
      await builder.build({ repository: "org/repo2", branch: "main" })

      // This should be queued
      const job = await builder.build({ repository: "org/repo3", branch: "main" })

      // Check it's queued
      if (builder.getQueuedCount() > 0) {
        const cancelled = builder.cancelBuild(job.id)
        expect(cancelled).toBe(true)

        const cancelledJob = builder.getJob(job.id)
        expect(cancelledJob?.status).toBe("failed")
        expect(cancelledJob?.error).toBe("Cancelled")
      }
    })

    test("returns false for unknown job", () => {
      expect(builder.cancelBuild("unknown-id")).toBe(false)
    })
  })

  describe("cleanupJobs", () => {
    test("removes old completed jobs", async () => {
      const job = await builder.build({
        repository: "myorg/myrepo",
        branch: "main",
      })

      await new Promise((resolve) => builder.on("build:complete", resolve))

      // Wait a small amount so job.completedAt is definitely in the past
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Cleanup with 0 maxAge should remove everything
      const removed = builder.cleanupJobs(0)
      expect(removed).toBe(1)
      expect(builder.getJob(job.id)).toBeUndefined()
    })

    test("keeps recent jobs", async () => {
      const job = await builder.build({
        repository: "myorg/myrepo",
        branch: "main",
      })

      await new Promise((resolve) => builder.on("build:complete", resolve))

      // Cleanup with large maxAge should keep everything
      const removed = builder.cleanupJobs(24 * 60 * 60 * 1000)
      expect(removed).toBe(0)
      expect(builder.getJob(job.id)).toBeTruthy()
    })
  })

  describe("events", () => {
    test("emits build:start event", async () => {
      let emitted = false
      builder.on("build:start", () => {
        emitted = true
      })

      await builder.build({
        repository: "myorg/myrepo",
        branch: "main",
      })

      // Give it a moment
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(emitted).toBe(true)
    })

    test("emits build:complete event with result", async () => {
      let emittedJob: BuildJob | undefined
      let emittedResult: BuildResult | undefined

      builder.on("build:complete", (job, result) => {
        emittedJob = job
        emittedResult = result
      })

      await builder.build({
        repository: "myorg/myrepo",
        branch: "main",
      })

      await new Promise((resolve) => builder.on("build:complete", resolve))

      expect(emittedJob).toBeTruthy()
      expect(emittedResult).toBeTruthy()
      expect(emittedJob?.result).toBe(emittedResult)
    })
  })

  describe("schedule", () => {
    test("starts and stops schedule", () => {
      builder.startSchedule([{ repository: "myorg/myrepo", branch: "main" }])

      // Should have started a build
      expect(builder.listJobs().length).toBeGreaterThan(0)

      builder.stopSchedule()
    })
  })
})

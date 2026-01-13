import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { LocalProvider } from "./local"
import { rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

describe("LocalProvider", () => {
  let provider: LocalProvider
  let baseDir: string

  beforeEach(() => {
    baseDir = join(tmpdir(), `opencode-sandbox-test-${Date.now()}`)
    provider = new LocalProvider(baseDir)
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it("should create a sandbox", async () => {
    const sandbox = await provider.create({
      projectID: "test-project",
      repository: "https://github.com/example/repo",
      branch: "main",
      services: [],
    })

    expect(sandbox.id).toMatch(/^sandbox_/)
    expect(sandbox.projectID).toBe("test-project")
    expect(sandbox.status).toBe("initializing")
    expect(sandbox.provider).toBe("local")
    expect(sandbox.git.repo).toBe("https://github.com/example/repo")
    expect(sandbox.git.branch).toBe("main")
  })

  it("should get sandbox by id", async () => {
    const created = await provider.create({
      projectID: "test-project",
      repository: "https://github.com/example/repo",
      branch: "main",
    })

    const fetched = await provider.get(created.id)
    expect(fetched).toBeDefined()
    expect(fetched?.id).toBe(created.id)
  })

  it("should return undefined for unknown sandbox", async () => {
    const result = await provider.get("unknown-id")
    expect(result).toBeUndefined()
  })

  it("should list sandboxes", async () => {
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

    const filtered = await provider.list("project-1")
    expect(filtered.length).toBe(1)
    expect(filtered[0].projectID).toBe("project-1")
  })

  it("should start and stop a sandbox", async () => {
    const sandbox = await provider.create({
      projectID: "test-project",
      repository: "https://github.com/example/repo",
      branch: "main",
    })

    await provider.start(sandbox.id)
    let updated = await provider.get(sandbox.id)
    expect(updated?.status).toBe("running")

    await provider.stop(sandbox.id)
    updated = await provider.get(sandbox.id)
    expect(updated?.status).toBe("suspended")
  })

  it("should terminate a sandbox", async () => {
    const sandbox = await provider.create({
      projectID: "test-project",
      repository: "https://github.com/example/repo",
      branch: "main",
    })

    await provider.terminate(sandbox.id)
    const updated = await provider.get(sandbox.id)
    expect(updated?.status).toBe("terminated")
  })

  it("should execute commands in sandbox", async () => {
    const sandbox = await provider.create({
      projectID: "test-project",
      repository: "https://github.com/example/repo",
      branch: "main",
    })

    const result = await provider.execute(sandbox.id, ["echo", "hello"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe("hello")
    expect(result.duration).toBeGreaterThan(0)
  })

  it("should handle command errors", async () => {
    const sandbox = await provider.create({
      projectID: "test-project",
      repository: "https://github.com/example/repo",
      branch: "main",
    })

    const result = await provider.execute(sandbox.id, ["false"])
    expect(result.exitCode).toBe(1)
  })

  it("should throw for unknown sandbox operations", async () => {
    await expect(provider.start("unknown")).rejects.toThrow("Sandbox not found")
    await expect(provider.stop("unknown")).rejects.toThrow("Sandbox not found")
    await expect(provider.terminate("unknown")).rejects.toThrow("Sandbox not found")
    await expect(provider.execute("unknown", ["echo"])).rejects.toThrow("Sandbox not found")
    await expect(provider.snapshot("unknown")).rejects.toThrow("Sandbox not found")
  })

  it("should create and restore from snapshot", async () => {
    const sandbox = await provider.create({
      projectID: "test-project",
      repository: "https://github.com/example/repo",
      branch: "main",
    })

    // Create a file in the sandbox
    await provider.execute(sandbox.id, ["sh", "-c", "echo 'test content' > test.txt"])

    // Create snapshot
    const snapshotID = await provider.snapshot(sandbox.id)
    expect(snapshotID).toMatch(/^snapshot_/)

    // Restore from snapshot
    const restored = await provider.restore(snapshotID)
    expect(restored.id).not.toBe(sandbox.id)
    expect(restored.status).toBe("ready")

    // Verify file exists in restored sandbox
    const result = await provider.execute(restored.id, ["cat", "test.txt"])
    expect(result.stdout.trim()).toBe("test content")
  })
})

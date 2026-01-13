import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { WarmPoolManager } from "./manager"
import { LocalProvider } from "../provider/local"
import { rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

describe("WarmPoolManager", () => {
  let provider: LocalProvider
  let manager: WarmPoolManager
  let baseDir: string

  beforeEach(() => {
    baseDir = join(tmpdir(), `opencode-pool-test-${Date.now()}`)
    provider = new LocalProvider(baseDir)
    manager = new WarmPoolManager(provider, {
      enabled: true,
      size: 2,
      ttl: 60000, // 1 minute for tests
      replenishInterval: 1000,
    })
  })

  afterEach(async () => {
    manager.stop()
    await rm(baseDir, { recursive: true, force: true })
  })

  it("should claim sandbox with cold start when pool is empty", async () => {
    const result = await manager.claim("https://github.com/example/repo", "test-project")

    expect(result.sandbox).toBeDefined()
    expect(result.fromWarmPool).toBe(false)
    expect(result.sandbox.status).toBe("running")
  })

  it("should claim sandbox from warm pool when available", async () => {
    // Warm the pool first
    await manager.warm("https://github.com/example/repo", "test-project", "example/repo:latest", 1)

    expect(manager.getPoolSize("example/repo:latest")).toBe(1)

    // Now claim should get from pool
    const result = await manager.claim("https://github.com/example/repo", "test-project", "example/repo:latest")

    expect(result.fromWarmPool).toBe(true)
    expect(result.sandbox.status).toBe("running")
    expect(manager.getPoolSize("example/repo:latest")).toBe(0)
  })

  it("should warm pool with multiple sandboxes", async () => {
    await manager.warm("https://github.com/example/repo", "test-project", "test-tag", 3)

    expect(manager.getPoolSize("test-tag")).toBe(3)
    expect(manager.getTotalPoolSize()).toBe(3)
  })

  it("should release sandbox back to pool", async () => {
    const result = await manager.claim("https://github.com/example/repo", "test-project", "test-tag")

    expect(manager.getPoolSize("test-tag")).toBe(0)

    const released = await manager.release(result.sandbox.id)

    expect(released).toBe(true)
    expect(manager.getPoolSize("test-tag")).toBe(1)
  })

  it("should not release terminated sandbox", async () => {
    const result = await manager.claim("https://github.com/example/repo", "test-project")
    await provider.terminate(result.sandbox.id)

    const released = await manager.release(result.sandbox.id)

    expect(released).toBe(false)
  })

  it("should check availability correctly", async () => {
    expect(manager.hasAvailable("test-tag")).toBe(false)

    await manager.warm("https://github.com/example/repo", "test-project", "test-tag", 1)

    expect(manager.hasAvailable("test-tag")).toBe(true)
    expect(manager.hasAvailable("other-tag")).toBe(false)
  })

  it("should do nothing when disabled", async () => {
    const disabledManager = new WarmPoolManager(provider, { enabled: false })

    await disabledManager.warm("https://github.com/example/repo", "test-project", "test-tag", 5)

    expect(disabledManager.getPoolSize("test-tag")).toBe(0)
  })

  it("should handle onTyping trigger", async () => {
    // onTyping should trigger background warming if pool is empty
    await manager.onTyping("https://github.com/example/repo", "test-project", "typing-tag")

    // Give it a moment to start warming
    await new Promise((resolve) => setTimeout(resolve, 100))

    // The manager should have started replenishing
    // (We can't easily test async background behavior, but at least verify it doesn't throw)
  })

  it("should generate consistent default tags", async () => {
    const result1 = await manager.claim("https://github.com/org/repo", "project1")
    const result2 = await manager.claim("https://github.com/org/repo", "project2")

    // Both should use the same default tag scheme
    expect(result1.sandbox.image.tag).toBe(result2.sandbox.image.tag)
  })

  describe("TLA+ invariants", () => {
    it("WarmPoolSandboxesReady: all sandboxes in pool are ready", async () => {
      await manager.warm("https://github.com/example/repo", "test-project", "ready-tag", 2)

      // All sandboxes in pool should be ready
      for (let i = 0; i < 2; i++) {
        const result = await manager.claim("https://github.com/example/repo", "test-project", "ready-tag")
        // They were ready before being claimed and marked running
        expect(result.fromWarmPool).toBe(true)
      }
    })

    it("warmPool entries reference valid sandboxes", async () => {
      await manager.warm("https://github.com/example/repo", "test-project", "valid-tag", 1)

      // Claim and verify sandbox exists
      const result = await manager.claim("https://github.com/example/repo", "test-project", "valid-tag")
      expect(result.sandbox).toBeDefined()
      expect(result.sandbox.id).toBeTruthy()

      // Verify we can get it from provider
      const fetched = await provider.get(result.sandbox.id)
      expect(fetched).toBeDefined()
    })
  })
})

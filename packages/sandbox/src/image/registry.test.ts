import { describe, test, expect, beforeEach } from "bun:test"
import { ImageRegistry, type ImageInfo } from "./registry"

describe("ImageRegistry", () => {
  let registry: ImageRegistry

  beforeEach(() => {
    registry = new ImageRegistry({
      registryUrl: "registry.opencode.io",
      maxImagesPerBranch: 3,
      maxImageAge: 24 * 60 * 60 * 1000, // 1 day
    })
  })

  describe("parseRepository", () => {
    test("parses full github URL", () => {
      const result = registry.parseRepository("github.com/myorg/myrepo")
      expect(result).toEqual({ org: "myorg", repo: "myrepo" })
    })

    test("parses short format", () => {
      const result = registry.parseRepository("myorg/myrepo")
      expect(result).toEqual({ org: "myorg", repo: "myrepo" })
    })

    test("handles .git suffix", () => {
      const result = registry.parseRepository("github.com/myorg/myrepo.git")
      expect(result).toEqual({ org: "myorg", repo: "myrepo" })
    })

    test("handles https URL", () => {
      const result = registry.parseRepository("https://github.com/myorg/myrepo")
      expect(result).toEqual({ org: "myorg", repo: "myrepo" })
    })

    test("throws on invalid format", () => {
      expect(() => registry.parseRepository("invalid")).toThrow()
    })
  })

  describe("generateTag", () => {
    test("generates timestamped tag", () => {
      const tag = registry.generateTag("myorg/myrepo", "main", 1234567890)
      expect(tag).toBe("registry.opencode.io/opencode/myorg/myrepo:main-1234567890")
    })

    test("uses current timestamp when not provided", () => {
      const before = Date.now()
      const tag = registry.generateTag("myorg/myrepo", "main")
      const after = Date.now()

      const match = tag.match(/:main-(\d+)$/)
      expect(match).toBeTruthy()
      const timestamp = parseInt(match![1], 10)
      expect(timestamp).toBeGreaterThanOrEqual(before)
      expect(timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe("generateLatestTag", () => {
    test("generates latest tag", () => {
      const tag = registry.generateLatestTag("myorg/myrepo", "main")
      expect(tag).toBe("registry.opencode.io/opencode/myorg/myrepo:main-latest")
    })
  })

  describe("parseTag", () => {
    test("parses timestamped tag", () => {
      const result = registry.parseTag("registry.opencode.io/opencode/myorg/myrepo:main-1234567890")
      expect(result).toEqual({
        org: "myorg",
        repo: "myrepo",
        branch: "main",
        timestamp: 1234567890,
        isLatest: false,
      })
    })

    test("parses latest tag", () => {
      const result = registry.parseTag("registry.opencode.io/opencode/myorg/myrepo:main-latest")
      expect(result).toEqual({
        org: "myorg",
        repo: "myrepo",
        branch: "main",
        timestamp: undefined,
        isLatest: true,
      })
    })

    test("returns null for invalid tag", () => {
      expect(registry.parseTag("invalid-tag")).toBeNull()
    })
  })

  describe("register", () => {
    test("registers a new image", () => {
      const image = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1234567890",
        digest: "sha256:abc123",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "abc123def",
        builtAt: Date.now(),
        services: ["vite"],
      })

      expect(image.id).toBeTruthy()
      expect(image.tag).toBe("registry.opencode.io/opencode/myorg/myrepo:main-1234567890")
      expect(image.isLatest).toBe(true) // First image is latest
    })

    test("first image is marked as latest", () => {
      const image = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:first",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "first",
        builtAt: 1000,
      })

      expect(image.isLatest).toBe(true)
    })

    test("newer image becomes latest", () => {
      const image1 = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:first",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "first",
        builtAt: 1000,
      })

      const image2 = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-2000",
        digest: "sha256:second",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "second",
        builtAt: 2000,
      })

      expect(image2.isLatest).toBe(true)

      // Original should no longer be latest
      const updatedImage1 = registry.get(image1.id)
      expect(updatedImage1?.isLatest).toBe(false)
    })

    test("older image does not become latest", () => {
      registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-2000",
        digest: "sha256:second",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "second",
        builtAt: 2000,
      })

      const olderImage = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:older",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "older",
        builtAt: 1000,
      })

      expect(olderImage.isLatest).toBe(false)
    })
  })

  describe("get / getByTag / getByDigest", () => {
    test("gets image by id", () => {
      const image = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:abc",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "abc",
        builtAt: 1000,
      })

      const retrieved = registry.get(image.id)
      expect(retrieved).toEqual(image)
    })

    test("gets image by tag", () => {
      const image = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:abc",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "abc",
        builtAt: 1000,
      })

      const retrieved = registry.getByTag("registry.opencode.io/opencode/myorg/myrepo:main-1000")
      expect(retrieved).toEqual(image)
    })

    test("gets image by digest", () => {
      const image = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:unique-digest",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "abc",
        builtAt: 1000,
      })

      const retrieved = registry.getByDigest("sha256:unique-digest")
      expect(retrieved).toEqual(image)
    })

    test("returns undefined for unknown id", () => {
      expect(registry.get("unknown")).toBeUndefined()
    })
  })

  describe("getLatest", () => {
    test("returns latest image for repo/branch", () => {
      registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:first",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "first",
        builtAt: 1000,
      })

      const second = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-2000",
        digest: "sha256:second",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "second",
        builtAt: 2000,
      })

      const latest = registry.getLatest("myorg/myrepo", "main")
      expect(latest?.id).toBe(second.id)
    })

    test("returns undefined for unknown repo", () => {
      expect(registry.getLatest("unknown/repo", "main")).toBeUndefined()
    })
  })

  describe("list", () => {
    beforeEach(() => {
      registry.register({
        tag: "registry.opencode.io/opencode/org1/repo1:main-1000",
        digest: "sha256:1",
        repository: "org1/repo1",
        branch: "main",
        commit: "1",
        builtAt: 1000,
      })

      registry.register({
        tag: "registry.opencode.io/opencode/org1/repo1:main-2000",
        digest: "sha256:2",
        repository: "org1/repo1",
        branch: "main",
        commit: "2",
        builtAt: 2000,
      })

      registry.register({
        tag: "registry.opencode.io/opencode/org1/repo1:develop-1000",
        digest: "sha256:3",
        repository: "org1/repo1",
        branch: "develop",
        commit: "3",
        builtAt: 1000,
      })

      registry.register({
        tag: "registry.opencode.io/opencode/org2/repo2:main-1000",
        digest: "sha256:4",
        repository: "org2/repo2",
        branch: "main",
        commit: "4",
        builtAt: 1000,
      })
    })

    test("lists all images", () => {
      const images = registry.list()
      expect(images.length).toBe(4)
    })

    test("filters by repository", () => {
      const images = registry.list({ repository: "org1/repo1" })
      expect(images.length).toBe(3)
    })

    test("filters by branch", () => {
      const images = registry.list({ repository: "org1/repo1", branch: "main" })
      expect(images.length).toBe(2)
    })

    test("filters to latest only", () => {
      const images = registry.list({ latestOnly: true })
      expect(images.length).toBe(3) // 3 unique repo/branch combos
      expect(images.every((img) => img.isLatest)).toBe(true)
    })

    test("applies pagination", () => {
      const images = registry.list({ limit: 2, offset: 1 })
      expect(images.length).toBe(2)
    })

    test("sorts by builtAt descending", () => {
      const images = registry.list()
      for (let i = 1; i < images.length; i++) {
        expect(images[i - 1].builtAt).toBeGreaterThanOrEqual(images[i].builtAt)
      }
    })
  })

  describe("listRepositories", () => {
    test("lists unique repo/branch combinations", () => {
      registry.register({
        tag: "registry.opencode.io/opencode/org1/repo1:main-1000",
        digest: "sha256:1",
        repository: "org1/repo1",
        branch: "main",
        commit: "1",
        builtAt: 1000,
      })

      registry.register({
        tag: "registry.opencode.io/opencode/org1/repo1:develop-1000",
        digest: "sha256:2",
        repository: "org1/repo1",
        branch: "develop",
        commit: "2",
        builtAt: 1000,
      })

      const repos = registry.listRepositories()
      expect(repos.length).toBe(2)
    })
  })

  describe("delete", () => {
    test("deletes an image", () => {
      const image = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:abc",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "abc",
        builtAt: 1000,
      })

      const deleted = registry.delete(image.id)
      expect(deleted).toBe(true)
      expect(registry.get(image.id)).toBeUndefined()
    })

    test("promotes next latest when deleting latest", () => {
      const first = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:first",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "first",
        builtAt: 1000,
      })

      const second = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-2000",
        digest: "sha256:second",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "second",
        builtAt: 2000,
      })

      // Delete the latest (second)
      registry.delete(second.id)

      // First should now be latest
      const updatedFirst = registry.get(first.id)
      expect(updatedFirst?.isLatest).toBe(true)
    })

    test("returns false for unknown id", () => {
      expect(registry.delete("unknown")).toBe(false)
    })
  })

  describe("cleanup", () => {
    test("removes images exceeding maxImagesPerBranch", () => {
      // Register 5 images (max is 3) with recent timestamps so age doesn't trigger deletion
      const now = Date.now()
      for (let i = 1; i <= 5; i++) {
        registry.register({
          tag: `registry.opencode.io/opencode/myorg/myrepo:main-${now + i * 1000}`,
          digest: `sha256:${i}`,
          repository: "myorg/myrepo",
          branch: "main",
          commit: `${i}`,
          builtAt: now + i * 1000, // Recent timestamps
        })
      }

      const deleted = registry.cleanup()
      expect(deleted).toBe(2) // Should keep 3 (including latest)
    })

    test("removes old images", () => {
      const oldTime = Date.now() - 2 * 24 * 60 * 60 * 1000 // 2 days ago

      registry.register({
        tag: `registry.opencode.io/opencode/myorg/myrepo:main-old`,
        digest: `sha256:old`,
        repository: "myorg/myrepo",
        branch: "main",
        commit: "old",
        builtAt: oldTime,
      })

      registry.register({
        tag: `registry.opencode.io/opencode/myorg/myrepo:main-new`,
        digest: `sha256:new`,
        repository: "myorg/myrepo",
        branch: "main",
        commit: "new",
        builtAt: Date.now(),
      })

      const deleted = registry.cleanup()
      expect(deleted).toBe(1) // Old one should be deleted
    })

    test("never deletes latest images", () => {
      const oldTime = Date.now() - 2 * 24 * 60 * 60 * 1000

      const image = registry.register({
        tag: `registry.opencode.io/opencode/myorg/myrepo:main-old`,
        digest: `sha256:old`,
        repository: "myorg/myrepo",
        branch: "main",
        commit: "old",
        builtAt: oldTime,
      })

      // It's the latest (only image), so shouldn't be deleted
      const deleted = registry.cleanup()
      expect(deleted).toBe(0)
      expect(registry.get(image.id)).toBeTruthy()
    })
  })

  describe("getStats", () => {
    test("returns registry statistics", () => {
      registry.register({
        tag: "registry.opencode.io/opencode/org1/repo1:main-1000",
        digest: "sha256:1",
        repository: "org1/repo1",
        branch: "main",
        commit: "1",
        builtAt: 1000,
        sizeBytes: 100,
      })

      registry.register({
        tag: "registry.opencode.io/opencode/org2/repo2:main-2000",
        digest: "sha256:2",
        repository: "org2/repo2",
        branch: "main",
        commit: "2",
        builtAt: 2000,
        sizeBytes: 200,
      })

      const stats = registry.getStats()
      expect(stats.totalImages).toBe(2)
      expect(stats.totalRepositories).toBe(2)
      expect(stats.totalSize).toBe(300)
      expect(stats.oldestImage).toBe(1000)
      expect(stats.newestImage).toBe(2000)
    })

    test("returns null for empty registry", () => {
      const stats = registry.getStats()
      expect(stats.totalImages).toBe(0)
      expect(stats.oldestImage).toBeNull()
      expect(stats.newestImage).toBeNull()
    })
  })

  describe("exists / tagExists", () => {
    test("checks if image exists by id", () => {
      const image = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:abc",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "abc",
        builtAt: 1000,
      })

      expect(registry.exists(image.id)).toBe(true)
      expect(registry.exists("unknown")).toBe(false)
    })

    test("checks if tag exists", () => {
      registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:abc",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "abc",
        builtAt: 1000,
      })

      expect(registry.tagExists("registry.opencode.io/opencode/myorg/myrepo:main-1000")).toBe(true)
      expect(registry.tagExists("registry.opencode.io/opencode/myorg/myrepo:main-9999")).toBe(false)
    })
  })

  describe("update", () => {
    test("updates image metadata", () => {
      const image = registry.register({
        tag: "registry.opencode.io/opencode/myorg/myrepo:main-1000",
        digest: "sha256:abc",
        repository: "myorg/myrepo",
        branch: "main",
        commit: "abc",
        builtAt: 1000,
      })

      const updated = registry.update(image.id, {
        sizeBytes: 12345,
        labels: { env: "prod" },
      })

      expect(updated?.sizeBytes).toBe(12345)
      expect(updated?.labels).toEqual({ env: "prod" })
    })

    test("returns undefined for unknown id", () => {
      expect(registry.update("unknown", { sizeBytes: 100 })).toBeUndefined()
    })
  })
})

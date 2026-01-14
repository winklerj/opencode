import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { Filesystem } from "../../src/util/filesystem"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("Filesystem", () => {
  describe("contains", () => {
    test("returns true when child is inside parent", () => {
      expect(Filesystem.contains("/home/user/project", "/home/user/project/src/file.ts")).toBe(true)
    })

    test("returns false when child is outside parent", () => {
      expect(Filesystem.contains("/home/user/project", "/home/other/file.ts")).toBe(false)
    })

    test("returns false when child uses .. to escape", () => {
      expect(Filesystem.contains("/home/user/project", "/home/user/project/../../../etc/passwd")).toBe(false)
    })

    test("returns true for equal paths", () => {
      expect(Filesystem.contains("/home/user/project", "/home/user/project")).toBe(true)
    })
  })

  describe("containsSafe", () => {
    const testDir = join(tmpdir(), `opencode-fs-test-${Date.now()}`)
    const projectDir = join(testDir, "project")
    const outsideDir = join(testDir, "outside")

    beforeAll(() => {
      // Create test directory structure
      mkdirSync(projectDir, { recursive: true })
      mkdirSync(outsideDir, { recursive: true })

      // Create files
      writeFileSync(join(projectDir, "inside.txt"), "inside")
      writeFileSync(join(outsideDir, "secret.txt"), "secret")

      // Create symlink inside project that points outside
      symlinkSync(outsideDir, join(projectDir, "escape-link"))
    })

    afterAll(() => {
      // Clean up test directory
      rmSync(testDir, { recursive: true, force: true })
    })

    test("returns true for regular file inside project", () => {
      expect(Filesystem.containsSafe(projectDir, join(projectDir, "inside.txt"))).toBe(true)
    })

    test("returns false for file outside project", () => {
      expect(Filesystem.containsSafe(projectDir, join(outsideDir, "secret.txt"))).toBe(false)
    })

    test("returns false when symlink escapes project boundary", () => {
      // The symlink "escape-link" points to outsideDir
      // Accessing escape-link/secret.txt should be blocked
      const escapePath = join(projectDir, "escape-link", "secret.txt")
      expect(Filesystem.containsSafe(projectDir, escapePath)).toBe(false)
    })

    test("returns true for non-existent file in valid directory", () => {
      // Non-existent file should be allowed if its parent is inside project
      expect(Filesystem.containsSafe(projectDir, join(projectDir, "new-file.txt"))).toBe(true)
    })

    test("returns false for non-existent file via symlink escape", () => {
      // Non-existent file via symlink should still be blocked
      const escapePath = join(projectDir, "escape-link", "new-secret.txt")
      expect(Filesystem.containsSafe(projectDir, escapePath)).toBe(false)
    })
  })

  describe("overlaps", () => {
    test("returns true when paths overlap", () => {
      expect(Filesystem.overlaps("/home/user/project", "/home/user/project/src")).toBe(true)
      expect(Filesystem.overlaps("/home/user/project/src", "/home/user/project")).toBe(true)
    })

    test("returns false when paths don't overlap", () => {
      expect(Filesystem.overlaps("/home/user/project1", "/home/user/project2")).toBe(false)
    })
  })
})

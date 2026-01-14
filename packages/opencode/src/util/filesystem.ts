import { realpathSync } from "fs"
import { exists } from "fs/promises"
import { dirname, join, relative } from "path"

export namespace Filesystem {
  /**
   * On Windows, normalize a path to its canonical casing using the filesystem.
   * This is needed because Windows paths are case-insensitive but LSP servers
   * may return paths with different casing than what we send them.
   */
  export function normalizePath(p: string): string {
    if (process.platform !== "win32") return p
    try {
      return realpathSync.native(p)
    } catch {
      return p
    }
  }
  export function overlaps(a: string, b: string) {
    const relA = relative(a, b)
    const relB = relative(b, a)
    return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..")
  }

  export function contains(parent: string, child: string) {
    return !relative(parent, child).startsWith("..")
  }

  /**
   * Check if a child path is contained within a parent path,
   * resolving symlinks to prevent path traversal attacks.
   *
   * This is safer than lexical `contains` because it resolves symlinks
   * before checking containment. If the child doesn't exist yet or
   * realpath fails, falls back to lexical check.
   */
  export function containsSafe(parent: string, child: string): boolean {
    try {
      // Resolve parent to canonical path
      const canonicalParent = realpathSync.native(parent)

      // For the child, we need to handle the case where it doesn't exist yet
      // Try to resolve the child, if it fails, resolve the parent of the child
      let canonicalChild: string
      try {
        canonicalChild = realpathSync.native(child)
      } catch {
        // Child doesn't exist - resolve its parent directory and append the filename
        const childDir = dirname(child)
        const childName = child.slice(childDir.length + 1)
        try {
          const canonicalChildDir = realpathSync.native(childDir)
          canonicalChild = join(canonicalChildDir, childName)
        } catch {
          // Even parent doesn't exist, fall back to lexical check
          return contains(parent, child)
        }
      }

      // Check containment with canonical paths
      return !relative(canonicalParent, canonicalChild).startsWith("..")
    } catch {
      // If realpath fails (e.g., permission denied), fall back to lexical check
      return contains(parent, child)
    }
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      const search = join(current, target)
      if (await exists(search).catch(() => false)) result.push(search)
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = start
    while (true) {
      for (const target of targets) {
        const search = join(current, target)
        if (await exists(search).catch(() => false)) yield search
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(pattern: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      try {
        const glob = new Bun.Glob(pattern)
        for await (const match of glob.scan({
          cwd: current,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        })) {
          result.push(match)
        }
      } catch {
        // Skip invalid glob patterns
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}

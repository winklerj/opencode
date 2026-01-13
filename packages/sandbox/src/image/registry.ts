import { z } from "zod"

/**
 * Image information stored in the registry
 */
export const ImageInfo = z.object({
  /**
   * Unique image ID
   */
  id: z.string(),

  /**
   * Full image tag (registry/opencode/org/repo:branch-timestamp)
   */
  tag: z.string(),

  /**
   * Image digest for verification
   */
  digest: z.string(),

  /**
   * Repository this image was built from
   */
  repository: z.string(),

  /**
   * Branch used for the build
   */
  branch: z.string(),

  /**
   * Git commit SHA at build time
   */
  commit: z.string(),

  /**
   * Timestamp when image was built
   */
  builtAt: z.number(),

  /**
   * Image size in bytes
   */
  sizeBytes: z.number().optional(),

  /**
   * Services included in this image
   */
  services: z.array(z.string()).default([]),

  /**
   * Whether this is the "latest" tag for this repo/branch
   */
  isLatest: z.boolean().default(false),

  /**
   * Custom labels/metadata
   */
  labels: z.record(z.string(), z.string()).optional(),
})
export type ImageInfo = z.infer<typeof ImageInfo>

/**
 * Input for registering a new image (id and isLatest are optional)
 */
export const RegisterImageInput = ImageInfo.omit({ id: true, isLatest: true }).extend({
  id: z.string().optional(),
  isLatest: z.boolean().optional(),
})
export type RegisterImageInput = z.input<typeof RegisterImageInput>

/**
 * Configuration for the image registry
 */
export const RegistryConfig = z.object({
  /**
   * Base URL of the container registry
   */
  registryUrl: z.string().default("registry.opencode.io"),

  /**
   * Maximum number of images to keep per repo/branch
   */
  maxImagesPerBranch: z.number().default(10),

  /**
   * Maximum age of non-latest images in milliseconds (default: 7 days)
   */
  maxImageAge: z.number().default(7 * 24 * 60 * 60 * 1000),

  /**
   * Registry credentials
   */
  credentials: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .optional(),
})
export type RegistryConfig = z.infer<typeof RegistryConfig>

/**
 * Query options for listing images
 */
export interface ImageQuery {
  repository?: string
  branch?: string
  latestOnly?: boolean
  limit?: number
  offset?: number
}

/**
 * ImageRegistry manages container images with a tagging strategy.
 *
 * Tagging Strategy:
 * - {registry}/opencode/{org}/{repo}:{branch}-{timestamp}
 * - {registry}/opencode/{org}/{repo}:{branch}-latest
 *
 * Features:
 * - Image versioning with timestamp-based tags
 * - Latest tag tracking per repository/branch
 * - Automatic cleanup of old images
 * - Image metadata storage and queries
 */
export class ImageRegistry {
  private config: Required<RegistryConfig>
  private images = new Map<string, ImageInfo>()
  private latestByRepoBranch = new Map<string, string>() // repo:branch -> imageId
  private idCounter = 0

  constructor(config: Partial<RegistryConfig> = {}) {
    this.config = RegistryConfig.parse(config) as Required<RegistryConfig>
  }

  /**
   * Generate a unique image ID
   */
  private generateId(): string {
    return `img_${Date.now()}_${++this.idCounter}`
  }

  /**
   * Get the key for repo/branch lookup
   */
  private getRepoBranchKey(repository: string, branch: string): string {
    return `${repository}:${branch}`
  }

  /**
   * Parse a repository URL into org and repo name
   */
  parseRepository(repository: string): { org: string; repo: string } {
    const match = repository.match(/(?:github\.com\/)?([^\/]+)\/([^\/]+?)(?:\.git)?$/)
    if (!match) {
      throw new Error(`Invalid repository format: ${repository}`)
    }
    return { org: match[1], repo: match[2] }
  }

  /**
   * Generate a full image tag
   */
  generateTag(repository: string, branch: string, timestamp?: number): string {
    const { org, repo } = this.parseRepository(repository)
    const ts = timestamp ?? Date.now()
    return `${this.config.registryUrl}/opencode/${org}/${repo}:${branch}-${ts}`
  }

  /**
   * Generate a latest tag
   */
  generateLatestTag(repository: string, branch: string): string {
    const { org, repo } = this.parseRepository(repository)
    return `${this.config.registryUrl}/opencode/${org}/${repo}:${branch}-latest`
  }

  /**
   * Parse an image tag into components
   */
  parseTag(tag: string): { org: string; repo: string; branch: string; timestamp?: number; isLatest: boolean } | null {
    // Match: registry/opencode/org/repo:branch-timestamp or registry/opencode/org/repo:branch-latest
    const match = tag.match(/(?:.*\/)?opencode\/([^\/]+)\/([^:]+):([^-]+)-(.+)$/)
    if (!match) return null

    const [, org, repo, branch, suffix] = match
    const isLatest = suffix === "latest"
    const timestamp = isLatest ? undefined : parseInt(suffix, 10)

    return { org, repo, branch, timestamp, isLatest }
  }

  /**
   * Register a new image in the registry
   */
  register(input: RegisterImageInput): ImageInfo {
    const parsed = RegisterImageInput.parse(input)
    const id = parsed.id ?? this.generateId()
    const key = this.getRepoBranchKey(parsed.repository, parsed.branch)

    // Check if this should be the new latest
    const existingLatestId = this.latestByRepoBranch.get(key)
    const existingLatest = existingLatestId ? this.images.get(existingLatestId) : undefined

    const isLatest =
      parsed.isLatest ?? (!existingLatest || parsed.builtAt >= existingLatest.builtAt)

    // If this is now the latest, update the old latest
    if (isLatest && existingLatest && existingLatest.id !== id) {
      const updatedOld: ImageInfo = { ...existingLatest, isLatest: false }
      this.images.set(existingLatest.id, updatedOld)
    }

    const image: ImageInfo = {
      id,
      tag: parsed.tag,
      digest: parsed.digest,
      repository: parsed.repository,
      branch: parsed.branch,
      commit: parsed.commit,
      builtAt: parsed.builtAt,
      sizeBytes: parsed.sizeBytes,
      services: parsed.services,
      isLatest,
      labels: parsed.labels,
    }

    this.images.set(id, image)

    if (isLatest) {
      this.latestByRepoBranch.set(key, id)
    }

    return image
  }

  /**
   * Get an image by ID
   */
  get(id: string): ImageInfo | undefined {
    return this.images.get(id)
  }

  /**
   * Get an image by tag
   */
  getByTag(tag: string): ImageInfo | undefined {
    for (const image of this.images.values()) {
      if (image.tag === tag) return image
    }
    return undefined
  }

  /**
   * Get an image by digest
   */
  getByDigest(digest: string): ImageInfo | undefined {
    for (const image of this.images.values()) {
      if (image.digest === digest) return image
    }
    return undefined
  }

  /**
   * Get the latest image for a repository/branch
   */
  getLatest(repository: string, branch: string): ImageInfo | undefined {
    const key = this.getRepoBranchKey(repository, branch)
    const id = this.latestByRepoBranch.get(key)
    return id ? this.images.get(id) : undefined
  }

  /**
   * List images matching the query
   */
  list(query: ImageQuery = {}): ImageInfo[] {
    let results = Array.from(this.images.values())

    // Filter by repository
    if (query.repository) {
      results = results.filter((img) => img.repository === query.repository)
    }

    // Filter by branch
    if (query.branch) {
      results = results.filter((img) => img.branch === query.branch)
    }

    // Filter to latest only
    if (query.latestOnly) {
      results = results.filter((img) => img.isLatest)
    }

    // Sort by builtAt descending
    results.sort((a, b) => b.builtAt - a.builtAt)

    // Apply pagination
    const offset = query.offset ?? 0
    const limit = query.limit ?? results.length

    return results.slice(offset, offset + limit)
  }

  /**
   * List all unique repository/branch combinations
   */
  listRepositories(): Array<{ repository: string; branch: string; latestImage: ImageInfo }> {
    const repos: Array<{ repository: string; branch: string; latestImage: ImageInfo }> = []

    for (const [key, imageId] of this.latestByRepoBranch) {
      const [repository, branch] = key.split(":")
      const latestImage = this.images.get(imageId)
      if (latestImage) {
        repos.push({ repository, branch, latestImage })
      }
    }

    return repos
  }

  /**
   * Delete an image from the registry
   */
  delete(id: string): boolean {
    const image = this.images.get(id)
    if (!image) return false

    // If this is the latest, find the next latest
    if (image.isLatest) {
      const key = this.getRepoBranchKey(image.repository, image.branch)
      const others = this.list({
        repository: image.repository,
        branch: image.branch,
      }).filter((img) => img.id !== id)

      if (others.length > 0) {
        // Promote the next most recent to latest
        const nextLatest = others[0]
        const updated: ImageInfo = { ...nextLatest, isLatest: true }
        this.images.set(nextLatest.id, updated)
        this.latestByRepoBranch.set(key, nextLatest.id)
      } else {
        // No other images for this repo/branch
        this.latestByRepoBranch.delete(key)
      }
    }

    return this.images.delete(id)
  }

  /**
   * Clean up old images based on retention policy
   *
   * Returns the number of images deleted
   */
  cleanup(): number {
    const now = Date.now()
    let deleted = 0

    // Group images by repo/branch
    const byRepoBranch = new Map<string, ImageInfo[]>()
    for (const image of this.images.values()) {
      const key = this.getRepoBranchKey(image.repository, image.branch)
      const existing = byRepoBranch.get(key) ?? []
      existing.push(image)
      byRepoBranch.set(key, existing)
    }

    for (const [, images] of byRepoBranch) {
      // Sort by builtAt descending
      images.sort((a, b) => b.builtAt - a.builtAt)

      for (let i = 0; i < images.length; i++) {
        const image = images[i]

        // Never delete latest images
        if (image.isLatest) continue

        // Delete if exceeds max images per branch
        if (i >= this.config.maxImagesPerBranch) {
          if (this.delete(image.id)) deleted++
          continue
        }

        // Delete if exceeds max age
        const age = now - image.builtAt
        if (age > this.config.maxImageAge) {
          if (this.delete(image.id)) deleted++
        }
      }
    }

    return deleted
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalImages: number
    totalRepositories: number
    totalSize: number
    oldestImage: number | null
    newestImage: number | null
  } {
    const images = Array.from(this.images.values())

    let totalSize = 0
    let oldest: number | null = null
    let newest: number | null = null

    for (const image of images) {
      totalSize += image.sizeBytes ?? 0
      if (oldest === null || image.builtAt < oldest) oldest = image.builtAt
      if (newest === null || image.builtAt > newest) newest = image.builtAt
    }

    return {
      totalImages: images.length,
      totalRepositories: this.latestByRepoBranch.size,
      totalSize,
      oldestImage: oldest,
      newestImage: newest,
    }
  }

  /**
   * Check if an image exists
   */
  exists(id: string): boolean {
    return this.images.has(id)
  }

  /**
   * Check if a tag exists
   */
  tagExists(tag: string): boolean {
    return this.getByTag(tag) !== undefined
  }

  /**
   * Update image metadata
   */
  update(id: string, updates: Partial<Pick<ImageInfo, "labels" | "sizeBytes">>): ImageInfo | undefined {
    const image = this.images.get(id)
    if (!image) return undefined

    const updated: ImageInfo = {
      ...image,
      ...updates,
    }
    this.images.set(id, updated)
    return updated
  }
}

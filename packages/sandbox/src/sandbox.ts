import { z } from "zod"

/**
 * Sandbox namespace contains all types and schemas for sandbox orchestration.
 *
 * A sandbox is an isolated execution environment for running code, with access
 * to git repositories, development services, and file system operations.
 */
export namespace Sandbox {
  /**
   * Status of the sandbox lifecycle
   */
  export const Status = z.enum(["initializing", "ready", "running", "suspended", "terminated"])
  export type Status = z.infer<typeof Status>

  /**
   * Git synchronization status
   */
  export const GitSyncStatus = z.enum(["pending", "syncing", "synced", "error"])
  export type GitSyncStatus = z.infer<typeof GitSyncStatus>

  /**
   * Supported sandbox providers
   */
  export const ProviderType = z.enum(["modal", "local", "kubernetes"])
  export type ProviderType = z.infer<typeof ProviderType>

  /**
   * Service status within a sandbox
   */
  export const ServiceStatus = z.enum(["starting", "running", "stopped", "error"])
  export type ServiceStatus = z.infer<typeof ServiceStatus>

  /**
   * Container image information
   */
  export const Image = z.object({
    id: z.string(),
    tag: z.string(),
    digest: z.string(),
    builtAt: z.number(),
  })
  export type Image = z.infer<typeof Image>

  /**
   * Git repository state
   */
  export const Git = z.object({
    repo: z.string(),
    branch: z.string(),
    commit: z.string(),
    syncStatus: GitSyncStatus,
    syncedAt: z.number().optional(),
  })
  export type Git = z.infer<typeof Git>

  /**
   * Service running within a sandbox
   */
  export const Service = z.object({
    name: z.string(),
    status: ServiceStatus,
    port: z.number().optional(),
    url: z.string().optional(),
  })
  export type Service = z.infer<typeof Service>

  /**
   * Network configuration for a sandbox
   */
  export const Network = z.object({
    internalIP: z.string(),
    ports: z.record(z.string(), z.number()),
    publicURL: z.string().optional(),
  })
  export type Network = z.infer<typeof Network>

  /**
   * Snapshot reference
   */
  export const SnapshotRef = z.object({
    id: z.string(),
    createdAt: z.number(),
  })
  export type SnapshotRef = z.infer<typeof SnapshotRef>

  /**
   * Timing information for sandbox lifecycle
   */
  export const Time = z.object({
    created: z.number(),
    ready: z.number().optional(),
    lastActivity: z.number(),
  })
  export type Time = z.infer<typeof Time>

  /**
   * Complete sandbox information
   */
  export const Info = z.object({
    id: z.string(),
    projectID: z.string(),
    status: Status,
    provider: ProviderType,
    image: Image,
    git: Git,
    services: z.array(Service),
    network: Network,
    snapshot: SnapshotRef.optional(),
    time: Time,
  })
  export type Info = z.infer<typeof Info>

  /**
   * Resource limits for a sandbox
   */
  export const Resources = z.object({
    cpu: z.number().default(2),
    memory: z.number().default(4096),
    disk: z.number().default(20),
  })
  export type Resources = z.infer<typeof Resources>

  /**
   * Input for creating a new sandbox
   */
  export const CreateInput = z.object({
    projectID: z.string(),
    repository: z.string(),
    branch: z.string().optional().default("main"),
    services: z.array(z.string()).optional().default([]),
    resources: Resources.optional(),
    imageTag: z.string().optional(),
    snapshotID: z.string().optional(),
  })
  /** Input type for sandbox creation (optional fields allowed) */
  export type CreateInput = z.input<typeof CreateInput>
  /** Parsed/output type with defaults applied */
  export type CreateInputParsed = z.output<typeof CreateInput>

  /**
   * Result from executing a command in a sandbox
   */
  export const ExecuteResult = z.object({
    exitCode: z.number(),
    stdout: z.string(),
    stderr: z.string(),
    duration: z.number(),
  })
  export type ExecuteResult = z.infer<typeof ExecuteResult>
}

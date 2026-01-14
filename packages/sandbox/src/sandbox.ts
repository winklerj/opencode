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
   * Network security configuration for sandboxes.
   * Controls which external hosts the sandbox can communicate with.
   */
  export const NetworkSecurity = z.object({
    /** Allowed egress patterns (glob patterns like "*.github.com") */
    allowedEgress: z
      .array(z.string())
      .default(["*.github.com", "*.npmjs.org", "api.anthropic.com", "registry.yarnpkg.com"]),
    /** Denied egress patterns (cloud metadata endpoints, etc.) */
    denyEgress: z
      .array(z.string())
      .default(["169.254.169.254", "metadata.google.internal", "100.100.100.200"]),
  })
  export type NetworkSecurity = z.infer<typeof NetworkSecurity>

  /**
   * Filesystem security configuration for sandboxes.
   * Controls which paths are read-only vs writable.
   */
  export const FilesystemSecurity = z.object({
    /** Paths that should be read-only */
    readOnlyPaths: z.array(z.string()).default(["/etc", "/usr", "/bin", "/sbin"]),
    /** Paths that are writable */
    writablePaths: z.array(z.string()).default(["/workspace", "/tmp", "/home"]),
  })
  export type FilesystemSecurity = z.infer<typeof FilesystemSecurity>

  /**
   * Process and resource limits for sandbox security.
   */
  export const Limits = z.object({
    /** Maximum number of processes */
    maxProcesses: z.number().default(100),
    /** Maximum memory in MB */
    maxMemoryMB: z.number().default(8192),
    /** Maximum execution time in ms */
    maxExecutionTimeMs: z.number().default(3600000),
    /** Maximum open files */
    maxOpenFiles: z.number().default(1024),
  })
  export type Limits = z.infer<typeof Limits>

  /**
   * Complete security configuration for sandboxes.
   * Based on SPECIFICATION.md Section 10.1.
   */
  export const Security = z.object({
    network: NetworkSecurity.optional(),
    filesystem: FilesystemSecurity.optional(),
    limits: Limits.optional(),
  })
  export type Security = z.infer<typeof Security>

  /** Default security configuration */
  export const DEFAULT_SECURITY: Security = {
    network: {
      allowedEgress: ["*.github.com", "*.npmjs.org", "api.anthropic.com", "registry.yarnpkg.com"],
      denyEgress: ["169.254.169.254", "metadata.google.internal", "100.100.100.200"],
    },
    filesystem: {
      readOnlyPaths: ["/etc", "/usr", "/bin", "/sbin"],
      writablePaths: ["/workspace", "/tmp", "/home"],
    },
    limits: {
      maxProcesses: 100,
      maxMemoryMB: 8192,
      maxExecutionTimeMs: 3600000,
      maxOpenFiles: 1024,
    },
  }

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

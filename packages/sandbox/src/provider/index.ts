import type { Sandbox } from "../sandbox"

/**
 * Provider interface for sandbox backends.
 *
 * Implementations must provide methods for the complete sandbox lifecycle:
 * creation, starting, stopping, snapshotting, and command execution.
 */
export interface Provider {
  /**
   * Provider name for identification
   */
  readonly name: Sandbox.ProviderType

  /**
   * Create a new sandbox
   */
  create(input: Sandbox.CreateInput): Promise<Sandbox.Info>

  /**
   * Get sandbox information by ID
   */
  get(sandboxID: string): Promise<Sandbox.Info | undefined>

  /**
   * List all sandboxes, optionally filtered by project
   */
  list(projectID?: string): Promise<Sandbox.Info[]>

  /**
   * Start a stopped or suspended sandbox
   */
  start(sandboxID: string): Promise<void>

  /**
   * Stop a running sandbox (can be restarted)
   */
  stop(sandboxID: string): Promise<void>

  /**
   * Terminate a sandbox permanently
   */
  terminate(sandboxID: string): Promise<void>

  /**
   * Create a snapshot of the sandbox for later restoration
   * Returns the snapshot ID
   */
  snapshot(sandboxID: string): Promise<string>

  /**
   * Restore a sandbox from a snapshot
   */
  restore(snapshotID: string): Promise<Sandbox.Info>

  /**
   * Execute a command in the sandbox
   */
  execute(sandboxID: string, command: string[], options?: ExecuteOptions): Promise<Sandbox.ExecuteResult>

  /**
   * Stream logs from a service running in the sandbox
   */
  streamLogs(sandboxID: string, service: string): AsyncIterable<string>

  /**
   * Trigger git sync in the sandbox
   */
  syncGit(sandboxID: string): Promise<void>

  /**
   * Get the current git sync status
   */
  getGitStatus(sandboxID: string): Promise<Sandbox.Git>
}

/**
 * Options for command execution
 */
export interface ExecuteOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number
}

export { LocalProvider } from "./local"

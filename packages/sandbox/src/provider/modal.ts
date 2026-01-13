import { Sandbox } from "../sandbox"
import type { Provider, ExecuteOptions } from "./index"

/**
 * Configuration options for the Modal provider
 */
export interface ModalConfig {
  /**
   * Modal API token for authentication.
   * Can be provided via MODAL_TOKEN_ID and MODAL_TOKEN_SECRET env vars.
   */
  tokenId?: string
  tokenSecret?: string

  /**
   * Modal app name to use for sandbox functions
   */
  appName?: string

  /**
   * Default CPU allocation for sandboxes
   */
  defaultCpu?: number

  /**
   * Default memory in MB for sandboxes
   */
  defaultMemory?: number

  /**
   * Default timeout in seconds
   */
  defaultTimeout?: number

  /**
   * Base URL for Modal API (for testing/staging)
   */
  apiBaseUrl?: string
}

/**
 * Modal provider for production sandbox orchestration.
 *
 * This provider uses Modal.com's serverless infrastructure to run sandboxes
 * as isolated containers with GPU support, auto-scaling, and built-in snapshots.
 *
 * Modal provides:
 * - Fast cold starts (sub-second with warm pools)
 * - Built-in snapshot/restore for VM state
 * - Auto-scaling based on demand
 * - Integrated log streaming
 * - Service orchestration (code-server, VNC, etc.)
 */
export class ModalProvider implements Provider {
  readonly name = "modal" as const

  private sandboxes = new Map<string, ModalSandbox>()
  private snapshots = new Map<string, ModalSnapshot>()
  private idCounter = 0

  private readonly config: Required<ModalConfig>
  private readonly headers: Record<string, string>

  constructor(config: ModalConfig = {}) {
    this.config = {
      tokenId: config.tokenId ?? process.env.MODAL_TOKEN_ID ?? "",
      tokenSecret: config.tokenSecret ?? process.env.MODAL_TOKEN_SECRET ?? "",
      appName: config.appName ?? process.env.MODAL_APP_NAME ?? "opencode-sandbox",
      defaultCpu: config.defaultCpu ?? 4,
      defaultMemory: config.defaultMemory ?? 8192,
      defaultTimeout: config.defaultTimeout ?? 3600,
      apiBaseUrl: config.apiBaseUrl ?? "https://api.modal.com/v1",
    }

    // Build authentication headers
    this.headers = {
      "Content-Type": "application/json",
    }

    if (this.config.tokenId && this.config.tokenSecret) {
      const credentials = Buffer.from(`${this.config.tokenId}:${this.config.tokenSecret}`).toString("base64")
      this.headers["Authorization"] = `Basic ${credentials}`
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${++this.idCounter}`
  }

  /**
   * Create a new sandbox on Modal
   */
  async create(rawInput: Sandbox.CreateInput): Promise<Sandbox.Info> {
    const input = Sandbox.CreateInput.parse(rawInput)
    const id = this.generateId("modal-sandbox")
    const now = Date.now()

    // Create sandbox record
    const sandbox: ModalSandbox = {
      id,
      modalSandboxId: undefined, // Will be set after Modal API call
      projectID: input.projectID,
      status: "initializing",
      git: {
        repo: input.repository,
        branch: input.branch,
        commit: "",
        syncStatus: "pending",
      },
      services: input.services.map((name) => ({
        name,
        status: "stopped" as const,
      })),
      imageTag: input.imageTag ?? "latest",
      resources: input.resources ?? { cpu: this.config.defaultCpu, memory: this.config.defaultMemory, disk: 20 },
      created: now,
      lastActivity: now,
    }

    this.sandboxes.set(id, sandbox)

    // Start Modal sandbox in background
    this.startModalSandbox(sandbox, input).catch((err) => {
      console.error(`[modal] Failed to start sandbox ${id}:`, err)
      sandbox.status = "terminated"
    })

    return this.toInfo(sandbox)
  }

  /**
   * Start a Modal sandbox container
   */
  private async startModalSandbox(sandbox: ModalSandbox, input: Sandbox.CreateInputParsed): Promise<void> {
    try {
      // Call Modal API to create sandbox
      const response = await this.callModalApi("sandbox.create", {
        app_name: this.config.appName,
        image_tag: sandbox.imageTag,
        cpu: sandbox.resources.cpu,
        memory: sandbox.resources.memory,
        timeout: this.config.defaultTimeout,
        environment: {
          REPOSITORY: input.repository,
          BRANCH: input.branch,
          PROJECT_ID: input.projectID,
        },
        mounts: [],
        services: input.services,
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Modal API error: ${response.status} - ${error}`)
      }

      const result = await response.json()
      sandbox.modalSandboxId = result.sandbox_id

      // Wait for sandbox to be ready
      await this.waitForSandboxReady(sandbox.id)

      // Start git sync
      await this.syncGit(sandbox.id)

      sandbox.status = "ready"
    } catch (err) {
      sandbox.status = "terminated"
      throw err
    }
  }

  /**
   * Wait for sandbox to reach ready state
   */
  private async waitForSandboxReady(sandboxId: string, timeoutMs: number = 120000): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId)
    if (!sandbox?.modalSandboxId) return

    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      const response = await this.callModalApi("sandbox.status", {
        sandbox_id: sandbox.modalSandboxId,
      })

      if (response.ok) {
        const result = await response.json()
        if (result.status === "running") {
          return
        }
        if (result.status === "failed") {
          throw new Error(`Sandbox failed to start: ${result.error}`)
        }
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    throw new Error(`Sandbox startup timeout after ${timeoutMs}ms`)
  }

  async get(sandboxID: string): Promise<Sandbox.Info | undefined> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) return undefined

    // Optionally refresh status from Modal API
    if (sandbox.modalSandboxId && sandbox.status !== "terminated") {
      try {
        const response = await this.callModalApi("sandbox.status", {
          sandbox_id: sandbox.modalSandboxId,
        })
        if (response.ok) {
          const result = await response.json()
          sandbox.status = this.mapModalStatus(result.status)
        }
      } catch {
        // Ignore refresh errors, return cached state
      }
    }

    return this.toInfo(sandbox)
  }

  async list(projectID?: string): Promise<Sandbox.Info[]> {
    const all = Array.from(this.sandboxes.values())
    const filtered = projectID ? all.filter((s) => s.projectID === projectID) : all
    return filtered.map((s) => this.toInfo(s))
  }

  async start(sandboxID: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)
    if (sandbox.status === "terminated") throw new Error("Cannot start terminated sandbox")

    if (sandbox.modalSandboxId) {
      const response = await this.callModalApi("sandbox.start", {
        sandbox_id: sandbox.modalSandboxId,
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Failed to start sandbox: ${error}`)
      }
    }

    sandbox.status = "running"
    sandbox.lastActivity = Date.now()
  }

  async stop(sandboxID: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)

    if (sandbox.modalSandboxId) {
      const response = await this.callModalApi("sandbox.stop", {
        sandbox_id: sandbox.modalSandboxId,
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Failed to stop sandbox: ${error}`)
      }
    }

    sandbox.status = "suspended"
    sandbox.lastActivity = Date.now()
  }

  async terminate(sandboxID: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)

    if (sandbox.modalSandboxId) {
      await this.callModalApi("sandbox.terminate", {
        sandbox_id: sandbox.modalSandboxId,
      }).catch((err) => {
        console.error(`[modal] Failed to terminate sandbox ${sandboxID}:`, err)
      })
    }

    sandbox.status = "terminated"
    this.sandboxes.delete(sandboxID)
  }

  async snapshot(sandboxID: string): Promise<string> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)
    if (!sandbox.modalSandboxId) throw new Error("Sandbox not yet started on Modal")

    const response = await this.callModalApi("sandbox.snapshot", {
      sandbox_id: sandbox.modalSandboxId,
      include_paths: ["/workspace", "/home", "/tmp/caches"],
      exclude_paths: ["/workspace/node_modules/.cache", "/workspace/.git/objects"],
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to create snapshot: ${error}`)
    }

    const result = await response.json()
    const snapshotID = this.generateId("snapshot")

    this.snapshots.set(snapshotID, {
      id: snapshotID,
      modalSnapshotId: result.snapshot_id,
      sandboxID,
      git: { ...sandbox.git },
      imageTag: sandbox.imageTag,
      resources: { ...sandbox.resources },
      createdAt: Date.now(),
    })

    return snapshotID
  }

  async restore(snapshotID: string): Promise<Sandbox.Info> {
    const snapshot = this.snapshots.get(snapshotID)
    if (!snapshot) throw new Error(`Snapshot not found: ${snapshotID}`)

    const response = await this.callModalApi("sandbox.restore", {
      snapshot_id: snapshot.modalSnapshotId,
      cpu: snapshot.resources.cpu,
      memory: snapshot.resources.memory,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to restore snapshot: ${error}`)
    }

    const result = await response.json()
    const id = this.generateId("modal-sandbox")
    const now = Date.now()

    const sandbox: ModalSandbox = {
      id,
      modalSandboxId: result.sandbox_id,
      projectID: "",
      status: "ready",
      git: { ...snapshot.git },
      services: [],
      imageTag: snapshot.imageTag,
      resources: { ...snapshot.resources },
      created: now,
      lastActivity: now,
    }

    this.sandboxes.set(id, sandbox)
    return this.toInfo(sandbox)
  }

  async execute(sandboxID: string, command: string[], options?: ExecuteOptions): Promise<Sandbox.ExecuteResult> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)
    if (!sandbox.modalSandboxId) throw new Error("Sandbox not yet started on Modal")

    sandbox.lastActivity = Date.now()
    const startTime = Date.now()

    const response = await this.callModalApi("sandbox.exec", {
      sandbox_id: sandbox.modalSandboxId,
      command,
      cwd: options?.cwd ?? "/workspace",
      env: options?.env ?? {},
      timeout: options?.timeout ?? 60000,
    })

    if (!response.ok) {
      const error = await response.text()
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Modal API error: ${error}`,
        duration: Date.now() - startTime,
      }
    }

    const result = await response.json()
    return {
      exitCode: result.exit_code ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      duration: Date.now() - startTime,
    }
  }

  async *streamLogs(sandboxID: string, service: string): AsyncIterable<string> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)
    if (!sandbox.modalSandboxId) {
      yield `[${service}] Sandbox not yet started\n`
      return
    }

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/sandbox/logs`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          sandbox_id: sandbox.modalSandboxId,
          service,
          follow: true,
        }),
      })

      if (!response.ok || !response.body) {
        yield `[${service}] Failed to stream logs: ${response.status}\n`
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        yield decoder.decode(value, { stream: true })
      }
    } catch (err) {
      yield `[${service}] Log stream error: ${err}\n`
    }
  }

  async syncGit(sandboxID: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)

    if (sandbox.git.syncStatus === "syncing") return
    sandbox.git.syncStatus = "syncing"

    try {
      // Clone or pull repository
      const cloneResult = await this.execute(sandboxID, [
        "sh",
        "-c",
        `
          if [ -d /workspace/.git ]; then
            cd /workspace && git fetch origin && git reset --hard origin/${sandbox.git.branch}
          else
            git clone --branch ${sandbox.git.branch} --single-branch ${sandbox.git.repo} /workspace
          fi
        `,
      ])

      if (cloneResult.exitCode !== 0) {
        throw new Error(`Git sync failed: ${cloneResult.stderr}`)
      }

      // Get current commit
      const commitResult = await this.execute(sandboxID, ["git", "-C", "/workspace", "rev-parse", "HEAD"])
      sandbox.git.commit = commitResult.stdout.trim()
      sandbox.git.syncStatus = "synced"
      sandbox.git.syncedAt = Date.now()
    } catch {
      sandbox.git.syncStatus = "error"
    }
  }

  async getGitStatus(sandboxID: string): Promise<Sandbox.Git> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)
    return sandbox.git
  }

  /**
   * Make a call to the Modal API
   */
  private async callModalApi(method: string, params: Record<string, unknown>): Promise<Response> {
    const url = `${this.config.apiBaseUrl}/${method.replace(".", "/")}`

    return fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(params),
    })
  }

  /**
   * Map Modal status to Sandbox status
   */
  private mapModalStatus(modalStatus: string): Sandbox.Status {
    switch (modalStatus) {
      case "pending":
      case "starting":
        return "initializing"
      case "running":
        return "running"
      case "stopped":
      case "suspended":
        return "suspended"
      case "terminated":
      case "failed":
        return "terminated"
      default:
        return "ready"
    }
  }

  private toInfo(sandbox: ModalSandbox): Sandbox.Info {
    return {
      id: sandbox.id,
      projectID: sandbox.projectID,
      status: sandbox.status,
      provider: "modal",
      image: {
        id: sandbox.modalSandboxId ?? "pending",
        tag: sandbox.imageTag,
        digest: sandbox.modalSandboxId ?? "pending",
        builtAt: sandbox.created,
      },
      git: sandbox.git,
      services: sandbox.services,
      network: {
        internalIP: "10.0.0.1",
        ports: {},
        publicURL: sandbox.modalSandboxId
          ? `https://${this.config.appName}--${sandbox.modalSandboxId}.modal.run`
          : undefined,
      },
      time: {
        created: sandbox.created,
        ready: sandbox.status !== "initializing" ? sandbox.created : undefined,
        lastActivity: sandbox.lastActivity,
      },
    }
  }
}

interface ModalSandbox {
  id: string
  modalSandboxId: string | undefined
  projectID: string
  status: Sandbox.Status
  git: Sandbox.Git
  services: Sandbox.Service[]
  imageTag: string
  resources: { cpu: number; memory: number; disk: number }
  created: number
  lastActivity: number
}

interface ModalSnapshot {
  id: string
  modalSnapshotId: string
  sandboxID: string
  git: Sandbox.Git
  imageTag: string
  resources: { cpu: number; memory: number; disk: number }
  createdAt: number
}

import { spawn } from "child_process"
import { mkdir, rm, cp, access } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { Sandbox } from "../sandbox"
import type { Provider, ExecuteOptions } from "./index"

/**
 * Local provider for development and testing.
 *
 * This provider runs sandboxes as local processes on the host machine.
 * It's suitable for development but not for production use.
 */
export class LocalProvider implements Provider {
  readonly name = "local" as const

  private sandboxes = new Map<string, LocalSandbox>()
  private snapshots = new Map<string, LocalSnapshot>()
  private idCounter = 0

  constructor(private baseDir: string = join(tmpdir(), "opencode-sandbox")) {}

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${++this.idCounter}`
  }

  async create(rawInput: Sandbox.CreateInput): Promise<Sandbox.Info> {
    // Parse input to apply defaults
    const input = Sandbox.CreateInput.parse(rawInput)

    const id = this.generateId("sandbox")
    const workdir = join(this.baseDir, id)
    await mkdir(workdir, { recursive: true })

    const now = Date.now()
    const sandbox: LocalSandbox = {
      id,
      projectID: input.projectID,
      workdir,
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
      created: now,
      lastActivity: now,
    }

    this.sandboxes.set(id, sandbox)

    // Clone repository in background
    this.cloneRepository(sandbox, input.repository, input.branch).catch((err) => {
      sandbox.git.syncStatus = "error"
      console.error(`Failed to clone repository: ${err}`)
    })

    return this.toInfo(sandbox)
  }

  async get(sandboxID: string): Promise<Sandbox.Info | undefined> {
    const sandbox = this.sandboxes.get(sandboxID)
    return sandbox ? this.toInfo(sandbox) : undefined
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

    sandbox.status = "running"
    sandbox.lastActivity = Date.now()
  }

  async stop(sandboxID: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)

    sandbox.status = "suspended"
    sandbox.lastActivity = Date.now()
  }

  async terminate(sandboxID: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)

    sandbox.status = "terminated"

    // Cleanup workdir
    await rm(sandbox.workdir, { recursive: true, force: true })
  }

  async snapshot(sandboxID: string): Promise<string> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)

    const snapshotID = this.generateId("snapshot")
    const snapshotDir = join(this.baseDir, "snapshots", snapshotID)
    await mkdir(snapshotDir, { recursive: true })

    // Copy workdir to snapshot
    await cp(sandbox.workdir, snapshotDir, { recursive: true })

    this.snapshots.set(snapshotID, {
      id: snapshotID,
      sandboxID,
      dir: snapshotDir,
      git: { ...sandbox.git },
      imageTag: sandbox.imageTag,
      createdAt: Date.now(),
    })

    return snapshotID
  }

  async restore(snapshotID: string): Promise<Sandbox.Info> {
    const snapshot = this.snapshots.get(snapshotID)
    if (!snapshot) throw new Error(`Snapshot not found: ${snapshotID}`)

    const id = this.generateId("sandbox")
    const workdir = join(this.baseDir, id)
    await mkdir(workdir, { recursive: true })

    // Copy snapshot to new workdir
    await cp(snapshot.dir, workdir, { recursive: true })

    const now = Date.now()
    const sandbox: LocalSandbox = {
      id,
      projectID: "",
      workdir,
      status: "ready",
      git: { ...snapshot.git },
      services: [],
      imageTag: snapshot.imageTag,
      created: now,
      lastActivity: now,
    }

    this.sandboxes.set(id, sandbox)
    return this.toInfo(sandbox)
  }

  async execute(sandboxID: string, command: string[], options?: ExecuteOptions): Promise<Sandbox.ExecuteResult> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)

    sandbox.lastActivity = Date.now()
    const startTime = Date.now()

    return new Promise((resolve) => {
      const proc = spawn(command[0], command.slice(1), {
        cwd: options?.cwd ?? sandbox.workdir,
        env: { ...process.env, ...options?.env },
        timeout: options?.timeout,
      })

      let stdout = ""
      let stderr = ""

      proc.stdout?.on("data", (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on("data", (data) => {
        stderr += data.toString()
      })

      proc.on("close", (code) => {
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
          duration: Date.now() - startTime,
        })
      })

      proc.on("error", (err) => {
        resolve({
          exitCode: 1,
          stdout,
          stderr: err.message,
          duration: Date.now() - startTime,
        })
      })
    })
  }

  async *streamLogs(sandboxID: string, service: string): AsyncIterable<string> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)

    // Local provider doesn't support log streaming yet
    yield `[${service}] Log streaming not implemented for local provider\n`
  }

  async syncGit(sandboxID: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxID)
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxID}`)

    if (sandbox.git.syncStatus === "syncing") return

    sandbox.git.syncStatus = "syncing"

    try {
      // Pull latest changes
      const result = await this.execute(sandboxID, ["git", "pull", "--ff-only"])
      if (result.exitCode !== 0) {
        throw new Error(`Git pull failed: ${result.stderr}`)
      }

      // Get current commit
      const commitResult = await this.execute(sandboxID, ["git", "rev-parse", "HEAD"])
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

  private async cloneRepository(sandbox: LocalSandbox, repo: string, branch: string): Promise<void> {
    // Helper to check if sandbox was terminated (may happen concurrently)
    const isTerminated = () => sandbox.status === ("terminated" as Sandbox.Status)

    // Don't modify terminated sandboxes
    if (isTerminated()) return

    sandbox.git.syncStatus = "syncing"

    try {
      // Check if workdir exists and has content
      try {
        await access(join(sandbox.workdir, ".git"))
        // Already cloned, just pull
        await this.syncGit(sandbox.id)
        return
      } catch {
        // Not cloned yet, proceed with clone
      }

      // Don't proceed if sandbox was terminated during check
      if (isTerminated()) return

      const result = await this.execute(sandbox.id, ["git", "clone", "--branch", branch, "--single-branch", repo, "."])

      if (result.exitCode !== 0) {
        throw new Error(`Clone failed: ${result.stderr}`)
      }

      // Don't update status if sandbox was terminated during clone
      if (isTerminated()) return

      // Get commit hash
      const commitResult = await this.execute(sandbox.id, ["git", "rev-parse", "HEAD"])
      sandbox.git.commit = commitResult.stdout.trim()
      sandbox.git.syncStatus = "synced"
      sandbox.git.syncedAt = Date.now()
      sandbox.status = "ready"
    } catch {
      // Don't update status if sandbox was terminated
      if (isTerminated()) return
      sandbox.git.syncStatus = "error"
      sandbox.status = "ready" // Still usable, just without git
    }
  }

  private toInfo(sandbox: LocalSandbox): Sandbox.Info {
    return {
      id: sandbox.id,
      projectID: sandbox.projectID,
      status: sandbox.status,
      provider: "local",
      image: {
        id: "local",
        tag: sandbox.imageTag,
        digest: "local",
        builtAt: sandbox.created,
      },
      git: sandbox.git,
      services: sandbox.services,
      network: {
        internalIP: "127.0.0.1",
        ports: {},
      },
      time: {
        created: sandbox.created,
        ready: sandbox.status !== "initializing" ? sandbox.created : undefined,
        lastActivity: sandbox.lastActivity,
      },
    }
  }
}

interface LocalSandbox {
  id: string
  projectID: string
  workdir: string
  status: Sandbox.Status
  git: Sandbox.Git
  services: Sandbox.Service[]
  imageTag: string
  created: number
  lastActivity: number
}

interface LocalSnapshot {
  id: string
  sandboxID: string
  dir: string
  git: Sandbox.Git
  imageTag: string
  createdAt: number
}

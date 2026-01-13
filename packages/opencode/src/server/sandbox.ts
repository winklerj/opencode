import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { SandboxService } from "../sandbox/service"
import { Sandbox } from "@opencode-ai/sandbox"
import z from "zod"
import { errors } from "./error"

/**
 * Sandbox API Routes
 *
 * Implements the Sandbox API from the specification:
 * - POST   /sandbox              Create sandbox
 * - GET    /sandbox/:id          Get sandbox info
 * - GET    /sandbox              List sandboxes
 * - POST   /sandbox/:id/start    Start sandbox
 * - POST   /sandbox/:id/stop     Stop sandbox
 * - POST   /sandbox/:id/terminate Terminate sandbox
 * - POST   /sandbox/:id/snapshot Create snapshot
 * - POST   /sandbox/restore      Restore from snapshot
 * - POST   /sandbox/:id/exec     Execute command
 * - GET    /sandbox/:id/logs/:service Stream logs (SSE)
 * - GET    /sandbox/:id/git      Git sync status
 * - POST   /sandbox/:id/git/sync Force git sync
 */
export const SandboxRoute = new Hono()
  // POST /sandbox - Create a new sandbox
  .post(
    "/",
    describeRoute({
      summary: "Create sandbox",
      description: "Create a new sandbox for code execution.",
      operationId: "sandbox.create",
      responses: {
        200: {
          description: "Sandbox created successfully",
          content: {
            "application/json": {
              schema: resolver(Sandbox.Info),
            },
          },
        },
        ...errors(400, 500),
      },
    }),
    validator("json", Sandbox.CreateInput),
    async (c) => {
      const body = c.req.valid("json")
      const sandbox = await SandboxService.create(body)
      return c.json(sandbox)
    },
  )
  // GET /sandbox - List all sandboxes
  .get(
    "/",
    describeRoute({
      summary: "List sandboxes",
      description: "Get a list of all sandboxes, optionally filtered by project.",
      operationId: "sandbox.list",
      responses: {
        200: {
          description: "List of sandboxes",
          content: {
            "application/json": {
              schema: resolver(Sandbox.Info.array()),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        projectID: z.string().optional().describe("Filter by project ID"),
      }),
    ),
    async (c) => {
      const { projectID } = c.req.valid("query")
      const sandboxes = await SandboxService.list(projectID)
      return c.json(sandboxes)
    },
  )
  // GET /sandbox/:id - Get sandbox info
  .get(
    "/:id",
    describeRoute({
      summary: "Get sandbox",
      description: "Get details of a specific sandbox.",
      operationId: "sandbox.get",
      responses: {
        200: {
          description: "Sandbox information",
          content: {
            "application/json": {
              schema: resolver(Sandbox.Info),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")
      const sandbox = await SandboxService.get(id)

      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      return c.json(sandbox)
    },
  )
  // POST /sandbox/:id/start - Start a sandbox
  .post(
    "/:id/start",
    describeRoute({
      summary: "Start sandbox",
      description: "Start a stopped or suspended sandbox.",
      operationId: "sandbox.start",
      responses: {
        200: {
          description: "Sandbox started",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")

      const sandbox = await SandboxService.get(id)
      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      await SandboxService.start(id)
      return c.json({ success: true })
    },
  )
  // POST /sandbox/:id/stop - Stop a sandbox
  .post(
    "/:id/stop",
    describeRoute({
      summary: "Stop sandbox",
      description: "Stop a running sandbox (can be restarted).",
      operationId: "sandbox.stop",
      responses: {
        200: {
          description: "Sandbox stopped",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")

      const sandbox = await SandboxService.get(id)
      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      await SandboxService.stop(id)
      return c.json({ success: true })
    },
  )
  // POST /sandbox/:id/terminate - Terminate a sandbox
  .post(
    "/:id/terminate",
    describeRoute({
      summary: "Terminate sandbox",
      description: "Terminate a sandbox permanently.",
      operationId: "sandbox.terminate",
      responses: {
        200: {
          description: "Sandbox terminated",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")

      const sandbox = await SandboxService.get(id)
      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      await SandboxService.terminate(id)
      return c.json({ success: true })
    },
  )
  // POST /sandbox/:id/snapshot - Create a snapshot
  .post(
    "/:id/snapshot",
    describeRoute({
      summary: "Create snapshot",
      description: "Create a snapshot of the sandbox for later restoration.",
      operationId: "sandbox.snapshot",
      responses: {
        200: {
          description: "Snapshot created",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  snapshotID: z.string(),
                  createdAt: z.number(),
                }),
              ),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    validator(
      "json",
      z.object({
        sessionID: z.string().describe("Session ID that owns this sandbox"),
        gitCommit: z.string().describe("Current git commit hash"),
        hasUncommittedChanges: z.boolean().optional().describe("Whether there are uncommitted changes"),
      }),
    ),
    async (c) => {
      const { id } = c.req.valid("param")
      const { sessionID, gitCommit, hasUncommittedChanges } = c.req.valid("json")

      const sandbox = await SandboxService.get(id)
      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      const snapshot = await SandboxService.createSnapshot(id, sessionID, gitCommit, hasUncommittedChanges)
      if (!snapshot) {
        return c.json({ error: "Failed to create snapshot" }, 400)
      }
      return c.json({ snapshotID: snapshot.id, createdAt: snapshot.createdAt })
    },
  )
  // POST /sandbox/restore - Restore from snapshot
  .post(
    "/restore",
    describeRoute({
      summary: "Restore from snapshot",
      description: "Restore a sandbox from the latest snapshot for a session.",
      operationId: "sandbox.restore",
      responses: {
        200: {
          description: "Sandbox restored",
          content: {
            "application/json": {
              schema: resolver(Sandbox.Info),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "json",
      z.object({
        sessionID: z.string().describe("Session ID to restore snapshot for"),
      }),
    ),
    async (c) => {
      const { sessionID } = c.req.valid("json")

      const sandbox = await SandboxService.restoreSnapshot(sessionID)
      if (!sandbox) {
        return c.json({ error: "No valid snapshot found for session" }, 404)
      }
      return c.json(sandbox)
    },
  )
  // GET /sandbox/snapshots - List all snapshots
  .get(
    "/snapshots",
    describeRoute({
      summary: "List snapshots",
      description: "Get a list of all sandbox snapshots.",
      operationId: "sandbox.listSnapshots",
      responses: {
        200: {
          description: "List of snapshots",
          content: {
            "application/json": {
              schema: resolver(
                z.array(
                  z.object({
                    id: z.string(),
                    sandboxID: z.string(),
                    expiresAt: z.number(),
                  }),
                ),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const snapshots = await SandboxService.listSnapshots()
      return c.json(snapshots)
    },
  )
  // DELETE /sandbox/snapshots/:id - Delete a snapshot
  .delete(
    "/snapshots/:id",
    describeRoute({
      summary: "Delete snapshot",
      description: "Delete a sandbox snapshot.",
      operationId: "sandbox.deleteSnapshot",
      responses: {
        200: {
          description: "Snapshot deleted",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")
      const success = await SandboxService.deleteSnapshot(id)

      if (!success) {
        return c.json({ error: "Snapshot not found" }, 404)
      }

      return c.json({ success: true })
    },
  )
  // POST /sandbox/:id/exec - Execute a command
  .post(
    "/:id/exec",
    describeRoute({
      summary: "Execute command",
      description: "Execute a command in the sandbox.",
      operationId: "sandbox.exec",
      responses: {
        200: {
          description: "Command result",
          content: {
            "application/json": {
              schema: resolver(Sandbox.ExecuteResult),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    validator(
      "json",
      z.object({
        command: z.array(z.string()).describe("Command and arguments"),
        cwd: z.string().optional().describe("Working directory"),
        env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
        timeout: z.number().optional().describe("Timeout in milliseconds"),
      }),
    ),
    async (c) => {
      const { id } = c.req.valid("param")
      const { command, cwd, env, timeout } = c.req.valid("json")

      const sandbox = await SandboxService.get(id)
      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      const result = await SandboxService.execute(id, command, { cwd, env, timeout })
      return c.json(result)
    },
  )
  // GET /sandbox/:id/logs/:service - Stream logs
  .get(
    "/:id/logs/:service",
    describeRoute({
      summary: "Stream logs",
      description: "Stream logs from a service running in the sandbox.",
      operationId: "sandbox.logs",
      responses: {
        200: {
          description: "Log stream",
          content: {
            "text/event-stream": {
              schema: resolver(
                z.object({
                  type: z.literal("log"),
                  data: z.string(),
                }),
              ),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string(), service: z.string() })),
    async (c) => {
      const { id, service } = c.req.valid("param")

      const sandbox = await SandboxService.get(id)
      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      return streamSSE(c, async (stream) => {
        try {
          for await (const line of SandboxService.streamLogs(id, service)) {
            await stream.writeSSE({
              event: "log",
              data: JSON.stringify({ type: "log", data: line }),
            })
          }
        } catch {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ type: "error", message: "Log stream ended" }),
          })
        }
      })
    },
  )
  // GET /sandbox/:id/git - Get git status
  .get(
    "/:id/git",
    describeRoute({
      summary: "Get git status",
      description: "Get the git synchronization status of the sandbox.",
      operationId: "sandbox.gitStatus",
      responses: {
        200: {
          description: "Git status",
          content: {
            "application/json": {
              schema: resolver(Sandbox.Git),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")

      const sandbox = await SandboxService.get(id)
      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      const git = await SandboxService.getGitStatus(id)
      return c.json(git)
    },
  )
  // POST /sandbox/:id/git/sync - Force git sync
  .post(
    "/:id/git/sync",
    describeRoute({
      summary: "Force git sync",
      description: "Force a git synchronization in the sandbox.",
      operationId: "sandbox.gitSync",
      responses: {
        200: {
          description: "Git sync triggered",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ id: z.string() })),
    async (c) => {
      const { id } = c.req.valid("param")

      const sandbox = await SandboxService.get(id)
      if (!sandbox) {
        return c.json({ error: "Sandbox not found" }, 404)
      }

      await SandboxService.syncGit(id)
      return c.json({ success: true })
    },
  )
  // GET /sandbox/pool/stats - Get warm pool statistics
  .get(
    "/pool/stats",
    describeRoute({
      summary: "Get warm pool stats",
      description: "Get statistics about the warm pool.",
      operationId: "sandbox.poolStats",
      responses: {
        200: {
          description: "Pool statistics",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  available: z.number(),
                  total: z.number(),
                  warming: z.number(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const stats = await SandboxService.poolStats()
      return c.json(stats)
    },
  )
  // POST /sandbox/pool/claim - Claim from warm pool
  .post(
    "/pool/claim",
    describeRoute({
      summary: "Claim from warm pool",
      description: "Claim a pre-warmed sandbox from the pool.",
      operationId: "sandbox.poolClaim",
      responses: {
        200: {
          description: "Claimed sandbox or null if none available",
          content: {
            "application/json": {
              schema: resolver(Sandbox.Info.nullable()),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        repository: z.string().describe("Repository URL to claim sandbox for"),
        projectID: z.string().describe("Project ID to claim sandbox for"),
        imageTag: z.string().optional().describe("Optional specific image tag"),
      }),
    ),
    async (c) => {
      const { repository, projectID, imageTag } = c.req.valid("json")
      const result = await SandboxService.claimFromPool(repository, projectID, imageTag)
      return c.json(result)
    },
  )
  // POST /sandbox/pool/typing - Trigger warmup on typing
  .post(
    "/pool/typing",
    describeRoute({
      summary: "Trigger warmup",
      description: "Trigger sandbox warmup when user starts typing.",
      operationId: "sandbox.poolTyping",
      responses: {
        200: {
          description: "Warmup triggered",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        repository: z.string().describe("Repository URL to warm sandbox for"),
        projectID: z.string().describe("Project ID to warm sandbox for"),
        imageTag: z.string().optional().describe("Optional specific image tag"),
      }),
    ),
    async (c) => {
      const { repository, projectID, imageTag } = c.req.valid("json")
      await SandboxService.onTyping(repository, projectID, imageTag)
      return c.json({ success: true })
    },
  )

import { Log } from "../util/log"
import { Installation } from "../installation"
import type { Context } from "hono"

const log = Log.create({ service: "buildkite" })

export namespace Buildkite {
  export interface Config {
    /**
     * Buildkite API token with appropriate scopes
     */
    apiToken: string

    /**
     * Organization slug
     */
    organization: string

    /**
     * Optional default pipeline slug
     */
    defaultPipeline?: string

    /**
     * Whether the integration is enabled
     */
    enabled?: boolean
  }

  export type BuildState =
    | "running"
    | "scheduled"
    | "passed"
    | "failed"
    | "blocked"
    | "canceled"
    | "canceling"
    | "skipped"
    | "not_run"
    | "waiting"

  export interface Build {
    id: string
    graphql_id: string
    url: string
    web_url: string
    number: number
    state: BuildState
    blocked: boolean
    message: string
    commit: string
    branch: string
    env: Record<string, string>
    source: string
    created_at: string
    scheduled_at: string | null
    started_at: string | null
    finished_at: string | null
    meta_data: Record<string, string>
    creator: {
      id: string
      name: string
      email: string
      avatar_url: string
    } | null
    pipeline: {
      id: string
      graphql_id: string
      url: string
      web_url: string
      name: string
      slug: string
    }
    jobs: Job[]
  }

  export interface Job {
    id: string
    graphql_id: string
    type: "script" | "waiter" | "manual" | "trigger"
    name: string
    state: BuildState
    agent_query_rules: string[]
    web_url: string
    log_url: string
    raw_log_url: string
    command: string
    exit_status: number | null
    artifact_paths: string
    created_at: string
    scheduled_at: string | null
    runnable_at: string | null
    started_at: string | null
    finished_at: string | null
    retried: boolean
    retried_in_job_id: string | null
    retries_count: number
    parallel_group_index: number | null
    parallel_group_total: number | null
  }

  export interface CreateBuildInput {
    /**
     * Pipeline slug (uses defaultPipeline if not specified)
     */
    pipeline?: string

    /**
     * Commit SHA to build
     */
    commit: string

    /**
     * Branch name
     */
    branch: string

    /**
     * Build message (typically commit message)
     */
    message?: string

    /**
     * Whether to ignore pipeline steps and run all steps
     */
    ignore_pipeline_branch_filters?: boolean

    /**
     * Environment variables for the build
     */
    env?: Record<string, string>

    /**
     * Meta-data for the build
     */
    meta_data?: Record<string, string>

    /**
     * Author information
     */
    author?: {
      name: string
      email: string
    }

    /**
     * Whether to clean checkout
     */
    clean_checkout?: boolean

    /**
     * Pull request information
     */
    pull_request_id?: number
    pull_request_base_branch?: string
  }

  export interface Annotation {
    id: string
    context: string
    style: "success" | "info" | "warning" | "error"
    body_html: string
    created_at: string
    updated_at: string
  }

  export interface CreateAnnotationInput {
    /**
     * The build number
     */
    buildNumber: number

    /**
     * Pipeline slug (uses defaultPipeline if not specified)
     */
    pipeline?: string

    /**
     * Unique context identifier for the annotation
     */
    context: string

    /**
     * Annotation style
     */
    style: "success" | "info" | "warning" | "error"

    /**
     * HTML body of the annotation
     */
    body: string

    /**
     * Whether to append to existing annotation with same context
     */
    append?: boolean
  }

  export interface Agent {
    id: string
    graphql_id: string
    url: string
    web_url: string
    name: string
    connection_state: "connected" | "disconnected" | "lost" | "stopped"
    hostname: string
    ip_address: string
    user_agent: string
    version: string
    created_at: string
    job: Job | null
    last_job_finished_at: string | null
    priority: number
    meta_data: string[]
  }

  export interface ListBuildsOptions {
    pipeline?: string
    branch?: string
    commit?: string
    state?: BuildState | BuildState[]
    creator?: string
    created_from?: string
    created_to?: string
    finished_from?: string
    finished_to?: string
    include_retried_jobs?: boolean
    page?: number
    per_page?: number
  }

  const API_BASE = "https://api.buildkite.com/v2"

  let _config: Config | undefined
  let _isInitialized = false

  export function init(config: Config): void {
    if (_isInitialized) {
      log.warn("Buildkite already initialized")
      return
    }

    _config = {
      ...config,
      enabled: config.enabled ?? true,
    }

    _isInitialized = true
    log.info("Buildkite initialized", {
      organization: config.organization,
      defaultPipeline: config.defaultPipeline,
    })
  }

  export function isInitialized(): boolean {
    return _isInitialized
  }

  export function shutdown(): void {
    _isInitialized = false
    _config = undefined
    log.info("Buildkite shutdown")
  }

  function getHeaders(): Record<string, string> {
    if (!_config) {
      throw new Error("Buildkite not initialized")
    }

    return {
      Authorization: `Bearer ${_config.apiToken}`,
      "Content-Type": "application/json",
    }
  }

  function getPipelineSlug(pipeline?: string): string {
    const slug = pipeline ?? _config?.defaultPipeline
    if (!slug) {
      throw new Error("No pipeline specified and no default pipeline configured")
    }
    return slug
  }

  /**
   * Create a new build
   */
  export async function createBuild(input: CreateBuildInput): Promise<Build> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const pipeline = getPipelineSlug(input.pipeline)
    const url = `${API_BASE}/organizations/${_config.organization}/pipelines/${pipeline}/builds`

    const payload: Record<string, unknown> = {
      commit: input.commit,
      branch: input.branch,
      message: input.message ?? `Build triggered by OpenCode ${Installation.VERSION}`,
      ignore_pipeline_branch_filters: input.ignore_pipeline_branch_filters ?? false,
      clean_checkout: input.clean_checkout ?? false,
    }

    if (input.env) {
      payload.env = input.env
    }

    if (input.meta_data) {
      payload.meta_data = input.meta_data
    }

    if (input.author) {
      payload.author = input.author
    }

    if (input.pull_request_id) {
      payload.pull_request_id = input.pull_request_id
      payload.pull_request_base_branch = input.pull_request_base_branch
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      const build = (await response.json()) as Build
      log.info("Buildkite build created", {
        buildNumber: build.number,
        pipeline,
        branch: input.branch,
        commit: input.commit.slice(0, 8),
      })

      return build
    } catch (error) {
      log.error("Failed to create Buildkite build", {
        error: error instanceof Error ? error.message : String(error),
        pipeline,
        branch: input.branch,
      })
      throw error
    }
  }

  /**
   * Get a specific build
   */
  export async function getBuild(buildNumber: number, pipeline?: string): Promise<Build> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const pipelineSlug = getPipelineSlug(pipeline)
    const url = `${API_BASE}/organizations/${_config.organization}/pipelines/${pipelineSlug}/builds/${buildNumber}`

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      return (await response.json()) as Build
    } catch (error) {
      log.error("Failed to get Buildkite build", {
        error: error instanceof Error ? error.message : String(error),
        buildNumber,
        pipeline: pipelineSlug,
      })
      throw error
    }
  }

  /**
   * List builds for an organization or pipeline
   */
  export async function listBuilds(options: ListBuildsOptions = {}): Promise<Build[]> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    let url: string
    if (options.pipeline) {
      url = `${API_BASE}/organizations/${_config.organization}/pipelines/${options.pipeline}/builds`
    } else {
      url = `${API_BASE}/organizations/${_config.organization}/builds`
    }

    const params = new URLSearchParams()
    if (options.branch) params.set("branch", options.branch)
    if (options.commit) params.set("commit", options.commit)
    if (options.state) {
      if (Array.isArray(options.state)) {
        options.state.forEach((s) => params.append("state[]", s))
      } else {
        params.set("state", options.state)
      }
    }
    if (options.creator) params.set("creator", options.creator)
    if (options.created_from) params.set("created_from", options.created_from)
    if (options.created_to) params.set("created_to", options.created_to)
    if (options.finished_from) params.set("finished_from", options.finished_from)
    if (options.finished_to) params.set("finished_to", options.finished_to)
    if (options.include_retried_jobs) params.set("include_retried_jobs", "true")
    if (options.page) params.set("page", String(options.page))
    if (options.per_page) params.set("per_page", String(options.per_page))

    const queryString = params.toString()
    if (queryString) {
      url += `?${queryString}`
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      return (await response.json()) as Build[]
    } catch (error) {
      log.error("Failed to list Buildkite builds", {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Cancel a build
   */
  export async function cancelBuild(buildNumber: number, pipeline?: string): Promise<Build> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const pipelineSlug = getPipelineSlug(pipeline)
    const url = `${API_BASE}/organizations/${_config.organization}/pipelines/${pipelineSlug}/builds/${buildNumber}/cancel`

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: getHeaders(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      const build = (await response.json()) as Build
      log.info("Buildkite build cancelled", { buildNumber, pipeline: pipelineSlug })
      return build
    } catch (error) {
      log.error("Failed to cancel Buildkite build", {
        error: error instanceof Error ? error.message : String(error),
        buildNumber,
        pipeline: pipelineSlug,
      })
      throw error
    }
  }

  /**
   * Rebuild a build (create a new build with the same parameters)
   */
  export async function rebuildBuild(buildNumber: number, pipeline?: string): Promise<Build> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const pipelineSlug = getPipelineSlug(pipeline)
    const url = `${API_BASE}/organizations/${_config.organization}/pipelines/${pipelineSlug}/builds/${buildNumber}/rebuild`

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: getHeaders(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      const build = (await response.json()) as Build
      log.info("Buildkite build rebuilt", {
        originalBuild: buildNumber,
        newBuild: build.number,
        pipeline: pipelineSlug,
      })
      return build
    } catch (error) {
      log.error("Failed to rebuild Buildkite build", {
        error: error instanceof Error ? error.message : String(error),
        buildNumber,
        pipeline: pipelineSlug,
      })
      throw error
    }
  }

  /**
   * Create or update an annotation on a build
   */
  export async function createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const pipelineSlug = getPipelineSlug(input.pipeline)
    const url = `${API_BASE}/organizations/${_config.organization}/pipelines/${pipelineSlug}/builds/${input.buildNumber}/annotations`

    const payload = {
      context: input.context,
      style: input.style,
      body: input.body,
      append: input.append ?? false,
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      const annotation = (await response.json()) as Annotation
      log.info("Buildkite annotation created", {
        buildNumber: input.buildNumber,
        context: input.context,
        style: input.style,
      })
      return annotation
    } catch (error) {
      log.error("Failed to create Buildkite annotation", {
        error: error instanceof Error ? error.message : String(error),
        buildNumber: input.buildNumber,
        context: input.context,
      })
      throw error
    }
  }

  /**
   * List annotations on a build
   */
  export async function listAnnotations(buildNumber: number, pipeline?: string): Promise<Annotation[]> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const pipelineSlug = getPipelineSlug(pipeline)
    const url = `${API_BASE}/organizations/${_config.organization}/pipelines/${pipelineSlug}/builds/${buildNumber}/annotations`

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      return (await response.json()) as Annotation[]
    } catch (error) {
      log.error("Failed to list Buildkite annotations", {
        error: error instanceof Error ? error.message : String(error),
        buildNumber,
      })
      throw error
    }
  }

  /**
   * Delete an annotation
   */
  export async function deleteAnnotation(
    buildNumber: number,
    context: string,
    pipeline?: string
  ): Promise<void> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const pipelineSlug = getPipelineSlug(pipeline)
    const url = `${API_BASE}/organizations/${_config.organization}/pipelines/${pipelineSlug}/builds/${buildNumber}/annotations/${encodeURIComponent(context)}`

    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: getHeaders(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      log.info("Buildkite annotation deleted", { buildNumber, context })
    } catch (error) {
      log.error("Failed to delete Buildkite annotation", {
        error: error instanceof Error ? error.message : String(error),
        buildNumber,
        context,
      })
      throw error
    }
  }

  /**
   * List agents in the organization
   */
  export async function listAgents(page?: number, perPage?: number): Promise<Agent[]> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    let url = `${API_BASE}/organizations/${_config.organization}/agents`
    const params = new URLSearchParams()
    if (page) params.set("page", String(page))
    if (perPage) params.set("per_page", String(perPage))

    const queryString = params.toString()
    if (queryString) {
      url += `?${queryString}`
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      return (await response.json()) as Agent[]
    } catch (error) {
      log.error("Failed to list Buildkite agents", {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Get a specific agent
   */
  export async function getAgent(agentId: string): Promise<Agent> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const url = `${API_BASE}/organizations/${_config.organization}/agents/${agentId}`

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: getHeaders(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      return (await response.json()) as Agent
    } catch (error) {
      log.error("Failed to get Buildkite agent", {
        error: error instanceof Error ? error.message : String(error),
        agentId,
      })
      throw error
    }
  }

  /**
   * Stop a connected agent
   */
  export async function stopAgent(agentId: string, force?: boolean): Promise<void> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const url = `${API_BASE}/organizations/${_config.organization}/agents/${agentId}/stop`

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ force: force ?? false }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      log.info("Buildkite agent stopped", { agentId, force })
    } catch (error) {
      log.error("Failed to stop Buildkite agent", {
        error: error instanceof Error ? error.message : String(error),
        agentId,
      })
      throw error
    }
  }

  /**
   * Get job logs
   */
  export async function getJobLog(
    buildNumber: number,
    jobId: string,
    pipeline?: string
  ): Promise<string> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const pipelineSlug = getPipelineSlug(pipeline)
    const url = `${API_BASE}/organizations/${_config.organization}/pipelines/${pipelineSlug}/builds/${buildNumber}/jobs/${jobId}/log`

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          ...getHeaders(),
          Accept: "text/plain",
        },
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      return await response.text()
    } catch (error) {
      log.error("Failed to get Buildkite job log", {
        error: error instanceof Error ? error.message : String(error),
        buildNumber,
        jobId,
      })
      throw error
    }
  }

  /**
   * Retry a job
   */
  export async function retryJob(
    buildNumber: number,
    jobId: string,
    pipeline?: string
  ): Promise<Job> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const pipelineSlug = getPipelineSlug(pipeline)
    const url = `${API_BASE}/organizations/${_config.organization}/pipelines/${pipelineSlug}/builds/${buildNumber}/jobs/${jobId}/retry`

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: getHeaders(),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      const job = (await response.json()) as Job
      log.info("Buildkite job retried", { buildNumber, jobId, newJobId: job.id })
      return job
    } catch (error) {
      log.error("Failed to retry Buildkite job", {
        error: error instanceof Error ? error.message : String(error),
        buildNumber,
        jobId,
      })
      throw error
    }
  }

  /**
   * Unblock a blocked build
   */
  export async function unblockJob(
    buildNumber: number,
    jobId: string,
    pipeline?: string,
    fields?: Record<string, string>,
    unblocker?: { name: string; email: string }
  ): Promise<Job> {
    if (!_isInitialized || !_config?.enabled) {
      throw new Error("Buildkite not initialized or disabled")
    }

    const pipelineSlug = getPipelineSlug(pipeline)
    const url = `${API_BASE}/organizations/${_config.organization}/pipelines/${pipelineSlug}/builds/${buildNumber}/jobs/${jobId}/unblock`

    const payload: Record<string, unknown> = {}
    if (fields) {
      payload.fields = fields
    }
    if (unblocker) {
      payload.unblocker = unblocker
    }

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Buildkite API error: ${response.status} ${text}`)
      }

      const job = (await response.json()) as Job
      log.info("Buildkite job unblocked", { buildNumber, jobId })
      return job
    } catch (error) {
      log.error("Failed to unblock Buildkite job", {
        error: error instanceof Error ? error.message : String(error),
        buildNumber,
        jobId,
      })
      throw error
    }
  }

  /**
   * Wait for a build to complete with polling
   */
  export async function waitForBuild(
    buildNumber: number,
    pipeline?: string,
    options?: {
      pollIntervalMs?: number
      timeoutMs?: number
      onPoll?: (build: Build) => void
    }
  ): Promise<Build> {
    const pollInterval = options?.pollIntervalMs ?? 5000
    const timeout = options?.timeoutMs ?? 30 * 60 * 1000 // 30 minutes default

    const startTime = Date.now()
    const terminalStates: BuildState[] = ["passed", "failed", "canceled", "skipped", "not_run"]

    while (Date.now() - startTime < timeout) {
      const build = await getBuild(buildNumber, pipeline)

      if (options?.onPoll) {
        options.onPoll(build)
      }

      if (terminalStates.includes(build.state)) {
        return build
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    throw new Error(`Build ${buildNumber} did not complete within ${timeout}ms`)
  }

  /**
   * Create an annotation reporting OpenCode agent results
   */
  export async function annotateAgentResult(
    buildNumber: number,
    result: {
      success: boolean
      summary: string
      details?: string
      artifacts?: string[]
    },
    pipeline?: string
  ): Promise<Annotation> {
    const style = result.success ? "success" : "error"
    const icon = result.success ? "&#10003;" : "&#10007;"

    let body = `<h3>${icon} OpenCode Agent</h3><p>${escapeHtml(result.summary)}</p>`

    if (result.details) {
      body += `<details><summary>Details</summary><pre>${escapeHtml(result.details)}</pre></details>`
    }

    if (result.artifacts && result.artifacts.length > 0) {
      body += `<h4>Artifacts</h4><ul>${result.artifacts.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`
    }

    return createAnnotation({
      buildNumber,
      pipeline,
      context: "opencode-agent",
      style,
      body,
    })
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
  }

  /**
   * Hono middleware for tracking builds triggered via HTTP
   */
  export function honoMiddleware() {
    return async (c: Context, next: () => Promise<void>) => {
      const startTime = Date.now()

      await next()

      // Log any build-related requests
      if (c.req.path.includes("/buildkite/")) {
        log.info("Buildkite request completed", {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          duration: Date.now() - startTime,
        })
      }
    }
  }

  /**
   * Helper functions for common CI/CD patterns
   */
  export const CI = {
    /**
     * Trigger a build and wait for it to complete
     */
    async triggerAndWait(
      input: CreateBuildInput,
      options?: {
        pollIntervalMs?: number
        timeoutMs?: number
        onProgress?: (build: Build) => void
      }
    ): Promise<Build> {
      const build = await createBuild(input)
      return waitForBuild(build.number, input.pipeline, {
        pollIntervalMs: options?.pollIntervalMs,
        timeoutMs: options?.timeoutMs,
        onPoll: options?.onProgress,
      })
    },

    /**
     * Get the latest build for a branch
     */
    async getLatestBuild(branch: string, pipeline?: string): Promise<Build | undefined> {
      const builds = await listBuilds({
        pipeline,
        branch,
        per_page: 1,
      })
      return builds[0]
    },

    /**
     * Get all running builds for a branch
     */
    async getRunningBuilds(branch: string, pipeline?: string): Promise<Build[]> {
      return listBuilds({
        pipeline,
        branch,
        state: ["running", "scheduled"],
      })
    },

    /**
     * Check if a commit has a passing build
     */
    async hasPassingBuild(commit: string, pipeline?: string): Promise<boolean> {
      const builds = await listBuilds({
        pipeline,
        commit,
        state: "passed",
        per_page: 1,
      })
      return builds.length > 0
    },

    /**
     * Get failed jobs from a build
     */
    getFailedJobs(build: Build): Job[] {
      return build.jobs.filter((job) => job.state === "failed")
    },

    /**
     * Format build status for display
     */
    formatBuildStatus(build: Build): string {
      const stateEmoji: Record<BuildState, string> = {
        running: "🔄",
        scheduled: "📅",
        passed: "✅",
        failed: "❌",
        blocked: "🚫",
        canceled: "🛑",
        canceling: "🛑",
        skipped: "⏭️",
        not_run: "⏸️",
        waiting: "⏳",
      }

      const emoji = stateEmoji[build.state] ?? "❓"
      return `${emoji} Build #${build.number} (${build.state}) - ${build.message || "No message"}`
    },
  }
}

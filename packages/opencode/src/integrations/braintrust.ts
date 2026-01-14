import { Log } from "../util/log"
import { Installation } from "../installation"

const log = Log.create({ service: "braintrust" })

export namespace Braintrust {
  export interface Config {
    apiKey: string
    projectName?: string
    projectId?: string
    appUrl?: string
    asyncFlush?: boolean
    flushIntervalMs?: number
    enabled?: boolean
  }

  export interface SpanInput {
    role: string
    content: string
  }

  export interface SpanMetrics {
    start?: number
    end?: number
    tokens?: number
    prompt_tokens?: number
    completion_tokens?: number
    latency?: number
  }

  export interface SpanMetadata {
    model?: string
    params?: Record<string, unknown>
    [key: string]: unknown
  }

  export interface SpanData {
    id?: string
    input?: SpanInput[] | string | unknown
    output?: string | unknown
    expected?: string
    error?: string
    scores?: Record<string, number>
    metadata?: SpanMetadata
    metrics?: SpanMetrics
    tags?: string[]
    name?: string
    type?: "llm" | "function" | "tool" | "task" | "eval" | "score"
    spanAttributes?: {
      name?: string
      type?: string
    }
    children?: SpanData[]
  }

  export interface ExperimentData {
    id: string
    projectId: string
    name: string
    description?: string
    metadata?: Record<string, unknown>
    createdAt: number
  }

  export interface LogEvent {
    id: string
    spanId?: string
    rootSpanId?: string
    spanParents?: string[]
    input?: unknown
    output?: unknown
    expected?: string
    error?: string
    scores?: Record<string, number>
    metadata?: SpanMetadata
    metrics?: SpanMetrics
    tags?: string[]
    createdAt: number
  }

  let _config: Config | undefined
  let _isInitialized = false
  let _projectId: string | undefined
  let _eventsBuffer: LogEvent[] = []
  let _flushInterval: ReturnType<typeof setInterval> | undefined
  let _activeSpans: Map<string, SpanData> = new Map()

  const BASE_URL = "https://api.braintrust.dev"
  const MAX_BUFFER_SIZE = 100

  export function init(config: Config): void {
    if (_isInitialized) {
      log.warn("Braintrust already initialized")
      return
    }

    _config = {
      ...config,
      appUrl: config.appUrl ?? BASE_URL,
      asyncFlush: config.asyncFlush ?? true,
      flushIntervalMs: config.flushIntervalMs ?? 10000,
      enabled: config.enabled ?? true,
    }

    if (_config.enabled && _config.asyncFlush) {
      _flushInterval = setInterval(() => {
        flush()
      }, _config.flushIntervalMs)
    }

    _isInitialized = true
    log.info("Braintrust initialized", {
      projectName: config.projectName,
      projectId: config.projectId,
      appUrl: _config.appUrl,
    })
  }

  export function isInitialized(): boolean {
    return _isInitialized
  }

  export function shutdown(): void {
    if (_flushInterval) {
      clearInterval(_flushInterval)
      _flushInterval = undefined
    }
    flush()
    _isInitialized = false
    _config = undefined
    _projectId = undefined
    _activeSpans.clear()
  }

  export async function getOrCreateProject(): Promise<string | undefined> {
    if (!_isInitialized || !_config?.enabled) {
      return undefined
    }

    if (_projectId) {
      return _projectId
    }

    if (_config.projectId) {
      _projectId = _config.projectId
      return _projectId
    }

    if (!_config.projectName) {
      log.warn("No project name or ID configured")
      return undefined
    }

    try {
      const response = await fetch(`${_config.appUrl}/v1/project`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${_config.apiKey}`,
        },
        body: JSON.stringify({
          name: _config.projectName,
        }),
      })

      if (response.ok) {
        const data = (await response.json()) as { id: string }
        _projectId = data.id
        log.debug("Braintrust project created/retrieved", { projectId: _projectId })
        return _projectId
      }

      if (response.status === 409) {
        const projects = await listProjects()
        const project = projects.find((p) => p.name === _config!.projectName)
        if (project) {
          _projectId = project.id
          return _projectId
        }
      }

      const text = await response.text()
      log.error("Failed to create Braintrust project", { status: response.status, error: text })
      return undefined
    } catch (error) {
      log.error("Failed to create Braintrust project", {
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  async function listProjects(): Promise<Array<{ id: string; name: string }>> {
    if (!_config) return []

    try {
      const response = await fetch(`${_config.appUrl}/v1/project`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${_config.apiKey}`,
        },
      })

      if (response.ok) {
        const data = (await response.json()) as { objects: Array<{ id: string; name: string }> }
        return data.objects ?? []
      }
      return []
    } catch {
      return []
    }
  }

  export function startSpan(name: string, options?: { type?: SpanData["type"]; metadata?: SpanMetadata }): string {
    const spanId = generateId()

    const span: SpanData = {
      id: spanId,
      name,
      type: options?.type ?? "function",
      metadata: options?.metadata,
      metrics: {
        start: Date.now() / 1000,
      },
      children: [],
    }

    _activeSpans.set(spanId, span)
    return spanId
  }

  export function logSpan(spanId: string, data: Partial<SpanData>): void {
    const span = _activeSpans.get(spanId)
    if (!span) {
      log.warn("Span not found", { spanId })
      return
    }

    Object.assign(span, {
      ...data,
      metrics: { ...span.metrics, ...data.metrics },
      metadata: { ...span.metadata, ...data.metadata },
    })
  }

  export function endSpan(spanId: string, data?: Partial<SpanData>): void {
    if (!_isInitialized || !_config?.enabled) {
      _activeSpans.delete(spanId)
      return
    }

    const span = _activeSpans.get(spanId)
    if (!span) {
      log.warn("Span not found", { spanId })
      return
    }

    if (data) {
      Object.assign(span, {
        ...data,
        metrics: { ...span.metrics, ...data.metrics },
        metadata: { ...span.metadata, ...data.metadata },
      })
    }

    span.metrics = {
      ...span.metrics,
      end: Date.now() / 1000,
    }

    if (span.metrics.start && span.metrics.end) {
      span.metrics.latency = (span.metrics.end - span.metrics.start) * 1000
    }

    const event: LogEvent = {
      id: generateId(),
      spanId: span.id,
      input: span.input,
      output: span.output,
      expected: span.expected,
      error: span.error,
      scores: span.scores,
      metadata: span.metadata,
      metrics: span.metrics,
      tags: span.tags,
      createdAt: Date.now(),
    }

    _eventsBuffer.push(event)
    _activeSpans.delete(spanId)

    if (_eventsBuffer.length >= MAX_BUFFER_SIZE) {
      flush()
    }
  }

  export async function logLLMCall(options: {
    name?: string
    model: string
    input: SpanInput[] | string
    output: string
    promptTokens?: number
    completionTokens?: number
    latencyMs?: number
    error?: string
    metadata?: Record<string, unknown>
    tags?: string[]
  }): Promise<void> {
    if (!_isInitialized || !_config?.enabled) {
      return
    }

    const event: LogEvent = {
      id: generateId(),
      input: options.input,
      output: options.output,
      error: options.error,
      metadata: {
        model: options.model,
        ...options.metadata,
      },
      metrics: {
        prompt_tokens: options.promptTokens,
        completion_tokens: options.completionTokens,
        tokens: (options.promptTokens ?? 0) + (options.completionTokens ?? 0),
        latency: options.latencyMs,
      },
      tags: options.tags,
      createdAt: Date.now(),
    }

    _eventsBuffer.push(event)

    if (_eventsBuffer.length >= MAX_BUFFER_SIZE || !_config.asyncFlush) {
      await flush()
    }
  }

  export async function logEval(options: {
    input: unknown
    output: unknown
    expected?: string
    scores: Record<string, number>
    metadata?: Record<string, unknown>
    tags?: string[]
  }): Promise<void> {
    if (!_isInitialized || !_config?.enabled) {
      return
    }

    const event: LogEvent = {
      id: generateId(),
      input: options.input,
      output: options.output,
      expected: options.expected,
      scores: options.scores,
      metadata: options.metadata,
      tags: options.tags,
      createdAt: Date.now(),
    }

    _eventsBuffer.push(event)

    if (_eventsBuffer.length >= MAX_BUFFER_SIZE || !_config.asyncFlush) {
      await flush()
    }
  }

  export async function logFeedback(spanId: string, feedback: { scores?: Record<string, number>; expected?: string; comment?: string }): Promise<void> {
    if (!_isInitialized || !_config?.enabled) {
      return
    }

    const projectId = await getOrCreateProject()
    if (!projectId) {
      return
    }

    try {
      const response = await fetch(`${_config.appUrl}/v1/project_logs/${projectId}/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${_config.apiKey}`,
        },
        body: JSON.stringify({
          feedback: [
            {
              id: spanId,
              scores: feedback.scores,
              expected: feedback.expected,
              comment: feedback.comment,
            },
          ],
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        log.error("Failed to log Braintrust feedback", { status: response.status, error: text })
      }
    } catch (error) {
      log.error("Failed to log Braintrust feedback", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export async function flush(): Promise<void> {
    if (!_isInitialized || !_config || _eventsBuffer.length === 0) {
      return
    }

    const projectId = await getOrCreateProject()
    if (!projectId) {
      log.warn("No project ID available, skipping flush")
      return
    }

    const events = [..._eventsBuffer]
    _eventsBuffer = []

    try {
      const response = await fetch(`${_config.appUrl}/v1/project_logs/${projectId}/insert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${_config.apiKey}`,
        },
        body: JSON.stringify({
          events: events.map((e) => ({
            id: e.id,
            span_id: e.spanId,
            root_span_id: e.rootSpanId,
            span_parents: e.spanParents,
            input: e.input,
            output: e.output,
            expected: e.expected,
            error: e.error,
            scores: e.scores,
            metadata: e.metadata,
            metrics: e.metrics,
            tags: e.tags,
            created: new Date(e.createdAt).toISOString(),
          })),
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Braintrust API error: ${response.status} ${text}`)
      }

      log.debug("Braintrust events flushed", { count: events.length })
    } catch (error) {
      log.error("Failed to flush Braintrust events", {
        error: error instanceof Error ? error.message : String(error),
      })
      _eventsBuffer = [...events, ..._eventsBuffer].slice(0, MAX_BUFFER_SIZE)
    }
  }

  export async function createExperiment(name: string, options?: { description?: string; metadata?: Record<string, unknown> }): Promise<ExperimentData | undefined> {
    if (!_isInitialized || !_config?.enabled) {
      return undefined
    }

    const projectId = await getOrCreateProject()
    if (!projectId) {
      return undefined
    }

    try {
      const response = await fetch(`${_config.appUrl}/v1/experiment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${_config.apiKey}`,
        },
        body: JSON.stringify({
          project_id: projectId,
          name,
          description: options?.description,
          metadata: options?.metadata,
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        log.error("Failed to create Braintrust experiment", { status: response.status, error: text })
        return undefined
      }

      const data = (await response.json()) as { id: string; project_id: string; name: string; description?: string; created: string }
      log.debug("Braintrust experiment created", { experimentId: data.id, name })

      return {
        id: data.id,
        projectId: data.project_id,
        name: data.name,
        description: data.description,
        createdAt: new Date(data.created).getTime(),
      }
    } catch (error) {
      log.error("Failed to create Braintrust experiment", {
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  export async function logExperimentEvent(experimentId: string, event: SpanData): Promise<void> {
    if (!_isInitialized || !_config?.enabled) {
      return
    }

    try {
      const response = await fetch(`${_config.appUrl}/v1/experiment/${experimentId}/insert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${_config.apiKey}`,
        },
        body: JSON.stringify({
          events: [
            {
              id: event.id ?? generateId(),
              input: event.input,
              output: event.output,
              expected: event.expected,
              error: event.error,
              scores: event.scores,
              metadata: event.metadata,
              metrics: event.metrics,
              tags: event.tags,
              span_attributes: event.spanAttributes ?? { name: event.name, type: event.type },
            },
          ],
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        log.error("Failed to log Braintrust experiment event", { status: response.status, error: text })
      }
    } catch (error) {
      log.error("Failed to log Braintrust experiment event", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function generateId(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
  }

  export const Helpers = {
    traced<T>(fn: (spanId: string) => Promise<T>, options?: { name?: string; type?: SpanData["type"]; metadata?: SpanMetadata }): Promise<T> {
      const spanId = startSpan(options?.name ?? fn.name ?? "anonymous", options)
      return fn(spanId)
        .then((result) => {
          endSpan(spanId, { output: result })
          return result
        })
        .catch((error) => {
          endSpan(spanId, { error: error instanceof Error ? error.message : String(error) })
          throw error
        })
    },

    formatMessages(messages: Array<{ role: string; content: string }>): SpanInput[] {
      return messages.map((m) => ({ role: m.role, content: m.content }))
    },

    calculateScore(output: string, expected: string): number {
      if (output === expected) return 1
      if (output.toLowerCase() === expected.toLowerCase()) return 0.9
      if (output.includes(expected) || expected.includes(output)) return 0.5
      return 0
    },
  }

  export const Metrics = {
    Agent: {
      taskStarted(agentId: string, task: string, metadata?: Record<string, unknown>) {
        return startSpan(`agent:${agentId}`, {
          type: "task",
          metadata: { task, agentId, ...metadata },
        })
      },
      taskCompleted(spanId: string, output: unknown, scores?: Record<string, number>) {
        endSpan(spanId, { output, scores })
      },
      taskFailed(spanId: string, error: string) {
        endSpan(spanId, { error })
      },
    },
    LLM: {
      async call(options: {
        model: string
        input: Array<{ role: string; content: string }> | string
        output: string
        promptTokens?: number
        completionTokens?: number
        latencyMs?: number
        metadata?: Record<string, unknown>
      }) {
        await logLLMCall({
          model: options.model,
          input: typeof options.input === "string" ? options.input : Helpers.formatMessages(options.input),
          output: options.output,
          promptTokens: options.promptTokens,
          completionTokens: options.completionTokens,
          latencyMs: options.latencyMs,
          metadata: options.metadata,
        })
      },
    },
    Eval: {
      async log(input: unknown, output: unknown, expected: string, scores: Record<string, number>, metadata?: Record<string, unknown>) {
        await logEval({
          input,
          output,
          expected,
          scores,
          metadata,
        })
      },
    },
    Session: {
      promptStarted(sessionId: string, prompt: string, metadata?: Record<string, unknown>) {
        return startSpan(`session:${sessionId}:prompt`, {
          type: "function",
          metadata: { prompt, sessionId, ...metadata },
        })
      },
      promptCompleted(spanId: string, response: string, scores?: Record<string, number>) {
        endSpan(spanId, { output: response, scores })
      },
    },
  }
}

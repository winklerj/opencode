/**
 * OpenTelemetry Tracing Implementation
 *
 * Provides distributed tracing for the hosted agent system using OpenTelemetry
 * semantic conventions and custom attributes specific to OpenCode.
 */

import { Log } from "../util/log"
import { Installation } from "../installation"

const log = Log.create({ service: "telemetry" })

/**
 * Semantic span names for hosted agent operations.
 * Following OpenTelemetry naming conventions.
 */
export const SpanNames = {
  // Sandbox lifecycle
  SANDBOX_CREATE: "sandbox.create",
  SANDBOX_GIT_SYNC: "sandbox.git.sync",
  SANDBOX_SNAPSHOT_CREATE: "sandbox.snapshot.create",
  SANDBOX_SNAPSHOT_RESTORE: "sandbox.snapshot.restore",
  SANDBOX_TERMINATE: "sandbox.terminate",

  // Warm pool
  WARMPOOL_CLAIM: "warmpool.claim",
  WARMPOOL_REPLENISH: "warmpool.replenish",

  // Prompt execution
  PROMPT_EXECUTE: "prompt.execute",
  PROMPT_QUEUE: "prompt.queue",
  TOOL_EXECUTE: "tool.execute",

  // Client operations
  CLIENT_CONNECT: "client.connect",
  CLIENT_SYNC: "client.sync",

  // Integrations
  SLACK_MESSAGE_PROCESS: "slack.message.process",
  GITHUB_WEBHOOK_PROCESS: "github.webhook.process",
  PR_COMMENT_RESPOND: "pr.comment.respond",

  // Image building
  IMAGE_BUILD: "image.build",
  IMAGE_PUSH: "image.push",

  // Skills
  SKILL_INVOKE: "skill.invoke",
  SKILL_LOAD: "skill.load",
} as const

export type SpanName = (typeof SpanNames)[keyof typeof SpanNames]

/**
 * Span attributes following OTel semantic conventions with OpenCode-specific extensions.
 */
export const SpanAttributes = {
  // Session context
  SESSION_ID: "opencode.session.id",
  USER_ID: "opencode.user.id",
  ORGANIZATION_ID: "opencode.organization.id",

  // Sandbox context
  SANDBOX_ID: "opencode.sandbox.id",
  SANDBOX_STATUS: "opencode.sandbox.status",
  SANDBOX_IMAGE_TAG: "opencode.sandbox.image_tag",

  // Repository context (following VCS semantic conventions)
  GIT_REPO: "vcs.repository.url.full",
  GIT_BRANCH: "vcs.repository.ref.name",
  GIT_COMMIT: "vcs.repository.ref.revision",

  // Prompt context
  PROMPT_ID: "opencode.prompt.id",
  PROMPT_LENGTH: "opencode.prompt.length",
  TOOL_NAME: "opencode.tool.name",
  TOOL_BLOCKED: "opencode.tool.blocked",

  // Client context
  CLIENT_TYPE: "opencode.client.type",
  CLIENT_VERSION: "opencode.client.version",

  // Snapshot context
  SNAPSHOT_ID: "opencode.snapshot.id",
  SNAPSHOT_SIZE_BYTES: "opencode.snapshot.size_bytes",

  // Performance
  QUEUE_WAIT_MS: "opencode.queue.wait_ms",
  WARMPOOL_HIT: "opencode.warmpool.hit",

  // Skills
  SKILL_NAME: "opencode.skill.name",

  // Model context
  MODEL_ID: "opencode.model.id",
  MODEL_PROVIDER: "opencode.model.provider",
} as const

export type SpanAttributeKey = (typeof SpanAttributes)[keyof typeof SpanAttributes]

/**
 * Span status codes matching OpenTelemetry specification.
 */
export const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const

export type SpanStatus = (typeof SpanStatusCode)[keyof typeof SpanStatusCode]

/**
 * Represents a span in a trace.
 */
export interface Span {
  name: string
  traceId: string
  spanId: string
  parentSpanId?: string
  startTime: number
  endTime?: number
  status: SpanStatus
  statusMessage?: string
  attributes: Record<string, string | number | boolean>
  events: SpanEvent[]
}

/**
 * Represents an event within a span.
 */
export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, string | number | boolean>
}

/**
 * Configuration for the telemetry system.
 */
export interface TelemetryConfig {
  enabled?: boolean
  serviceName?: string
  serviceVersion?: string
  environment?: string
  collectorEndpoint?: string
  exporterType?: "otlp" | "console" | "none"
  sampleRate?: number
  flushIntervalMs?: number
  maxExportBatchSize?: number
}

export namespace Telemetry {
  let _config: Required<TelemetryConfig>
  let _isInitialized = false
  let _activeSpans = new Map<string, Span>()
  let _spanBuffer: Span[] = []
  let _flushInterval: ReturnType<typeof setInterval> | undefined

  const MAX_BUFFER_SIZE = 1000

  /**
   * Generate a random trace ID (32 hex characters).
   */
  function generateTraceId(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  /**
   * Generate a random span ID (16 hex characters).
   */
  function generateSpanId(): string {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  /**
   * Initialize the telemetry system.
   */
  export function init(config: TelemetryConfig = {}): void {
    if (_isInitialized) {
      log.warn("Telemetry already initialized")
      return
    }

    _config = {
      enabled: config.enabled ?? true,
      serviceName: config.serviceName ?? "opencode-hosted-agent",
      serviceVersion: config.serviceVersion ?? Installation.VERSION,
      environment: config.environment ?? process.env.NODE_ENV ?? "development",
      collectorEndpoint: config.collectorEndpoint ?? "http://localhost:4317",
      exporterType: config.exporterType ?? "otlp",
      sampleRate: config.sampleRate ?? 1.0,
      flushIntervalMs: config.flushIntervalMs ?? 15000,
      maxExportBatchSize: config.maxExportBatchSize ?? 500,
    }

    if (_config.enabled && _config.exporterType !== "none") {
      _flushInterval = setInterval(() => {
        flush()
      }, _config.flushIntervalMs)
    }

    _isInitialized = true
    log.info("Telemetry initialized", {
      serviceName: _config.serviceName,
      environment: _config.environment,
      exporterType: _config.exporterType,
    })
  }

  /**
   * Check if telemetry is initialized.
   */
  export function isInitialized(): boolean {
    return _isInitialized
  }

  /**
   * Get the current configuration.
   */
  export function getConfig(): Required<TelemetryConfig> | undefined {
    return _isInitialized ? _config : undefined
  }

  /**
   * Determine if a trace should be sampled.
   */
  function shouldSample(): boolean {
    if (!_isInitialized || !_config.enabled) return false
    return Math.random() < _config.sampleRate
  }

  /**
   * Start a new span.
   */
  export function startSpan(
    name: SpanName | string,
    options: {
      traceId?: string
      parentSpanId?: string
      attributes?: Record<string, string | number | boolean>
    } = {}
  ): Span | null {
    if (!shouldSample()) return null

    const span: Span = {
      name,
      traceId: options.traceId ?? generateTraceId(),
      spanId: generateSpanId(),
      parentSpanId: options.parentSpanId,
      startTime: Date.now(),
      status: SpanStatusCode.UNSET,
      attributes: {
        "service.name": _config.serviceName,
        "service.version": _config.serviceVersion,
        "deployment.environment": _config.environment,
        ...options.attributes,
      },
      events: [],
    }

    _activeSpans.set(span.spanId, span)
    return span
  }

  /**
   * Start an active span that becomes the current context.
   */
  export async function startActiveSpan<T>(
    name: SpanName | string,
    fn: (span: Span | null) => Promise<T>,
    options: {
      traceId?: string
      parentSpanId?: string
      attributes?: Record<string, string | number | boolean>
    } = {}
  ): Promise<T> {
    const span = startSpan(name, options)

    try {
      const result = await fn(span)
      if (span) {
        span.status = SpanStatusCode.OK
      }
      return result
    } catch (error) {
      if (span) {
        setSpanError(span, error as Error)
      }
      throw error
    } finally {
      if (span) {
        endSpan(span)
      }
    }
  }

  /**
   * Set attributes on a span.
   */
  export function setSpanAttributes(span: Span | null, attributes: Record<string, string | number | boolean>): void {
    if (!span) return
    Object.assign(span.attributes, attributes)
  }

  /**
   * Add an event to a span.
   */
  export function addSpanEvent(
    span: Span | null,
    name: string,
    attributes?: Record<string, string | number | boolean>
  ): void {
    if (!span) return
    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    })
  }

  /**
   * Set the span status to error.
   */
  export function setSpanError(span: Span | null, error: Error): void {
    if (!span) return
    span.status = SpanStatusCode.ERROR
    span.statusMessage = error.message
    span.attributes["exception.type"] = error.name
    span.attributes["exception.message"] = error.message
    if (error.stack) {
      span.attributes["exception.stacktrace"] = error.stack
    }
  }

  /**
   * End a span and add it to the export buffer.
   */
  export function endSpan(span: Span | null): void {
    if (!span) return

    span.endTime = Date.now()
    _activeSpans.delete(span.spanId)

    if (_config.enabled) {
      _spanBuffer.push(span)

      if (_spanBuffer.length >= _config.maxExportBatchSize) {
        flush()
      }

      // Prevent buffer overflow
      if (_spanBuffer.length > MAX_BUFFER_SIZE) {
        log.warn(`Span buffer overflow, dropping oldest ${_spanBuffer.length - MAX_BUFFER_SIZE} spans`)
        _spanBuffer = _spanBuffer.slice(-MAX_BUFFER_SIZE)
      }
    }
  }

  /**
   * Flush spans to the collector.
   */
  export async function flush(): Promise<void> {
    if (!_isInitialized || !_config.enabled || _spanBuffer.length === 0) return

    const spans = _spanBuffer.splice(0, _config.maxExportBatchSize)

    if (_config.exporterType === "console") {
      for (const span of spans) {
        log.debug("Span", {
          name: span.name,
          traceId: span.traceId,
          spanId: span.spanId,
          duration: span.endTime ? span.endTime - span.startTime : undefined,
          status: span.status,
        })
      }
      return
    }

    if (_config.exporterType === "otlp") {
      try {
        const body = {
          resourceSpans: [
            {
              resource: {
                attributes: [
                  { key: "service.name", value: { stringValue: _config.serviceName } },
                  { key: "service.version", value: { stringValue: _config.serviceVersion } },
                  { key: "deployment.environment", value: { stringValue: _config.environment } },
                ],
              },
              scopeSpans: [
                {
                  scope: { name: "opencode-hosted-agent", version: _config.serviceVersion },
                  spans: spans.map(formatSpanForOTLP),
                },
              ],
            },
          ],
        }

        const response = await fetch(`${_config.collectorEndpoint}/v1/traces`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          log.warn(`Failed to export spans: ${response.status} ${response.statusText}`)
          // Re-add failed spans to buffer for retry
          _spanBuffer.unshift(...spans)
        }
      } catch (error) {
        log.warn(`Failed to export spans: ${error}`)
        // Re-add failed spans to buffer for retry
        _spanBuffer.unshift(...spans)
      }
    }
  }

  /**
   * Format a span for OTLP export.
   */
  function formatSpanForOTLP(span: Span): Record<string, unknown> {
    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      kind: 1, // SPAN_KIND_INTERNAL
      startTimeUnixNano: span.startTime * 1_000_000,
      endTimeUnixNano: span.endTime ? span.endTime * 1_000_000 : undefined,
      attributes: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        value: formatAttributeValue(value),
      })),
      events: span.events.map((event) => ({
        timeUnixNano: event.timestamp * 1_000_000,
        name: event.name,
        attributes: event.attributes
          ? Object.entries(event.attributes).map(([key, value]) => ({
              key,
              value: formatAttributeValue(value),
            }))
          : undefined,
      })),
      status: {
        code: span.status,
        message: span.statusMessage,
      },
    }
  }

  /**
   * Format an attribute value for OTLP.
   */
  function formatAttributeValue(value: string | number | boolean): Record<string, unknown> {
    if (typeof value === "string") {
      return { stringValue: value }
    } else if (typeof value === "number") {
      if (Number.isInteger(value)) {
        return { intValue: value.toString() }
      }
      return { doubleValue: value }
    } else if (typeof value === "boolean") {
      return { boolValue: value }
    }
    return { stringValue: String(value) }
  }

  /**
   * Shutdown the telemetry system.
   */
  export async function shutdown(): Promise<void> {
    if (!_isInitialized) return

    if (_flushInterval) {
      clearInterval(_flushInterval)
      _flushInterval = undefined
    }

    // Final flush
    await flush()

    _isInitialized = false
    _activeSpans.clear()
    _spanBuffer = []
    log.info("Telemetry shutdown complete")
  }

  /**
   * Get the number of active spans.
   */
  export function getActiveSpanCount(): number {
    return _activeSpans.size
  }

  /**
   * Get the number of buffered spans.
   */
  export function getBufferedSpanCount(): number {
    return _spanBuffer.length
  }

  /**
   * Reset the telemetry system (for testing).
   */
  export function reset(): void {
    if (_flushInterval) {
      clearInterval(_flushInterval)
      _flushInterval = undefined
    }
    _isInitialized = false
    _activeSpans.clear()
    _spanBuffer = []
  }
}

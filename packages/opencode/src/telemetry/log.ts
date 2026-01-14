/**
 * OpenTelemetry Structured Logging Implementation
 *
 * Provides structured logging following OpenTelemetry semantic conventions
 * with automatic trace context propagation.
 */

import { Log } from "../util/log"
import { Installation } from "../installation"

const log = Log.create({ service: "telemetry-log" })

/**
 * Log severity levels following OpenTelemetry specification.
 */
export const SeverityNumber = {
  TRACE: 1,
  TRACE2: 2,
  TRACE3: 3,
  TRACE4: 4,
  DEBUG: 5,
  DEBUG2: 6,
  DEBUG3: 7,
  DEBUG4: 8,
  INFO: 9,
  INFO2: 10,
  INFO3: 11,
  INFO4: 12,
  WARN: 13,
  WARN2: 14,
  WARN3: 15,
  WARN4: 16,
  ERROR: 17,
  ERROR2: 18,
  ERROR3: 19,
  ERROR4: 20,
  FATAL: 21,
  FATAL2: 22,
  FATAL3: 23,
  FATAL4: 24,
} as const

export type Severity = (typeof SeverityNumber)[keyof typeof SeverityNumber]

/**
 * Severity text mapping.
 */
export const SeverityText: Record<Severity, string> = {
  [SeverityNumber.TRACE]: "TRACE",
  [SeverityNumber.TRACE2]: "TRACE",
  [SeverityNumber.TRACE3]: "TRACE",
  [SeverityNumber.TRACE4]: "TRACE",
  [SeverityNumber.DEBUG]: "DEBUG",
  [SeverityNumber.DEBUG2]: "DEBUG",
  [SeverityNumber.DEBUG3]: "DEBUG",
  [SeverityNumber.DEBUG4]: "DEBUG",
  [SeverityNumber.INFO]: "INFO",
  [SeverityNumber.INFO2]: "INFO",
  [SeverityNumber.INFO3]: "INFO",
  [SeverityNumber.INFO4]: "INFO",
  [SeverityNumber.WARN]: "WARN",
  [SeverityNumber.WARN2]: "WARN",
  [SeverityNumber.WARN3]: "WARN",
  [SeverityNumber.WARN4]: "WARN",
  [SeverityNumber.ERROR]: "ERROR",
  [SeverityNumber.ERROR2]: "ERROR",
  [SeverityNumber.ERROR3]: "ERROR",
  [SeverityNumber.ERROR4]: "ERROR",
  [SeverityNumber.FATAL]: "FATAL",
  [SeverityNumber.FATAL2]: "FATAL",
  [SeverityNumber.FATAL3]: "FATAL",
  [SeverityNumber.FATAL4]: "FATAL",
}

/**
 * Event domain categories.
 * See SPECIFICATION.md section 12.5 for the complete list.
 */
export type EventDomain =
  | "sandbox"
  | "prompt"
  | "client"
  | "integration"
  | "system"
  | "multiplayer"
  | "skill"
  | "background"
  | "voice"
  | "desktop"
  | "editor"
  | "stats"
  | "warmpool"

/**
 * Base log record attributes following OTel semantic conventions.
 */
export interface LogAttributes {
  // Trace context for correlation
  trace_id?: string
  span_id?: string

  // Session context
  "opencode.session.id"?: string
  "opencode.user.id"?: string
  "opencode.organization.id"?: string

  // Event-specific attributes
  "event.name": string
  "event.domain": EventDomain

  // Error context
  "exception.type"?: string
  "exception.message"?: string
  "exception.stacktrace"?: string

  // Additional custom attributes
  [key: string]: string | number | boolean | undefined
}

/**
 * Log record structure.
 */
export interface LogRecord {
  timestamp: number
  observedTimestamp: number
  severityNumber: Severity
  severityText: string
  body: string
  attributes: LogAttributes
  traceId?: string
  spanId?: string
}

/**
 * Configuration for the telemetry log system.
 */
export interface TelemetryLogConfig {
  enabled?: boolean
  serviceName?: string
  serviceVersion?: string
  environment?: string
  collectorEndpoint?: string
  exporterType?: "otlp" | "console" | "none"
  minSeverity?: Severity
  flushIntervalMs?: number
  maxExportBatchSize?: number
}

/**
 * Well-known event names for the hosted agent system.
 * See SPECIFICATION.md section 11 for the complete event catalog.
 */
export const EventNames = {
  // Sandbox events
  SANDBOX_CREATED: "sandbox.created",
  SANDBOX_UPDATED: "sandbox.updated",
  SANDBOX_READY: "sandbox.ready",
  SANDBOX_GIT_SYNC_STARTED: "sandbox.git.sync.started",
  SANDBOX_GIT_SYNC_COMPLETED: "sandbox.git.sync.completed",
  SANDBOX_GIT_SYNC_FAILED: "sandbox.git.sync.failed",
  SANDBOX_SNAPSHOT_CREATED: "sandbox.snapshot.created",
  SANDBOX_SNAPSHOT_RESTORED: "sandbox.snapshot.restored",
  SANDBOX_SERVICE_READY: "sandbox.service.ready",
  SANDBOX_TERMINATED: "sandbox.terminated",

  // Warm pool events
  WARMPOOL_SANDBOX_CLAIMED: "warmpool.sandbox.claimed",
  WARMPOOL_SANDBOX_RETURNED: "warmpool.sandbox.returned",
  WARMPOOL_TYPING_DETECTED: "warmpool.typing.detected",
  WARMPOOL_REPLENISHED: "warmpool.replenished",

  // Prompt events
  PROMPT_QUEUED: "prompt.queued",
  PROMPT_STARTED: "prompt.started",
  PROMPT_COMPLETED: "prompt.completed",
  PROMPT_FAILED: "prompt.failed",
  PROMPT_CANCELLED: "prompt.cancelled",

  // Tool events
  TOOL_EXECUTED: "tool.executed",
  TOOL_BLOCKED: "tool.blocked",

  // Client events
  CLIENT_CONNECTED: "client.connected",
  CLIENT_DISCONNECTED: "client.disconnected",
  CLIENT_STATE_SYNCED: "client.state.synced",

  // Multiplayer events
  MULTIPLAYER_USER_JOINED: "multiplayer.user.joined",
  MULTIPLAYER_USER_LEFT: "multiplayer.user.left",
  MULTIPLAYER_CURSOR_MOVED: "multiplayer.cursor.moved",
  MULTIPLAYER_PROMPT_QUEUED: "multiplayer.prompt.queued",
  MULTIPLAYER_STATE_CHANGED: "multiplayer.state.changed",

  // Background agent events
  BACKGROUND_SPAWNED: "background.spawned",
  BACKGROUND_STATUS: "background.status",
  BACKGROUND_COMPLETED: "background.completed",

  // Integration events
  INTEGRATION_GITHUB_WEBHOOK: "integration.github.webhook",
  INTEGRATION_SLACK_MESSAGE: "integration.slack.message",
  SLACK_MESSAGE_RECEIVED: "slack.message.received",
  SLACK_RESPONSE_SENT: "slack.response.sent",
  GITHUB_WEBHOOK_RECEIVED: "github.webhook.received",
  GITHUB_PR_CREATED: "github.pr.created",
  PR_COMMENT_RECEIVED: "pr.comment.received",
  PR_COMMENT_RESPONDED: "pr.comment.responded",
  PR_SESSION_CREATED: "pr.session.created",
  PR_CHANGES_PUSHED: "pr.changes.pushed",

  // Voice events
  VOICE_STARTED: "voice.started",
  VOICE_TRANSCRIPT_INTERIM: "voice.transcript.interim",
  VOICE_TRANSCRIPT_FINAL: "voice.transcript.final",
  VOICE_STOPPED: "voice.stopped",

  // Desktop streaming events
  DESKTOP_STARTED: "desktop.started",
  DESKTOP_STOPPED: "desktop.stopped",
  DESKTOP_SCREENSHOT_CAPTURED: "desktop.screenshot.captured",

  // Editor events
  EDITOR_OPENED: "editor.opened",
  EDITOR_FILE_SAVED: "editor.file.saved",
  EDITOR_CLOSED: "editor.closed",

  // Statistics events
  STATS_PROMPT_SENT: "stats.prompt.sent",
  STATS_SESSION_CREATED: "stats.session.created",
  STATS_PR_CREATED: "stats.pr.created",
  STATS_PR_MERGED: "stats.pr.merged",

  // System events
  IMAGE_BUILD_STARTED: "image.build.started",
  IMAGE_BUILD_COMPLETED: "image.build.completed",
  IMAGE_BUILD_FAILED: "image.build.failed",

  // Skill events
  SKILL_INVOKED: "skill.invoked",
  SKILL_COMPLETED: "skill.completed",
  SKILL_CUSTOM_LOADED: "skill.custom.loaded",
} as const

export type EventName = (typeof EventNames)[keyof typeof EventNames]

export namespace TelemetryLog {
  let _config: Required<TelemetryLogConfig>
  let _isInitialized = false
  let _logBuffer: LogRecord[] = []
  let _flushInterval: ReturnType<typeof setInterval> | undefined
  let _currentTraceId: string | undefined
  let _currentSpanId: string | undefined

  const MAX_BUFFER_SIZE = 1000

  /**
   * Initialize the telemetry log system.
   */
  export function init(config: TelemetryLogConfig = {}): void {
    if (_isInitialized) {
      log.warn("TelemetryLog already initialized")
      return
    }

    _config = {
      enabled: config.enabled ?? true,
      serviceName: config.serviceName ?? "opencode-hosted-agent",
      serviceVersion: config.serviceVersion ?? Installation.VERSION,
      environment: config.environment ?? process.env.NODE_ENV ?? "development",
      collectorEndpoint: config.collectorEndpoint ?? "http://localhost:4317",
      exporterType: config.exporterType ?? "otlp",
      minSeverity: config.minSeverity ?? SeverityNumber.INFO,
      flushIntervalMs: config.flushIntervalMs ?? 15000,
      maxExportBatchSize: config.maxExportBatchSize ?? 500,
    }

    if (_config.enabled && _config.exporterType !== "none") {
      _flushInterval = setInterval(() => {
        flush()
      }, _config.flushIntervalMs)
    }

    _isInitialized = true
    log.info("TelemetryLog initialized", {
      serviceName: _config.serviceName,
      environment: _config.environment,
      exporterType: _config.exporterType,
    })
  }

  /**
   * Check if telemetry log is initialized.
   */
  export function isInitialized(): boolean {
    return _isInitialized
  }

  /**
   * Get the current configuration.
   */
  export function getConfig(): Required<TelemetryLogConfig> | undefined {
    return _isInitialized ? _config : undefined
  }

  /**
   * Set the current trace context.
   */
  export function setTraceContext(traceId: string | undefined, spanId: string | undefined): void {
    _currentTraceId = traceId
    _currentSpanId = spanId
  }

  /**
   * Get the current trace context.
   */
  export function getTraceContext(): { traceId: string | undefined; spanId: string | undefined } {
    return { traceId: _currentTraceId, spanId: _currentSpanId }
  }

  /**
   * Emit a log record.
   */
  function emit(severity: Severity, message: string, attributes: Partial<LogAttributes>): void {
    if (!_isInitialized || !_config.enabled) return
    if (severity < _config.minSeverity) return

    const record: LogRecord = {
      timestamp: Date.now(),
      observedTimestamp: Date.now(),
      severityNumber: severity,
      severityText: SeverityText[severity],
      body: message,
      attributes: {
        "event.name": attributes["event.name"] ?? "unknown",
        "event.domain": attributes["event.domain"] ?? "system",
        ...attributes,
        trace_id: _currentTraceId,
        span_id: _currentSpanId,
      },
      traceId: _currentTraceId,
      spanId: _currentSpanId,
    }

    _logBuffer.push(record)

    if (_logBuffer.length >= _config.maxExportBatchSize) {
      flush()
    }

    // Prevent buffer overflow
    if (_logBuffer.length > MAX_BUFFER_SIZE) {
      log.warn(`Log buffer overflow, dropping oldest ${_logBuffer.length - MAX_BUFFER_SIZE} records`)
      _logBuffer = _logBuffer.slice(-MAX_BUFFER_SIZE)
    }
  }

  /**
   * Log a trace level message.
   */
  export function trace(message: string, attributes: Partial<LogAttributes>): void {
    emit(SeverityNumber.TRACE, message, attributes)
  }

  /**
   * Log a debug level message.
   */
  export function debug(message: string, attributes: Partial<LogAttributes>): void {
    emit(SeverityNumber.DEBUG, message, attributes)
  }

  /**
   * Log an info level message.
   */
  export function info(message: string, attributes: Partial<LogAttributes>): void {
    emit(SeverityNumber.INFO, message, attributes)
  }

  /**
   * Log a warning level message.
   */
  export function warn(message: string, attributes: Partial<LogAttributes>): void {
    emit(SeverityNumber.WARN, message, attributes)
  }

  /**
   * Log an error level message.
   */
  export function error(message: string, attributes: Partial<LogAttributes>): void {
    emit(SeverityNumber.ERROR, message, attributes)
  }

  /**
   * Log an error with exception details.
   */
  export function errorWithException(
    message: string,
    err: Error,
    attributes: Partial<LogAttributes>
  ): void {
    emit(SeverityNumber.ERROR, message, {
      ...attributes,
      "exception.type": err.name,
      "exception.message": err.message,
      "exception.stacktrace": err.stack,
    })
  }

  /**
   * Log a fatal level message.
   */
  export function fatal(message: string, attributes: Partial<LogAttributes>): void {
    emit(SeverityNumber.FATAL, message, attributes)
  }

  /**
   * Flush logs to the collector.
   */
  export async function flush(): Promise<void> {
    if (!_isInitialized || !_config.enabled || _logBuffer.length === 0) return

    const records = _logBuffer.splice(0, _config.maxExportBatchSize)

    if (_config.exporterType === "console") {
      for (const record of records) {
        log.debug("Log", {
          severity: record.severityText,
          message: record.body,
          event: record.attributes["event.name"],
          domain: record.attributes["event.domain"],
        })
      }
      return
    }

    if (_config.exporterType === "otlp") {
      try {
        const body = formatLogsForOTLP(records)

        const response = await fetch(`${_config.collectorEndpoint}/v1/logs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          log.warn(`Failed to export logs: ${response.status} ${response.statusText}`)
          // Re-add failed records to buffer for retry
          _logBuffer.unshift(...records)
        }
      } catch (err) {
        log.warn(`Failed to export logs: ${err}`)
        // Re-add failed records to buffer for retry
        _logBuffer.unshift(...records)
      }
    }
  }

  /**
   * Format logs for OTLP export.
   */
  function formatLogsForOTLP(records: LogRecord[]): Record<string, unknown> {
    return {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: _config.serviceName } },
              { key: "service.version", value: { stringValue: _config.serviceVersion } },
              { key: "deployment.environment", value: { stringValue: _config.environment } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: "opencode-hosted-agent", version: _config.serviceVersion },
              logRecords: records.map((record) => ({
                timeUnixNano: record.timestamp * 1_000_000,
                observedTimeUnixNano: record.observedTimestamp * 1_000_000,
                severityNumber: record.severityNumber,
                severityText: record.severityText,
                body: { stringValue: record.body },
                attributes: Object.entries(record.attributes)
                  .filter(([, value]) => value !== undefined)
                  .map(([key, value]) => ({
                    key,
                    value:
                      typeof value === "string"
                        ? { stringValue: value }
                        : typeof value === "number"
                          ? Number.isInteger(value)
                            ? { intValue: value.toString() }
                            : { doubleValue: value }
                          : { boolValue: value },
                  })),
                traceId: record.traceId,
                spanId: record.spanId,
              })),
            },
          ],
        },
      ],
    }
  }

  /**
   * Shutdown the telemetry log system.
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
    _logBuffer = []
    _currentTraceId = undefined
    _currentSpanId = undefined
    log.info("TelemetryLog shutdown complete")
  }

  /**
   * Get the number of buffered log records.
   */
  export function getBufferedCount(): number {
    return _logBuffer.length
  }

  /**
   * Reset the telemetry log system (for testing).
   */
  export function reset(): void {
    if (_flushInterval) {
      clearInterval(_flushInterval)
      _flushInterval = undefined
    }
    _isInitialized = false
    _logBuffer = []
    _currentTraceId = undefined
    _currentSpanId = undefined
  }

  // Convenience methods for common events

  /**
   * Log sandbox created event.
   */
  export function logSandboxCreated(sessionId: string, sandboxId: string): void {
    info("Sandbox created", {
      "event.name": EventNames.SANDBOX_CREATED,
      "event.domain": "sandbox",
      "opencode.session.id": sessionId,
      "opencode.sandbox.id": sandboxId,
    })
  }

  /**
   * Log sandbox ready event.
   */
  export function logSandboxReady(sessionId: string, sandboxId: string): void {
    info("Sandbox ready", {
      "event.name": EventNames.SANDBOX_READY,
      "event.domain": "sandbox",
      "opencode.session.id": sessionId,
      "opencode.sandbox.id": sandboxId,
    })
  }

  /**
   * Log prompt queued event.
   */
  export function logPromptQueued(sessionId: string, promptId: string, userId?: string): void {
    info("Prompt queued", {
      "event.name": EventNames.PROMPT_QUEUED,
      "event.domain": "prompt",
      "opencode.session.id": sessionId,
      "opencode.prompt.id": promptId,
      "opencode.user.id": userId,
    })
  }

  /**
   * Log prompt completed event.
   */
  export function logPromptCompleted(sessionId: string, promptId: string, durationMs: number): void {
    info("Prompt completed", {
      "event.name": EventNames.PROMPT_COMPLETED,
      "event.domain": "prompt",
      "opencode.session.id": sessionId,
      "opencode.prompt.id": promptId,
      "opencode.duration_ms": durationMs,
    })
  }

  /**
   * Log prompt failed event.
   */
  export function logPromptFailed(sessionId: string, promptId: string, err: Error): void {
    errorWithException("Prompt failed", err, {
      "event.name": EventNames.PROMPT_FAILED,
      "event.domain": "prompt",
      "opencode.session.id": sessionId,
      "opencode.prompt.id": promptId,
    })
  }

  /**
   * Log tool executed event.
   */
  export function logToolExecuted(sessionId: string, toolName: string, blocked: boolean): void {
    if (blocked) {
      warn("Tool blocked", {
        "event.name": EventNames.TOOL_BLOCKED,
        "event.domain": "prompt",
        "opencode.session.id": sessionId,
        "opencode.tool.name": toolName,
      })
    } else {
      debug("Tool executed", {
        "event.name": EventNames.TOOL_EXECUTED,
        "event.domain": "prompt",
        "opencode.session.id": sessionId,
        "opencode.tool.name": toolName,
      })
    }
  }

  /**
   * Log git sync failed event.
   */
  export function logGitSyncFailed(sessionId: string, sandboxId: string, err: Error): void {
    errorWithException("Git sync failed", err, {
      "event.name": EventNames.SANDBOX_GIT_SYNC_FAILED,
      "event.domain": "sandbox",
      "opencode.session.id": sessionId,
      "opencode.sandbox.id": sandboxId,
    })
  }

  /**
   * Log client connected event.
   */
  export function logClientConnected(sessionId: string, clientType: string): void {
    info("Client connected", {
      "event.name": EventNames.CLIENT_CONNECTED,
      "event.domain": "client",
      "opencode.session.id": sessionId,
      "opencode.client.type": clientType,
    })
  }

  /**
   * Log client disconnected event.
   */
  export function logClientDisconnected(sessionId: string, clientType: string): void {
    info("Client disconnected", {
      "event.name": EventNames.CLIENT_DISCONNECTED,
      "event.domain": "client",
      "opencode.session.id": sessionId,
      "opencode.client.type": clientType,
    })
  }

  /**
   * Log multiplayer user joined event.
   */
  export function logUserJoined(sessionId: string, userId: string): void {
    info("User joined multiplayer session", {
      "event.name": EventNames.MULTIPLAYER_USER_JOINED,
      "event.domain": "multiplayer",
      "opencode.session.id": sessionId,
      "opencode.user.id": userId,
    })
  }

  /**
   * Log multiplayer user left event.
   */
  export function logUserLeft(sessionId: string, userId: string): void {
    info("User left multiplayer session", {
      "event.name": EventNames.MULTIPLAYER_USER_LEFT,
      "event.domain": "multiplayer",
      "opencode.session.id": sessionId,
      "opencode.user.id": userId,
    })
  }

  /**
   * Log skill invoked event.
   */
  export function logSkillInvoked(sessionId: string, skillName: string): void {
    info("Skill invoked", {
      "event.name": EventNames.SKILL_INVOKED,
      "event.domain": "skill",
      "opencode.session.id": sessionId,
      "opencode.skill.name": skillName,
    })
  }

  /**
   * Log image build started event.
   */
  export function logImageBuildStarted(imageTag: string, repo: string): void {
    info("Image build started", {
      "event.name": EventNames.IMAGE_BUILD_STARTED,
      "event.domain": "system",
      "opencode.image.tag": imageTag,
      "vcs.repository.url.full": repo,
    })
  }

  /**
   * Log image build completed event.
   */
  export function logImageBuildCompleted(imageTag: string, durationMs: number): void {
    info("Image build completed", {
      "event.name": EventNames.IMAGE_BUILD_COMPLETED,
      "event.domain": "system",
      "opencode.image.tag": imageTag,
      "opencode.duration_ms": durationMs,
    })
  }

  /**
   * Log image build failed event.
   */
  export function logImageBuildFailed(imageTag: string, err: Error): void {
    errorWithException("Image build failed", err, {
      "event.name": EventNames.IMAGE_BUILD_FAILED,
      "event.domain": "system",
      "opencode.image.tag": imageTag,
    })
  }
}

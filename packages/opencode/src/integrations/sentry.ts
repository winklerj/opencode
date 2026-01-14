import { Log } from "../util/log"
import { Installation } from "../installation"
import type { Context } from "hono"

const log = Log.create({ service: "sentry" })

export namespace Sentry {
  export interface Config {
    dsn: string
    environment?: string
    release?: string
    sampleRate?: number
    tracesSampleRate?: number
    debug?: boolean
  }

  export interface User {
    id?: string
    email?: string
    username?: string
    ip_address?: string
  }

  export interface Breadcrumb {
    category?: string
    message?: string
    level?: "fatal" | "error" | "warning" | "info" | "debug"
    data?: Record<string, unknown>
    timestamp?: number
  }

  export interface EventExtra {
    [key: string]: unknown
  }

  export interface EventTags {
    [key: string]: string
  }

  let _config: Config | undefined
  let _isInitialized = false
  let _breadcrumbs: Breadcrumb[] = []
  let _user: User | undefined
  let _tags: EventTags = {}
  let _extras: EventExtra = {}

  const MAX_BREADCRUMBS = 100
  const SENTRY_API_VERSION = "7"

  export function init(config: Config): void {
    if (_isInitialized) {
      log.warn("Sentry already initialized")
      return
    }

    _config = {
      ...config,
      environment: config.environment ?? process.env.NODE_ENV ?? "development",
      release: config.release ?? `opencode@${Installation.VERSION}`,
      sampleRate: config.sampleRate ?? 1.0,
      tracesSampleRate: config.tracesSampleRate ?? 0.1,
    }

    _isInitialized = true
    log.info("Sentry initialized", {
      dsn: maskDsn(config.dsn),
      environment: _config.environment,
      release: _config.release,
    })
  }

  export function isInitialized(): boolean {
    return _isInitialized
  }

  export function setUser(user: User | undefined): void {
    _user = user
  }

  export function setTag(key: string, value: string): void {
    _tags[key] = value
  }

  export function setTags(tags: EventTags): void {
    _tags = { ..._tags, ...tags }
  }

  export function setExtra(key: string, value: unknown): void {
    _extras[key] = value
  }

  export function setExtras(extras: EventExtra): void {
    _extras = { ..._extras, ...extras }
  }

  export function addBreadcrumb(breadcrumb: Breadcrumb): void {
    const crumb: Breadcrumb = {
      ...breadcrumb,
      timestamp: breadcrumb.timestamp ?? Date.now() / 1000,
    }
    _breadcrumbs.push(crumb)

    if (_breadcrumbs.length > MAX_BREADCRUMBS) {
      _breadcrumbs = _breadcrumbs.slice(-MAX_BREADCRUMBS)
    }
  }

  export function clearBreadcrumbs(): void {
    _breadcrumbs = []
  }

  export async function captureException(
    error: Error,
    context?: {
      tags?: EventTags
      extras?: EventExtra
      user?: User
      level?: "fatal" | "error" | "warning" | "info" | "debug"
    },
  ): Promise<string | undefined> {
    if (!_isInitialized || !_config) {
      log.debug("Sentry not initialized, skipping exception capture", {
        error: error.message,
      })
      return undefined
    }

    if (Math.random() > (_config.sampleRate ?? 1.0)) {
      return undefined
    }

    const eventId = generateEventId()
    const event = buildEvent(error, eventId, context)

    try {
      await sendEvent(event)
      log.debug("Sentry exception captured", { eventId, error: error.message })
      return eventId
    } catch (sendError) {
      log.error("Failed to send Sentry event", {
        error: sendError instanceof Error ? sendError.message : String(sendError),
      })
      return undefined
    }
  }

  export async function captureMessage(
    message: string,
    level: "fatal" | "error" | "warning" | "info" | "debug" = "info",
    context?: {
      tags?: EventTags
      extras?: EventExtra
      user?: User
    },
  ): Promise<string | undefined> {
    if (!_isInitialized || !_config) {
      log.debug("Sentry not initialized, skipping message capture", { message })
      return undefined
    }

    if (Math.random() > (_config.sampleRate ?? 1.0)) {
      return undefined
    }

    const eventId = generateEventId()
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node" as const,
      level,
      message,
      release: _config.release,
      environment: _config.environment,
      tags: { ..._tags, ...context?.tags },
      extra: { ..._extras, ...context?.extras },
      user: context?.user ?? _user,
      breadcrumbs: _breadcrumbs,
      sdk: {
        name: "opencode-sentry",
        version: Installation.VERSION,
      },
    }

    try {
      await sendEvent(event)
      log.debug("Sentry message captured", { eventId, message })
      return eventId
    } catch (sendError) {
      log.error("Failed to send Sentry event", {
        error: sendError instanceof Error ? sendError.message : String(sendError),
      })
      return undefined
    }
  }

  export function startTransaction(
    name: string,
    op: string,
  ): {
    finish: () => Promise<void>
    setTag: (key: string, value: string) => void
    setData: (key: string, value: unknown) => void
  } {
    const startTime = Date.now() / 1000
    const transactionTags: EventTags = {}
    const transactionData: EventExtra = {}
    const traceId = generateTraceId()
    const spanId = generateSpanId()

    return {
      setTag(key: string, value: string) {
        transactionTags[key] = value
      },
      setData(key: string, value: unknown) {
        transactionData[key] = value
      },
      async finish() {
        if (!_isInitialized || !_config) return

        if (Math.random() > (_config.tracesSampleRate ?? 0.1)) {
          return
        }

        const endTime = Date.now() / 1000
        const transaction = {
          event_id: generateEventId(),
          type: "transaction",
          timestamp: endTime,
          start_timestamp: startTime,
          platform: "node",
          release: _config.release,
          environment: _config.environment,
          transaction: name,
          contexts: {
            trace: {
              trace_id: traceId,
              span_id: spanId,
              op,
            },
          },
          tags: { ..._tags, ...transactionTags },
          extra: { ..._extras, ...transactionData },
          sdk: {
            name: "opencode-sentry",
            version: Installation.VERSION,
          },
        }

        try {
          await sendEvent(transaction)
        } catch (error) {
          log.error("Failed to send Sentry transaction", {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    }
  }

  export function honoErrorHandler(error: Error, c: Context): void {
    const requestContext = {
      tags: {
        method: c.req.method,
        path: c.req.path,
      },
      extras: {
        url: c.req.url,
        headers: sanitizeHeaders(headersToRecord(c.req.raw.headers)),
        query: c.req.query(),
      },
    }

    addBreadcrumb({
      category: "http",
      message: `${c.req.method} ${c.req.path}`,
      level: "error",
      data: {
        url: c.req.url,
        status_code: 500,
      },
    })

    captureException(error, requestContext)
  }

  export function honoMiddleware() {
    return async (c: Context, next: () => Promise<void>) => {
      const transaction = startTransaction(`${c.req.method} ${c.req.path}`, "http.server")

      transaction.setTag("http.method", c.req.method)
      transaction.setTag("http.url", c.req.path)

      addBreadcrumb({
        category: "http",
        message: `${c.req.method} ${c.req.path}`,
        level: "info",
        data: {
          url: c.req.url,
        },
      })

      try {
        await next()
        transaction.setTag("http.status_code", String(c.res.status))
      } catch (error) {
        transaction.setTag("http.status_code", "500")
        throw error
      } finally {
        await transaction.finish()
      }
    }
  }

  function buildEvent(
    error: Error,
    eventId: string,
    context?: {
      tags?: EventTags
      extras?: EventExtra
      user?: User
      level?: "fatal" | "error" | "warning" | "info" | "debug"
    },
  ) {
    return {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node" as const,
      level: context?.level ?? "error",
      release: _config!.release,
      environment: _config!.environment,
      exception: {
        values: [
          {
            type: error.name,
            value: error.message,
            stacktrace: parseStackTrace(error.stack),
          },
        ],
      },
      tags: { ..._tags, ...context?.tags },
      extra: { ..._extras, ...context?.extras },
      user: context?.user ?? _user,
      breadcrumbs: _breadcrumbs,
      sdk: {
        name: "opencode-sentry",
        version: Installation.VERSION,
      },
    }
  }

  function parseStackTrace(stack?: string): { frames: Array<{ filename: string; lineno?: number; colno?: number; function?: string }> } | undefined {
    if (!stack) return undefined

    const lines = stack.split("\n").slice(1)
    const frames = lines
      .map((line) => {
        const match = line.match(/at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?/)
        if (!match) return null
        return {
          function: match[1] || "<anonymous>",
          filename: match[2],
          lineno: parseInt(match[3], 10),
          colno: parseInt(match[4], 10),
        }
      })
      .filter((frame): frame is NonNullable<typeof frame> => frame !== null)
      .reverse()

    return { frames }
  }

  async function sendEvent(event: unknown): Promise<void> {
    if (!_config) return

    const { projectId, publicKey, host } = parseDsn(_config.dsn)
    const url = `${host}/api/${projectId}/store/`

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=${SENTRY_API_VERSION}, sentry_client=opencode-sentry/${Installation.VERSION}, sentry_key=${publicKey}`,
      },
      body: JSON.stringify(event),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Sentry API error: ${response.status} ${text}`)
    }
  }

  function parseDsn(dsn: string): { protocol: string; publicKey: string; host: string; projectId: string } {
    const match = dsn.match(/^(https?):\/\/([^@]+)@([^/]+)\/(.+)$/)
    if (!match) {
      throw new Error("Invalid Sentry DSN format")
    }
    return {
      protocol: match[1],
      publicKey: match[2],
      host: `${match[1]}://${match[3]}`,
      projectId: match[4],
    }
  }

  function maskDsn(dsn: string): string {
    try {
      const { protocol, publicKey, host, projectId } = parseDsn(dsn)
      const maskedKey = publicKey.slice(0, 4) + "***"
      return `${protocol}://${maskedKey}@${host.replace(/^https?:\/\//, "")}/${projectId}`
    } catch {
      return "***"
    }
  }

  function generateEventId(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
  }

  function generateTraceId(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
  }

  function generateSpanId(): string {
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
  }

  function headersToRecord(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {}
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }

  function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sensitiveKeys = ["authorization", "cookie", "x-api-key", "x-auth-token"]
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        result[key] = "[Filtered]"
      } else {
        result[key] = value
      }
    }
    return result
  }
}

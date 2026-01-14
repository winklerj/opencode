import { Log } from "../util/log"
import { Installation } from "../installation"
import type { Context } from "hono"

const log = Log.create({ service: "datadog" })

export namespace Datadog {
  export interface Config {
    apiKey: string
    appKey?: string
    site?: string
    service?: string
    env?: string
    version?: string
    flushIntervalMs?: number
    enabled?: boolean
  }

  export type MetricType = "count" | "gauge" | "rate" | "histogram" | "distribution"

  export interface MetricPoint {
    timestamp: number
    value: number
  }

  export interface Metric {
    metric: string
    type: MetricType
    points: MetricPoint[]
    tags?: string[]
    host?: string
    interval?: number
  }

  export interface Event {
    title: string
    text: string
    priority?: "normal" | "low"
    alertType?: "error" | "warning" | "info" | "success"
    tags?: string[]
    host?: string
    aggregationKey?: string
    sourceTypeName?: string
  }

  export interface ServiceCheck {
    check: string
    status: 0 | 1 | 2 | 3
    timestamp?: number
    hostname?: string
    tags?: string[]
    message?: string
  }

  let _config: Config | undefined
  let _isInitialized = false
  let _metricsBuffer: Metric[] = []
  let _flushInterval: ReturnType<typeof setInterval> | undefined
  let _defaultTags: string[] = []

  const DATADOG_SITES: Record<string, string> = {
    us1: "datadoghq.com",
    us3: "us3.datadoghq.com",
    us5: "us5.datadoghq.com",
    eu1: "datadoghq.eu",
    ap1: "ap1.datadoghq.com",
    gov: "ddog-gov.com",
  }

  const MAX_BUFFER_SIZE = 1000

  export function init(config: Config): void {
    if (_isInitialized) {
      log.warn("Datadog already initialized")
      return
    }

    _config = {
      ...config,
      site: config.site ?? "us1",
      service: config.service ?? "opencode",
      env: config.env ?? process.env.NODE_ENV ?? "development",
      version: config.version ?? Installation.VERSION,
      flushIntervalMs: config.flushIntervalMs ?? 10000,
      enabled: config.enabled ?? true,
    }

    _defaultTags = [
      `service:${_config.service}`,
      `env:${_config.env}`,
      `version:${_config.version}`,
    ]

    if (_config.enabled) {
      _flushInterval = setInterval(() => {
        flush()
      }, _config.flushIntervalMs)
    }

    _isInitialized = true
    log.info("Datadog initialized", {
      site: _config.site,
      service: _config.service,
      env: _config.env,
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
  }

  export function setDefaultTags(tags: string[]): void {
    _defaultTags = [
      ..._defaultTags.filter((t) => t.startsWith("service:") || t.startsWith("env:") || t.startsWith("version:")),
      ...tags,
    ]
  }

  export function increment(metric: string, value: number = 1, tags?: string[]): void {
    submitMetric(metric, "count", value, tags)
  }

  export function decrement(metric: string, value: number = 1, tags?: string[]): void {
    submitMetric(metric, "count", -value, tags)
  }

  export function gauge(metric: string, value: number, tags?: string[]): void {
    submitMetric(metric, "gauge", value, tags)
  }

  export function histogram(metric: string, value: number, tags?: string[]): void {
    submitMetric(metric, "histogram", value, tags)
  }

  export function distribution(metric: string, value: number, tags?: string[]): void {
    submitMetric(metric, "distribution", value, tags)
  }

  export function timing(metric: string, durationMs: number, tags?: string[]): void {
    histogram(metric, durationMs, tags)
  }

  export function startTimer(metric: string, tags?: string[]): () => void {
    const start = performance.now()
    return () => {
      const duration = performance.now() - start
      timing(metric, duration, tags)
    }
  }

  function submitMetric(metric: string, type: MetricType, value: number, tags?: string[]): void {
    if (!_isInitialized || !_config?.enabled) {
      return
    }

    const point: MetricPoint = {
      timestamp: Math.floor(Date.now() / 1000),
      value,
    }

    const metricData: Metric = {
      metric: `opencode.${metric}`,
      type,
      points: [point],
      tags: [..._defaultTags, ...(tags ?? [])],
    }

    _metricsBuffer.push(metricData)

    if (_metricsBuffer.length >= MAX_BUFFER_SIZE) {
      flush()
    }
  }

  export async function flush(): Promise<void> {
    if (!_isInitialized || !_config || _metricsBuffer.length === 0) {
      return
    }

    const metrics = [..._metricsBuffer]
    _metricsBuffer = []

    try {
      await sendMetrics(metrics)
      log.debug("Datadog metrics flushed", { count: metrics.length })
    } catch (error) {
      log.error("Failed to flush Datadog metrics", {
        error: error instanceof Error ? error.message : String(error),
      })
      _metricsBuffer = [...metrics, ..._metricsBuffer].slice(0, MAX_BUFFER_SIZE)
    }
  }

  export async function sendEvent(event: Event): Promise<void> {
    if (!_isInitialized || !_config?.enabled) {
      return
    }

    const payload = {
      title: event.title,
      text: event.text,
      priority: event.priority ?? "normal",
      alert_type: event.alertType ?? "info",
      tags: [..._defaultTags, ...(event.tags ?? [])],
      host: event.host,
      aggregation_key: event.aggregationKey,
      source_type_name: event.sourceTypeName ?? "opencode",
    }

    try {
      const site = DATADOG_SITES[_config.site!] ?? _config.site
      const response = await fetch(`https://api.${site}/api/v1/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "DD-API-KEY": _config.apiKey,
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Datadog API error: ${response.status} ${text}`)
      }

      log.debug("Datadog event sent", { title: event.title })
    } catch (error) {
      log.error("Failed to send Datadog event", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export async function sendServiceCheck(check: ServiceCheck): Promise<void> {
    if (!_isInitialized || !_config?.enabled) {
      return
    }

    const payload = {
      check: `opencode.${check.check}`,
      status: check.status,
      timestamp: check.timestamp ?? Math.floor(Date.now() / 1000),
      host_name: check.hostname,
      tags: [..._defaultTags, ...(check.tags ?? [])],
      message: check.message,
    }

    try {
      const site = DATADOG_SITES[_config.site!] ?? _config.site
      const response = await fetch(`https://api.${site}/api/v1/check_run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "DD-API-KEY": _config.apiKey,
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Datadog API error: ${response.status} ${text}`)
      }

      log.debug("Datadog service check sent", { check: check.check, status: check.status })
    } catch (error) {
      log.error("Failed to send Datadog service check", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function sendMetrics(metrics: Metric[]): Promise<void> {
    if (!_config) return

    const series = metrics.map((m) => ({
      metric: m.metric,
      type: m.type === "count" ? 1 : m.type === "rate" ? 2 : m.type === "gauge" ? 3 : 0,
      points: m.points.map((p) => [p.timestamp, p.value]),
      tags: m.tags,
      host: m.host,
      interval: m.interval,
    }))

    const site = DATADOG_SITES[_config.site!] ?? _config.site
    const response = await fetch(`https://api.${site}/api/v1/series`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "DD-API-KEY": _config.apiKey,
      },
      body: JSON.stringify({ series }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Datadog API error: ${response.status} ${text}`)
    }
  }

  export function honoMiddleware() {
    return async (c: Context, next: () => Promise<void>) => {
      const stopTimer = startTimer("http.request.duration", [
        `method:${c.req.method}`,
        `path:${c.req.path}`,
      ])

      increment("http.request.count", 1, [
        `method:${c.req.method}`,
        `path:${c.req.path}`,
      ])

      try {
        await next()

        increment("http.response.count", 1, [
          `method:${c.req.method}`,
          `path:${c.req.path}`,
          `status:${c.res.status}`,
          `status_class:${Math.floor(c.res.status / 100)}xx`,
        ])
      } catch (error) {
        increment("http.error.count", 1, [
          `method:${c.req.method}`,
          `path:${c.req.path}`,
          `error_type:${error instanceof Error ? error.name : "unknown"}`,
        ])
        throw error
      } finally {
        stopTimer()
      }
    }
  }

  export const Metrics = {
    Agent: {
      spawned(tags?: string[]) {
        increment("agent.spawned", 1, tags)
      },
      completed(tags?: string[]) {
        increment("agent.completed", 1, tags)
      },
      failed(tags?: string[]) {
        increment("agent.failed", 1, tags)
      },
      cancelled(tags?: string[]) {
        increment("agent.cancelled", 1, tags)
      },
      duration(ms: number, tags?: string[]) {
        timing("agent.duration", ms, tags)
      },
      queueSize(size: number, tags?: string[]) {
        gauge("agent.queue_size", size, tags)
      },
      concurrent(count: number, tags?: string[]) {
        gauge("agent.concurrent", count, tags)
      },
    },
    Sandbox: {
      created(tags?: string[]) {
        increment("sandbox.created", 1, tags)
      },
      terminated(tags?: string[]) {
        increment("sandbox.terminated", 1, tags)
      },
      warmPoolSize(size: number, tags?: string[]) {
        gauge("sandbox.warm_pool_size", size, tags)
      },
      warmPoolClaimed(tags?: string[]) {
        increment("sandbox.warm_pool_claimed", 1, tags)
      },
      startupTime(ms: number, tags?: string[]) {
        timing("sandbox.startup_time", ms, tags)
      },
    },
    Session: {
      created(tags?: string[]) {
        increment("session.created", 1, tags)
      },
      promptQueued(tags?: string[]) {
        increment("session.prompt_queued", 1, tags)
      },
      promptExecuted(tags?: string[]) {
        increment("session.prompt_executed", 1, tags)
      },
      queueSize(size: number, tags?: string[]) {
        gauge("session.queue_size", size, tags)
      },
    },
    Multiplayer: {
      userJoined(tags?: string[]) {
        increment("multiplayer.user_joined", 1, tags)
      },
      userLeft(tags?: string[]) {
        increment("multiplayer.user_left", 1, tags)
      },
      activeUsers(count: number, tags?: string[]) {
        gauge("multiplayer.active_users", count, tags)
      },
      lockAcquired(tags?: string[]) {
        increment("multiplayer.lock_acquired", 1, tags)
      },
      lockReleased(tags?: string[]) {
        increment("multiplayer.lock_released", 1, tags)
      },
    },
    Model: {
      request(tags?: string[]) {
        increment("model.request", 1, tags)
      },
      tokens(input: number, output: number, tags?: string[]) {
        histogram("model.tokens.input", input, tags)
        histogram("model.tokens.output", output, tags)
      },
      latency(ms: number, tags?: string[]) {
        timing("model.latency", ms, tags)
      },
      error(tags?: string[]) {
        increment("model.error", 1, tags)
      },
    },
  }
}

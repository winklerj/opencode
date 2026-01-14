/**
 * OpenTelemetry Metrics Implementation
 *
 * Provides metric collection for the hosted agent system including:
 * - Counters for counting events
 * - Histograms for measuring distributions
 * - Gauges for tracking current values
 */

import { Log } from "../util/log"
import { Installation } from "../installation"
import { SpanAttributes } from "./telemetry"

const log = Log.create({ service: "metrics" })

/**
 * Metric type definitions.
 */
export type MetricType = "counter" | "histogram" | "gauge" | "updown_counter"

/**
 * Histogram bucket boundaries for common use cases.
 */
export const HistogramBuckets = {
  /**
   * Latency buckets in milliseconds - good for prompt execution times.
   */
  LATENCY_MS: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],

  /**
   * Startup time buckets in milliseconds - good for sandbox startup times.
   */
  STARTUP_MS: [500, 1000, 2000, 5000, 10000, 20000, 30000],

  /**
   * Git sync duration buckets in milliseconds.
   */
  GIT_SYNC_MS: [100, 500, 1000, 2000, 5000, 10000],

  /**
   * Queue wait time buckets in milliseconds.
   */
  QUEUE_WAIT_MS: [0, 100, 500, 1000, 5000, 10000, 30000],

  /**
   * Snapshot restore time buckets in milliseconds.
   */
  SNAPSHOT_RESTORE_MS: [100, 250, 500, 1000, 2000, 5000],

  /**
   * Size buckets in bytes - good for snapshot sizes.
   */
  SIZE_BYTES: [1024, 10240, 102400, 1048576, 10485760, 104857600],
} as const

/**
 * Metric definition with metadata.
 */
interface MetricDefinition {
  name: string
  type: MetricType
  description: string
  unit: string
  buckets?: number[]
}

/**
 * Well-known metrics for the hosted agent system.
 */
export const MetricDefinitions: Record<string, MetricDefinition> = {
  // Counters
  SESSIONS_CREATED: {
    name: "opencode.sessions.created",
    type: "counter",
    description: "Number of sessions created",
    unit: "1",
  },
  PROMPTS_EXECUTED: {
    name: "opencode.prompts.executed",
    type: "counter",
    description: "Number of prompts executed",
    unit: "1",
  },
  TOOL_CALLS_TOTAL: {
    name: "opencode.tool_calls.total",
    type: "counter",
    description: "Number of tool calls made",
    unit: "1",
  },
  SNAPSHOTS_CREATED: {
    name: "opencode.snapshots.created",
    type: "counter",
    description: "Number of snapshots created",
    unit: "1",
  },
  SANDBOX_CREATED: {
    name: "opencode.sandboxes.created",
    type: "counter",
    description: "Number of sandboxes created",
    unit: "1",
  },
  WARMPOOL_CLAIMS: {
    name: "opencode.warmpool.claims",
    type: "counter",
    description: "Number of sandbox claims from warm pool",
    unit: "1",
  },
  WARMPOOL_MISSES: {
    name: "opencode.warmpool.misses",
    type: "counter",
    description: "Number of warm pool misses requiring cold start",
    unit: "1",
  },
  PR_CREATED: {
    name: "opencode.prs.created",
    type: "counter",
    description: "Number of pull requests created",
    unit: "1",
  },
  PR_MERGED: {
    name: "opencode.prs.merged",
    type: "counter",
    description: "Number of pull requests merged",
    unit: "1",
  },
  SKILLS_INVOKED: {
    name: "opencode.skills.invoked",
    type: "counter",
    description: "Number of skill invocations",
    unit: "1",
  },
  IMAGE_BUILDS: {
    name: "opencode.images.builds",
    type: "counter",
    description: "Number of image builds",
    unit: "1",
  },

  // Histograms
  PROMPT_LATENCY: {
    name: "opencode.prompt.latency",
    type: "histogram",
    description: "Prompt execution latency",
    unit: "ms",
    buckets: HistogramBuckets.LATENCY_MS,
  },
  SANDBOX_STARTUP_TIME: {
    name: "opencode.sandbox.startup_time",
    type: "histogram",
    description: "Time to create and initialize sandbox",
    unit: "ms",
    buckets: HistogramBuckets.STARTUP_MS,
  },
  GIT_SYNC_DURATION: {
    name: "opencode.git_sync.duration",
    type: "histogram",
    description: "Git sync duration",
    unit: "ms",
    buckets: HistogramBuckets.GIT_SYNC_MS,
  },
  SNAPSHOT_RESTORE_TIME: {
    name: "opencode.snapshot.restore_time",
    type: "histogram",
    description: "Time to restore from snapshot",
    unit: "ms",
    buckets: HistogramBuckets.SNAPSHOT_RESTORE_MS,
  },
  PROMPT_QUEUE_WAIT: {
    name: "opencode.prompt.queue_wait",
    type: "histogram",
    description: "Time prompts spend in queue",
    unit: "ms",
    buckets: HistogramBuckets.QUEUE_WAIT_MS,
  },
  TOOL_EXECUTION_TIME: {
    name: "opencode.tool.execution_time",
    type: "histogram",
    description: "Tool execution time",
    unit: "ms",
    buckets: HistogramBuckets.LATENCY_MS,
  },

  // Gauges (implemented as UpDownCounters)
  ACTIVE_SANDBOXES: {
    name: "opencode.sandboxes.active",
    type: "updown_counter",
    description: "Number of active sandboxes",
    unit: "1",
  },
  WARMPOOL_SIZE: {
    name: "opencode.warmpool.size",
    type: "updown_counter",
    description: "Number of sandboxes in warm pool",
    unit: "1",
  },
  QUEUED_PROMPTS: {
    name: "opencode.prompts.queued",
    type: "updown_counter",
    description: "Number of prompts in queue",
    unit: "1",
  },
  CONNECTED_CLIENTS: {
    name: "opencode.clients.connected",
    type: "updown_counter",
    description: "Number of connected clients",
    unit: "1",
  },
  ACTIVE_SESSIONS: {
    name: "opencode.sessions.active",
    type: "updown_counter",
    description: "Number of active sessions",
    unit: "1",
  },
  MULTIPLAYER_USERS: {
    name: "opencode.multiplayer.users",
    type: "updown_counter",
    description: "Number of users in multiplayer sessions",
    unit: "1",
  },
}

/**
 * Metric data point.
 */
interface MetricDataPoint {
  name: string
  type: MetricType
  value: number
  timestamp: number
  attributes: Record<string, string | number | boolean>
  buckets?: number[]
  bucketCounts?: number[]
}

/**
 * Configuration for the metrics system.
 */
export interface MetricsConfig {
  enabled?: boolean
  serviceName?: string
  serviceVersion?: string
  environment?: string
  collectorEndpoint?: string
  exporterType?: "otlp" | "console" | "none"
  flushIntervalMs?: number
  maxExportBatchSize?: number
}

export namespace Metrics {
  let _config: Required<MetricsConfig>
  let _isInitialized = false
  let _dataBuffer: MetricDataPoint[] = []
  let _flushInterval: ReturnType<typeof setInterval> | undefined
  let _defaultAttributes: Record<string, string> = {}

  // Histogram state for aggregation
  const _histogramState = new Map<string, { sum: number; count: number; buckets: Map<number, number> }>()

  // Gauge state
  const _gaugeState = new Map<string, number>()

  const MAX_BUFFER_SIZE = 1000

  /**
   * Initialize the metrics system.
   */
  export function init(config: MetricsConfig = {}): void {
    if (_isInitialized) {
      log.warn("Metrics already initialized")
      return
    }

    _config = {
      enabled: config.enabled ?? true,
      serviceName: config.serviceName ?? "opencode-hosted-agent",
      serviceVersion: config.serviceVersion ?? Installation.VERSION,
      environment: config.environment ?? process.env.NODE_ENV ?? "development",
      collectorEndpoint: config.collectorEndpoint ?? "http://localhost:4317",
      exporterType: config.exporterType ?? "otlp",
      flushIntervalMs: config.flushIntervalMs ?? 15000,
      maxExportBatchSize: config.maxExportBatchSize ?? 500,
    }

    _defaultAttributes = {
      "service.name": _config.serviceName,
      "service.version": _config.serviceVersion,
      "deployment.environment": _config.environment,
    }

    if (_config.enabled && _config.exporterType !== "none") {
      _flushInterval = setInterval(() => {
        flush()
      }, _config.flushIntervalMs)
    }

    _isInitialized = true
    log.info("Metrics initialized", {
      serviceName: _config.serviceName,
      environment: _config.environment,
      exporterType: _config.exporterType,
    })
  }

  /**
   * Check if metrics is initialized.
   */
  export function isInitialized(): boolean {
    return _isInitialized
  }

  /**
   * Get the current configuration.
   */
  export function getConfig(): Required<MetricsConfig> | undefined {
    return _isInitialized ? _config : undefined
  }

  /**
   * Increment a counter metric.
   */
  export function increment(
    metricName: string,
    value: number = 1,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    if (!_isInitialized || !_config.enabled) return

    recordMetric({
      name: metricName,
      type: "counter",
      value,
      timestamp: Date.now(),
      attributes: { ..._defaultAttributes, ...attributes },
    })
  }

  /**
   * Record a histogram value.
   */
  export function recordHistogram(
    metricName: string,
    value: number,
    attributes: Record<string, string | number | boolean> = {},
    buckets?: number[]
  ): void {
    if (!_isInitialized || !_config.enabled) return

    // Find the metric definition for buckets
    const definition = Object.values(MetricDefinitions).find((d) => d.name === metricName)
    const metricBuckets = buckets ?? definition?.buckets ?? HistogramBuckets.LATENCY_MS

    // Update histogram state for aggregation
    const key = `${metricName}:${JSON.stringify(attributes)}`
    let state = _histogramState.get(key)
    if (!state) {
      state = { sum: 0, count: 0, buckets: new Map() }
      for (const bucket of metricBuckets) {
        state.buckets.set(bucket, 0)
      }
      state.buckets.set(Infinity, 0)
      _histogramState.set(key, state)
    }

    state.sum += value
    state.count++

    // Update bucket counts
    for (const bucket of [...metricBuckets, Infinity]) {
      if (value <= bucket) {
        state.buckets.set(bucket, (state.buckets.get(bucket) ?? 0) + 1)
        break
      }
    }

    recordMetric({
      name: metricName,
      type: "histogram",
      value,
      timestamp: Date.now(),
      attributes: { ..._defaultAttributes, ...attributes },
      buckets: metricBuckets,
    })
  }

  /**
   * Update a gauge value.
   */
  export function gauge(
    metricName: string,
    value: number,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    if (!_isInitialized || !_config.enabled) return

    _gaugeState.set(metricName, value)

    recordMetric({
      name: metricName,
      type: "gauge",
      value,
      timestamp: Date.now(),
      attributes: { ..._defaultAttributes, ...attributes },
    })
  }

  /**
   * Increment or decrement an updown counter (for gauges that can go up and down).
   */
  export function updown(
    metricName: string,
    delta: number,
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    if (!_isInitialized || !_config.enabled) return

    const currentValue = _gaugeState.get(metricName) ?? 0
    const newValue = currentValue + delta
    _gaugeState.set(metricName, newValue)

    recordMetric({
      name: metricName,
      type: "updown_counter",
      value: delta,
      timestamp: Date.now(),
      attributes: { ..._defaultAttributes, ...attributes },
    })
  }

  /**
   * Record a metric data point.
   */
  function recordMetric(dataPoint: MetricDataPoint): void {
    _dataBuffer.push(dataPoint)

    if (_dataBuffer.length >= _config.maxExportBatchSize) {
      flush()
    }

    // Prevent buffer overflow
    if (_dataBuffer.length > MAX_BUFFER_SIZE) {
      log.warn(`Metric buffer overflow, dropping oldest ${_dataBuffer.length - MAX_BUFFER_SIZE} data points`)
      _dataBuffer = _dataBuffer.slice(-MAX_BUFFER_SIZE)
    }
  }

  /**
   * Flush metrics to the collector.
   */
  export async function flush(): Promise<void> {
    if (!_isInitialized || !_config.enabled || _dataBuffer.length === 0) return

    const dataPoints = _dataBuffer.splice(0, _config.maxExportBatchSize)

    if (_config.exporterType === "console") {
      for (const dp of dataPoints) {
        log.debug("Metric", {
          name: dp.name,
          type: dp.type,
          value: dp.value,
          attributes: dp.attributes,
        })
      }
      return
    }

    if (_config.exporterType === "otlp") {
      try {
        const body = formatMetricsForOTLP(dataPoints)

        const response = await fetch(`${_config.collectorEndpoint}/v1/metrics`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        })

        if (!response.ok) {
          log.warn(`Failed to export metrics: ${response.status} ${response.statusText}`)
          // Re-add failed data points to buffer for retry
          _dataBuffer.unshift(...dataPoints)
        }
      } catch (error) {
        log.warn(`Failed to export metrics: ${error}`)
        // Re-add failed data points to buffer for retry
        _dataBuffer.unshift(...dataPoints)
      }
    }
  }

  /**
   * Format metrics for OTLP export.
   */
  function formatMetricsForOTLP(dataPoints: MetricDataPoint[]): Record<string, unknown> {
    // Group by metric name and type
    const grouped = new Map<string, MetricDataPoint[]>()
    for (const dp of dataPoints) {
      const key = `${dp.name}:${dp.type}`
      const existing = grouped.get(key) ?? []
      existing.push(dp)
      grouped.set(key, existing)
    }

    const metrics: Record<string, unknown>[] = []

    for (const [key, dps] of grouped) {
      const first = dps[0]
      const definition = Object.values(MetricDefinitions).find((d) => d.name === first.name)

      const metric: Record<string, unknown> = {
        name: first.name,
        description: definition?.description ?? "",
        unit: definition?.unit ?? "1",
      }

      if (first.type === "counter") {
        metric.sum = {
          isMonotonic: true,
          aggregationTemporality: 2, // AGGREGATION_TEMPORALITY_DELTA
          dataPoints: dps.map((dp) => ({
            startTimeUnixNano: (dp.timestamp - 1000) * 1_000_000,
            timeUnixNano: dp.timestamp * 1_000_000,
            asInt: dp.value,
            attributes: formatAttributes(dp.attributes),
          })),
        }
      } else if (first.type === "histogram") {
        metric.histogram = {
          aggregationTemporality: 2, // AGGREGATION_TEMPORALITY_DELTA
          dataPoints: dps.map((dp) => ({
            startTimeUnixNano: (dp.timestamp - 1000) * 1_000_000,
            timeUnixNano: dp.timestamp * 1_000_000,
            count: 1,
            sum: dp.value,
            explicitBounds: dp.buckets ?? HistogramBuckets.LATENCY_MS,
            bucketCounts: dp.bucketCounts ?? computeBucketCounts(dp.value, dp.buckets ?? HistogramBuckets.LATENCY_MS),
            attributes: formatAttributes(dp.attributes),
          })),
        }
      } else if (first.type === "gauge" || first.type === "updown_counter") {
        metric.gauge = {
          dataPoints: dps.map((dp) => ({
            timeUnixNano: dp.timestamp * 1_000_000,
            asInt: dp.value,
            attributes: formatAttributes(dp.attributes),
          })),
        }
      }

      metrics.push(metric)
    }

    return {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: _config.serviceName } },
              { key: "service.version", value: { stringValue: _config.serviceVersion } },
              { key: "deployment.environment", value: { stringValue: _config.environment } },
            ],
          },
          scopeMetrics: [
            {
              scope: { name: "opencode-hosted-agent", version: _config.serviceVersion },
              metrics,
            },
          ],
        },
      ],
    }
  }

  /**
   * Format attributes for OTLP.
   */
  function formatAttributes(attrs: Record<string, string | number | boolean>): Array<Record<string, unknown>> {
    return Object.entries(attrs).map(([key, value]) => ({
      key,
      value:
        typeof value === "string"
          ? { stringValue: value }
          : typeof value === "number"
            ? Number.isInteger(value)
              ? { intValue: value.toString() }
              : { doubleValue: value }
            : { boolValue: value },
    }))
  }

  /**
   * Compute bucket counts for a single value.
   */
  function computeBucketCounts(value: number, buckets: number[]): number[] {
    const counts = new Array(buckets.length + 1).fill(0)
    for (let i = 0; i < buckets.length; i++) {
      if (value <= buckets[i]) {
        counts[i] = 1
        return counts
      }
    }
    counts[counts.length - 1] = 1
    return counts
  }

  /**
   * Get current gauge value.
   */
  export function getGaugeValue(metricName: string): number | undefined {
    return _gaugeState.get(metricName)
  }

  /**
   * Get histogram state for a metric.
   */
  export function getHistogramState(
    metricName: string,
    attributes: Record<string, string | number | boolean> = {}
  ): { sum: number; count: number; buckets: Map<number, number> } | undefined {
    const key = `${metricName}:${JSON.stringify(attributes)}`
    return _histogramState.get(key)
  }

  /**
   * Shutdown the metrics system.
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
    _dataBuffer = []
    _histogramState.clear()
    _gaugeState.clear()
    log.info("Metrics shutdown complete")
  }

  /**
   * Get the number of buffered data points.
   */
  export function getBufferedCount(): number {
    return _dataBuffer.length
  }

  /**
   * Reset the metrics system (for testing).
   */
  export function reset(): void {
    if (_flushInterval) {
      clearInterval(_flushInterval)
      _flushInterval = undefined
    }
    _isInitialized = false
    _dataBuffer = []
    _histogramState.clear()
    _gaugeState.clear()
  }

  // Convenience methods for common metrics

  /**
   * Record session creation.
   */
  export function recordSessionCreated(attributes: { clientType?: string; organizationId?: string } = {}): void {
    increment(MetricDefinitions.SESSIONS_CREATED.name, 1, {
      [SpanAttributes.CLIENT_TYPE]: attributes.clientType ?? "unknown",
      [SpanAttributes.ORGANIZATION_ID]: attributes.organizationId ?? "unknown",
    })
  }

  /**
   * Record prompt execution.
   */
  export function recordPromptExecuted(attributes: {
    sessionId: string
    clientType?: string
    hasTools: boolean
    durationMs: number
  }): void {
    increment(MetricDefinitions.PROMPTS_EXECUTED.name, 1, {
      [SpanAttributes.SESSION_ID]: attributes.sessionId,
      [SpanAttributes.CLIENT_TYPE]: attributes.clientType ?? "unknown",
      "opencode.prompt.has_tools": attributes.hasTools,
    })

    recordHistogram(MetricDefinitions.PROMPT_LATENCY.name, attributes.durationMs, {
      [SpanAttributes.SESSION_ID]: attributes.sessionId,
    })
  }

  /**
   * Record tool call.
   */
  export function recordToolCall(attributes: {
    toolName: string
    blocked: boolean
    syncStatus?: string
    durationMs: number
  }): void {
    increment(MetricDefinitions.TOOL_CALLS_TOTAL.name, 1, {
      [SpanAttributes.TOOL_NAME]: attributes.toolName,
      [SpanAttributes.TOOL_BLOCKED]: attributes.blocked,
      "opencode.tool.sync_status": attributes.syncStatus ?? "synced",
    })

    recordHistogram(MetricDefinitions.TOOL_EXECUTION_TIME.name, attributes.durationMs, {
      [SpanAttributes.TOOL_NAME]: attributes.toolName,
    })
  }

  /**
   * Record sandbox startup.
   */
  export function recordSandboxStartup(attributes: { imageTag: string; fromWarmPool: boolean; durationMs: number }): void {
    increment(MetricDefinitions.SANDBOX_CREATED.name, 1, {
      [SpanAttributes.SANDBOX_IMAGE_TAG]: attributes.imageTag,
      [SpanAttributes.WARMPOOL_HIT]: attributes.fromWarmPool,
    })

    recordHistogram(MetricDefinitions.SANDBOX_STARTUP_TIME.name, attributes.durationMs, {
      [SpanAttributes.WARMPOOL_HIT]: attributes.fromWarmPool,
      [SpanAttributes.SANDBOX_IMAGE_TAG]: attributes.imageTag,
    })

    if (attributes.fromWarmPool) {
      increment(MetricDefinitions.WARMPOOL_CLAIMS.name, 1, {
        [SpanAttributes.SANDBOX_IMAGE_TAG]: attributes.imageTag,
      })
    } else {
      increment(MetricDefinitions.WARMPOOL_MISSES.name, 1, {
        [SpanAttributes.SANDBOX_IMAGE_TAG]: attributes.imageTag,
      })
    }
  }
}

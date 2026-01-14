import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { Telemetry, SpanNames, SpanAttributes, SpanStatusCode } from "./telemetry"
import { Metrics, MetricDefinitions, HistogramBuckets } from "./metrics"
import { TelemetryLog, EventNames, SeverityNumber } from "./log"

describe("Telemetry", () => {
  beforeEach(() => {
    Telemetry.reset()
  })

  afterEach(async () => {
    await Telemetry.shutdown()
  })

  describe("init", () => {
    it("should initialize with default config", () => {
      Telemetry.init()
      expect(Telemetry.isInitialized()).toBe(true)

      const config = Telemetry.getConfig()
      expect(config).toBeDefined()
      expect(config?.serviceName).toBe("opencode-hosted-agent")
      expect(config?.exporterType).toBe("otlp")
    })

    it("should initialize with custom config", () => {
      Telemetry.init({
        serviceName: "test-service",
        environment: "test",
        exporterType: "console",
        sampleRate: 0.5,
      })

      const config = Telemetry.getConfig()
      expect(config?.serviceName).toBe("test-service")
      expect(config?.environment).toBe("test")
      expect(config?.exporterType).toBe("console")
      expect(config?.sampleRate).toBe(0.5)
    })

    it("should not reinitialize if already initialized", () => {
      Telemetry.init({ serviceName: "first" })
      Telemetry.init({ serviceName: "second" })

      const config = Telemetry.getConfig()
      expect(config?.serviceName).toBe("first")
    })
  })

  describe("span operations", () => {
    beforeEach(() => {
      Telemetry.init({ exporterType: "none", sampleRate: 1.0 })
    })

    it("should start and end a span", () => {
      const span = Telemetry.startSpan(SpanNames.SANDBOX_CREATE, {
        attributes: { [SpanAttributes.SESSION_ID]: "session-123" },
      })

      expect(span).not.toBeNull()
      expect(span?.name).toBe("sandbox.create")
      expect(span?.traceId).toHaveLength(32)
      expect(span?.spanId).toHaveLength(16)
      expect(span?.attributes[SpanAttributes.SESSION_ID]).toBe("session-123")

      expect(Telemetry.getActiveSpanCount()).toBe(1)

      Telemetry.endSpan(span)
      expect(span?.endTime).toBeDefined()
      expect(Telemetry.getActiveSpanCount()).toBe(0)
    })

    it("should set span attributes", () => {
      const span = Telemetry.startSpan(SpanNames.PROMPT_EXECUTE)

      Telemetry.setSpanAttributes(span, {
        [SpanAttributes.PROMPT_ID]: "prompt-456",
        [SpanAttributes.USER_ID]: "user-789",
      })

      expect(span?.attributes[SpanAttributes.PROMPT_ID]).toBe("prompt-456")
      expect(span?.attributes[SpanAttributes.USER_ID]).toBe("user-789")

      Telemetry.endSpan(span)
    })

    it("should add events to a span", () => {
      const span = Telemetry.startSpan(SpanNames.TOOL_EXECUTE)

      Telemetry.addSpanEvent(span, "tool.started", { toolName: "read" })
      Telemetry.addSpanEvent(span, "tool.completed")

      expect(span?.events).toHaveLength(2)
      expect(span?.events[0].name).toBe("tool.started")
      expect(span?.events[0].attributes?.toolName).toBe("read")
      expect(span?.events[1].name).toBe("tool.completed")

      Telemetry.endSpan(span)
    })

    it("should set span error", () => {
      const span = Telemetry.startSpan(SpanNames.SANDBOX_GIT_SYNC)
      const error = new Error("Git sync failed")

      Telemetry.setSpanError(span, error)

      expect(span?.status).toBe(SpanStatusCode.ERROR)
      expect(span?.statusMessage).toBe("Git sync failed")
      expect(span?.attributes["exception.type"]).toBe("Error")
      expect(span?.attributes["exception.message"]).toBe("Git sync failed")

      Telemetry.endSpan(span)
    })

    it("should create child spans with parent", () => {
      const parentSpan = Telemetry.startSpan(SpanNames.SANDBOX_CREATE)

      const childSpan = Telemetry.startSpan(SpanNames.SANDBOX_GIT_SYNC, {
        traceId: parentSpan?.traceId,
        parentSpanId: parentSpan?.spanId,
      })

      expect(childSpan?.traceId).toBe(parentSpan?.traceId)
      expect(childSpan?.parentSpanId).toBe(parentSpan?.spanId)
      expect(childSpan?.spanId).not.toBe(parentSpan?.spanId)

      Telemetry.endSpan(childSpan)
      Telemetry.endSpan(parentSpan)
    })
  })

  describe("startActiveSpan", () => {
    beforeEach(() => {
      Telemetry.init({ exporterType: "none", sampleRate: 1.0 })
    })

    it("should execute function and set OK status on success", async () => {
      const result = await Telemetry.startActiveSpan(SpanNames.PROMPT_EXECUTE, async (span) => {
        expect(span).not.toBeNull()
        return "success"
      })

      expect(result).toBe("success")
      expect(Telemetry.getActiveSpanCount()).toBe(0)
    })

    it("should set error status on exception", async () => {
      let capturedSpan: ReturnType<typeof Telemetry.startSpan> | undefined
      const error = new Error("Test error")

      await expect(
        Telemetry.startActiveSpan(SpanNames.PROMPT_EXECUTE, async (span) => {
          capturedSpan = span ?? undefined
          throw error
        })
      ).rejects.toThrow("Test error")

      expect(capturedSpan?.status).toBe(SpanStatusCode.ERROR)
      expect(capturedSpan?.statusMessage).toBe("Test error")
    })
  })

  describe("sampling", () => {
    it("should sample based on sample rate", () => {
      Telemetry.init({ exporterType: "none", sampleRate: 0.0 })

      const span = Telemetry.startSpan(SpanNames.SANDBOX_CREATE)
      expect(span).toBeNull()
    })

    it("should not create spans when disabled", () => {
      Telemetry.init({ enabled: false })

      const span = Telemetry.startSpan(SpanNames.SANDBOX_CREATE)
      expect(span).toBeNull()
    })
  })

  describe("buffer management", () => {
    beforeEach(() => {
      Telemetry.init({ exporterType: "none", sampleRate: 1.0 })
    })

    it("should buffer spans before flush", () => {
      const span = Telemetry.startSpan(SpanNames.SANDBOX_CREATE)
      Telemetry.endSpan(span)

      expect(Telemetry.getBufferedSpanCount()).toBe(1)
    })
  })
})

describe("Metrics", () => {
  beforeEach(() => {
    Metrics.reset()
  })

  afterEach(async () => {
    await Metrics.shutdown()
  })

  describe("init", () => {
    it("should initialize with default config", () => {
      Metrics.init()
      expect(Metrics.isInitialized()).toBe(true)

      const config = Metrics.getConfig()
      expect(config).toBeDefined()
      expect(config?.serviceName).toBe("opencode-hosted-agent")
    })

    it("should initialize with custom config", () => {
      Metrics.init({
        serviceName: "test-metrics",
        exporterType: "console",
      })

      const config = Metrics.getConfig()
      expect(config?.serviceName).toBe("test-metrics")
      expect(config?.exporterType).toBe("console")
    })
  })

  describe("counter operations", () => {
    beforeEach(() => {
      Metrics.init({ exporterType: "none" })
    })

    it("should increment counter", () => {
      Metrics.increment(MetricDefinitions.SESSIONS_CREATED.name, 1, { client: "web" })
      Metrics.increment(MetricDefinitions.SESSIONS_CREATED.name, 2, { client: "slack" })

      expect(Metrics.getBufferedCount()).toBe(2)
    })

    it("should use default value of 1", () => {
      Metrics.increment(MetricDefinitions.PROMPTS_EXECUTED.name)
      expect(Metrics.getBufferedCount()).toBe(1)
    })
  })

  describe("histogram operations", () => {
    beforeEach(() => {
      Metrics.init({ exporterType: "none" })
    })

    it("should record histogram values", () => {
      Metrics.recordHistogram(MetricDefinitions.PROMPT_LATENCY.name, 500)
      Metrics.recordHistogram(MetricDefinitions.PROMPT_LATENCY.name, 1500)
      Metrics.recordHistogram(MetricDefinitions.PROMPT_LATENCY.name, 3000)

      expect(Metrics.getBufferedCount()).toBe(3)

      const state = Metrics.getHistogramState(MetricDefinitions.PROMPT_LATENCY.name)
      expect(state).toBeDefined()
      expect(state?.count).toBe(3)
      expect(state?.sum).toBe(5000)
    })

    it("should use custom buckets", () => {
      const customBuckets = [100, 200, 300]
      Metrics.recordHistogram("custom.histogram", 150, {}, customBuckets)

      expect(Metrics.getBufferedCount()).toBe(1)
    })
  })

  describe("gauge operations", () => {
    beforeEach(() => {
      Metrics.init({ exporterType: "none" })
    })

    it("should set gauge value", () => {
      Metrics.gauge(MetricDefinitions.ACTIVE_SANDBOXES.name, 5)

      expect(Metrics.getGaugeValue(MetricDefinitions.ACTIVE_SANDBOXES.name)).toBe(5)

      Metrics.gauge(MetricDefinitions.ACTIVE_SANDBOXES.name, 10)
      expect(Metrics.getGaugeValue(MetricDefinitions.ACTIVE_SANDBOXES.name)).toBe(10)
    })

    it("should increment/decrement updown counter", () => {
      Metrics.updown(MetricDefinitions.CONNECTED_CLIENTS.name, 1)
      Metrics.updown(MetricDefinitions.CONNECTED_CLIENTS.name, 1)
      Metrics.updown(MetricDefinitions.CONNECTED_CLIENTS.name, -1)

      expect(Metrics.getGaugeValue(MetricDefinitions.CONNECTED_CLIENTS.name)).toBe(1)
    })
  })

  describe("convenience methods", () => {
    beforeEach(() => {
      Metrics.init({ exporterType: "none" })
    })

    it("should record session created", () => {
      Metrics.recordSessionCreated({ clientType: "web", organizationId: "org-123" })
      expect(Metrics.getBufferedCount()).toBe(1)
    })

    it("should record prompt executed", () => {
      Metrics.recordPromptExecuted({
        sessionId: "session-123",
        clientType: "web",
        hasTools: true,
        durationMs: 1500,
      })
      // Counter + histogram = 2 data points
      expect(Metrics.getBufferedCount()).toBe(2)
    })

    it("should record tool call", () => {
      Metrics.recordToolCall({
        toolName: "read",
        blocked: false,
        durationMs: 100,
      })
      // Counter + histogram = 2 data points
      expect(Metrics.getBufferedCount()).toBe(2)
    })

    it("should record sandbox startup", () => {
      Metrics.recordSandboxStartup({
        imageTag: "myrepo:latest",
        fromWarmPool: true,
        durationMs: 2000,
      })
      // sandbox created + startup time histogram + warmpool claims = 3 data points
      expect(Metrics.getBufferedCount()).toBe(3)
    })
  })
})

describe("TelemetryLog", () => {
  beforeEach(() => {
    TelemetryLog.reset()
  })

  afterEach(async () => {
    await TelemetryLog.shutdown()
  })

  describe("init", () => {
    it("should initialize with default config", () => {
      TelemetryLog.init()
      expect(TelemetryLog.isInitialized()).toBe(true)

      const config = TelemetryLog.getConfig()
      expect(config).toBeDefined()
      expect(config?.serviceName).toBe("opencode-hosted-agent")
      expect(config?.minSeverity).toBe(SeverityNumber.INFO)
    })

    it("should initialize with custom config", () => {
      TelemetryLog.init({
        serviceName: "test-logger",
        minSeverity: SeverityNumber.DEBUG,
        exporterType: "console",
      })

      const config = TelemetryLog.getConfig()
      expect(config?.serviceName).toBe("test-logger")
      expect(config?.minSeverity).toBe(SeverityNumber.DEBUG)
    })
  })

  describe("log operations", () => {
    beforeEach(() => {
      TelemetryLog.init({ exporterType: "none", minSeverity: SeverityNumber.DEBUG })
    })

    it("should log info message", () => {
      TelemetryLog.info("Test message", {
        "event.name": EventNames.SANDBOX_CREATED,
        "event.domain": "sandbox",
      })

      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log debug message", () => {
      TelemetryLog.debug("Debug message", {
        "event.name": "test.debug",
        "event.domain": "system",
      })

      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log error with exception", () => {
      const error = new Error("Test error")
      TelemetryLog.errorWithException("Error occurred", error, {
        "event.name": EventNames.PROMPT_FAILED,
        "event.domain": "prompt",
      })

      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should filter logs below min severity", () => {
      TelemetryLog.reset()
      TelemetryLog.init({ exporterType: "none", minSeverity: SeverityNumber.WARN })

      TelemetryLog.debug("Debug message", { "event.name": "test", "event.domain": "system" })
      TelemetryLog.info("Info message", { "event.name": "test", "event.domain": "system" })
      TelemetryLog.warn("Warn message", { "event.name": "test", "event.domain": "system" })

      expect(TelemetryLog.getBufferedCount()).toBe(1) // Only warn
    })
  })

  describe("trace context", () => {
    beforeEach(() => {
      TelemetryLog.init({ exporterType: "none" })
    })

    it("should set and get trace context", () => {
      TelemetryLog.setTraceContext("trace-123", "span-456")

      const context = TelemetryLog.getTraceContext()
      expect(context.traceId).toBe("trace-123")
      expect(context.spanId).toBe("span-456")
    })
  })

  describe("convenience methods", () => {
    beforeEach(() => {
      TelemetryLog.init({ exporterType: "none", minSeverity: SeverityNumber.DEBUG })
    })

    it("should log sandbox created", () => {
      TelemetryLog.logSandboxCreated("session-123", "sandbox-456")
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log prompt queued", () => {
      TelemetryLog.logPromptQueued("session-123", "prompt-456", "user-789")
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log prompt completed", () => {
      TelemetryLog.logPromptCompleted("session-123", "prompt-456", 1500)
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log prompt failed", () => {
      const error = new Error("Prompt error")
      TelemetryLog.logPromptFailed("session-123", "prompt-456", error)
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log tool executed", () => {
      TelemetryLog.logToolExecuted("session-123", "read", false)
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log tool blocked", () => {
      TelemetryLog.logToolExecuted("session-123", "write", true)
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log client connected", () => {
      TelemetryLog.logClientConnected("session-123", "web")
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log user joined multiplayer", () => {
      TelemetryLog.logUserJoined("session-123", "user-456")
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log skill invoked", () => {
      TelemetryLog.logSkillInvoked("session-123", "code-review")
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log image build started", () => {
      TelemetryLog.logImageBuildStarted("myrepo:latest", "github.com/org/repo")
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log image build completed", () => {
      TelemetryLog.logImageBuildCompleted("myrepo:latest", 30000)
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })

    it("should log image build failed", () => {
      const error = new Error("Build failed")
      TelemetryLog.logImageBuildFailed("myrepo:latest", error)
      expect(TelemetryLog.getBufferedCount()).toBe(1)
    })
  })
})

describe("SpanNames and SpanAttributes", () => {
  it("should have all required span names", () => {
    expect(SpanNames.SANDBOX_CREATE).toBe("sandbox.create")
    expect(SpanNames.SANDBOX_GIT_SYNC).toBe("sandbox.git.sync")
    expect(SpanNames.PROMPT_EXECUTE).toBe("prompt.execute")
    expect(SpanNames.TOOL_EXECUTE).toBe("tool.execute")
    expect(SpanNames.WARMPOOL_CLAIM).toBe("warmpool.claim")
  })

  it("should have all required span attributes", () => {
    expect(SpanAttributes.SESSION_ID).toBe("opencode.session.id")
    expect(SpanAttributes.SANDBOX_ID).toBe("opencode.sandbox.id")
    expect(SpanAttributes.GIT_REPO).toBe("vcs.repository.url.full")
    expect(SpanAttributes.WARMPOOL_HIT).toBe("opencode.warmpool.hit")
  })
})

describe("MetricDefinitions", () => {
  it("should have all required metric definitions", () => {
    expect(MetricDefinitions.SESSIONS_CREATED).toBeDefined()
    expect(MetricDefinitions.PROMPTS_EXECUTED).toBeDefined()
    expect(MetricDefinitions.TOOL_CALLS_TOTAL).toBeDefined()
    expect(MetricDefinitions.PROMPT_LATENCY).toBeDefined()
    expect(MetricDefinitions.SANDBOX_STARTUP_TIME).toBeDefined()
    expect(MetricDefinitions.ACTIVE_SANDBOXES).toBeDefined()
    expect(MetricDefinitions.WARMPOOL_SIZE).toBeDefined()
  })

  it("should have correct metric types", () => {
    expect(MetricDefinitions.SESSIONS_CREATED.type).toBe("counter")
    expect(MetricDefinitions.PROMPT_LATENCY.type).toBe("histogram")
    expect(MetricDefinitions.ACTIVE_SANDBOXES.type).toBe("updown_counter")
  })
})

describe("HistogramBuckets", () => {
  it("should have appropriate bucket ranges", () => {
    expect(HistogramBuckets.LATENCY_MS).toEqual([100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000])
    expect(HistogramBuckets.STARTUP_MS).toEqual([500, 1000, 2000, 5000, 10000, 20000, 30000])
    expect(HistogramBuckets.GIT_SYNC_MS).toEqual([100, 500, 1000, 2000, 5000, 10000])
  })
})

describe("EventNames", () => {
  it("should have all required event names", () => {
    expect(EventNames.SANDBOX_CREATED).toBe("sandbox.created")
    expect(EventNames.PROMPT_QUEUED).toBe("prompt.queued")
    expect(EventNames.TOOL_BLOCKED).toBe("tool.blocked")
    expect(EventNames.CLIENT_CONNECTED).toBe("client.connected")
    expect(EventNames.SKILL_INVOKED).toBe("skill.invoked")
  })
})

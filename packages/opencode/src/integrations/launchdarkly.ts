import { Log } from "../util/log"
import { Installation } from "../installation"

const log = Log.create({ service: "launchdarkly" })

export namespace LaunchDarkly {
  export interface Config {
    sdkKey: string
    baseUri?: string
    eventsUri?: string
    streamUri?: string
    flushIntervalMs?: number
    pollIntervalMs?: number
    offline?: boolean
    sendEvents?: boolean
  }

  export interface User {
    key: string
    email?: string
    name?: string
    firstName?: string
    lastName?: string
    avatar?: string
    ip?: string
    country?: string
    anonymous?: boolean
    custom?: Record<string, string | number | boolean>
  }

  export interface EvaluationDetail<T> {
    value: T
    variationIndex: number | null
    reason: EvaluationReason
  }

  export interface EvaluationReason {
    kind: "OFF" | "FALLTHROUGH" | "TARGET_MATCH" | "RULE_MATCH" | "PREREQUISITE_FAILED" | "ERROR"
    ruleIndex?: number
    ruleId?: string
    prerequisiteKey?: string
    errorKind?: "CLIENT_NOT_READY" | "FLAG_NOT_FOUND" | "MALFORMED_FLAG" | "USER_NOT_SPECIFIED" | "EXCEPTION"
  }

  interface FlagValue {
    value: unknown
    variation: number
    version: number
  }

  let _config: Config | undefined
  let _isInitialized = false
  let _flags: Map<string, FlagValue> = new Map()
  let _eventBuffer: unknown[] = []
  let _flushInterval: ReturnType<typeof setInterval> | undefined
  let _pollInterval: ReturnType<typeof setInterval> | undefined
  let _defaultUser: User | undefined

  const MAX_EVENT_BUFFER_SIZE = 500

  export async function init(config: Config): Promise<void> {
    if (_isInitialized) {
      log.warn("LaunchDarkly already initialized")
      return
    }

    _config = {
      ...config,
      baseUri: config.baseUri ?? "https://sdk.launchdarkly.com",
      eventsUri: config.eventsUri ?? "https://events.launchdarkly.com",
      streamUri: config.streamUri ?? "https://stream.launchdarkly.com",
      flushIntervalMs: config.flushIntervalMs ?? 5000,
      pollIntervalMs: config.pollIntervalMs ?? 30000,
      offline: config.offline ?? false,
      sendEvents: config.sendEvents ?? true,
    }

    if (!_config.offline) {
      await fetchFlags()

      _pollInterval = setInterval(() => {
        fetchFlags()
      }, _config.pollIntervalMs)
    }

    if (_config.sendEvents) {
      _flushInterval = setInterval(() => {
        flushEvents()
      }, _config.flushIntervalMs)
    }

    _isInitialized = true
    log.info("LaunchDarkly initialized", {
      offline: _config.offline,
      flagCount: _flags.size,
    })
  }

  export function isInitialized(): boolean {
    return _isInitialized
  }

  export async function shutdown(): Promise<void> {
    if (_flushInterval) {
      clearInterval(_flushInterval)
      _flushInterval = undefined
    }
    if (_pollInterval) {
      clearInterval(_pollInterval)
      _pollInterval = undefined
    }
    await flushEvents()
    _isInitialized = false
    _config = undefined
    _flags.clear()
  }

  export function setDefaultUser(user: User): void {
    _defaultUser = user
  }

  export function boolVariation(key: string, user: User | undefined = undefined, defaultValue = false): boolean {
    const detail = variationDetail(key, user, defaultValue)
    return typeof detail.value === "boolean" ? detail.value : defaultValue
  }

  export function stringVariation(key: string, user: User | undefined = undefined, defaultValue = ""): string {
    const detail = variationDetail(key, user, defaultValue)
    return typeof detail.value === "string" ? detail.value : defaultValue
  }

  export function numberVariation(key: string, user: User | undefined = undefined, defaultValue = 0): number {
    const detail = variationDetail(key, user, defaultValue)
    return typeof detail.value === "number" ? detail.value : defaultValue
  }

  export function jsonVariation<T>(key: string, defaultValue: T, user: User | undefined = undefined): T {
    const detail = variationDetail(key, user, defaultValue)
    return detail.value as T
  }

  export function boolVariationDetail(key: string, user: User | undefined = undefined, defaultValue = false): EvaluationDetail<boolean> {
    const detail = variationDetail(key, user, defaultValue)
    return {
      ...detail,
      value: typeof detail.value === "boolean" ? detail.value : defaultValue,
    }
  }

  export function stringVariationDetail(key: string, user: User | undefined = undefined, defaultValue = ""): EvaluationDetail<string> {
    const detail = variationDetail(key, user, defaultValue)
    return {
      ...detail,
      value: typeof detail.value === "string" ? detail.value : defaultValue,
    }
  }

  export function numberVariationDetail(key: string, user: User | undefined = undefined, defaultValue = 0): EvaluationDetail<number> {
    const detail = variationDetail(key, user, defaultValue)
    return {
      ...detail,
      value: typeof detail.value === "number" ? detail.value : defaultValue,
    }
  }

  function variationDetail<T>(key: string, user: User | undefined, defaultValue: T): EvaluationDetail<T> {
    const effectiveUser = user ?? _defaultUser

    if (!_isInitialized) {
      return {
        value: defaultValue,
        variationIndex: null,
        reason: { kind: "ERROR", errorKind: "CLIENT_NOT_READY" },
      }
    }

    if (!effectiveUser) {
      return {
        value: defaultValue,
        variationIndex: null,
        reason: { kind: "ERROR", errorKind: "USER_NOT_SPECIFIED" },
      }
    }

    const flag = _flags.get(key)
    if (!flag) {
      recordEvaluationEvent(key, effectiveUser, defaultValue, null, { kind: "ERROR", errorKind: "FLAG_NOT_FOUND" })
      return {
        value: defaultValue,
        variationIndex: null,
        reason: { kind: "ERROR", errorKind: "FLAG_NOT_FOUND" },
      }
    }

    const reason: EvaluationReason = { kind: "FALLTHROUGH" }
    recordEvaluationEvent(key, effectiveUser, flag.value as T, flag.variation, reason)

    return {
      value: flag.value as T,
      variationIndex: flag.variation,
      reason,
    }
  }

  export function allFlagsState(user?: User): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    _flags.forEach((flag, key) => {
      result[key] = flag.value
    })
    return result
  }

  export function track(eventName: string, user?: User, data?: unknown, metricValue?: number): void {
    const effectiveUser = user ?? _defaultUser
    if (!effectiveUser || !_config?.sendEvents) return

    const event = {
      kind: "custom",
      key: eventName,
      user: sanitizeUser(effectiveUser),
      data,
      metricValue,
      creationDate: Date.now(),
    }

    _eventBuffer.push(event)

    if (_eventBuffer.length >= MAX_EVENT_BUFFER_SIZE) {
      flushEvents()
    }
  }

  export function identify(user: User): void {
    if (!_config?.sendEvents) return

    const event = {
      kind: "identify",
      user: sanitizeUser(user),
      creationDate: Date.now(),
    }

    _eventBuffer.push(event)
  }

  export function alias(user: User, previousUser: User): void {
    if (!_config?.sendEvents) return

    const event = {
      kind: "alias",
      key: user.key,
      contextKind: "user",
      previousKey: previousUser.key,
      previousContextKind: "user",
      creationDate: Date.now(),
    }

    _eventBuffer.push(event)
  }

  async function fetchFlags(): Promise<void> {
    if (!_config) return

    try {
      const response = await fetch(`${_config.baseUri}/sdk/latest-all`, {
        headers: {
          Authorization: _config.sdkKey,
          "User-Agent": `opencode/${Installation.VERSION}`,
        },
      })

      if (!response.ok) {
        throw new Error(`LaunchDarkly API error: ${response.status}`)
      }

      const data = (await response.json()) as { flags: Record<string, { value: unknown; variation: number; version: number }> }

      _flags.clear()
      for (const [key, flag] of Object.entries(data.flags ?? {})) {
        _flags.set(key, {
          value: flag.value,
          variation: flag.variation,
          version: flag.version,
        })
      }

      log.debug("LaunchDarkly flags fetched", { count: _flags.size })
    } catch (error) {
      log.error("Failed to fetch LaunchDarkly flags", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function recordEvaluationEvent<T>(key: string, user: User, value: T, variationIndex: number | null, reason: EvaluationReason): void {
    if (!_config?.sendEvents) return

    const event = {
      kind: "feature",
      key,
      user: sanitizeUser(user),
      value,
      variation: variationIndex,
      reason,
      creationDate: Date.now(),
    }

    _eventBuffer.push(event)

    if (_eventBuffer.length >= MAX_EVENT_BUFFER_SIZE) {
      flushEvents()
    }
  }

  async function flushEvents(): Promise<void> {
    if (!_config || _eventBuffer.length === 0) return

    const events = [..._eventBuffer]
    _eventBuffer = []

    try {
      const response = await fetch(`${_config.eventsUri}/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: _config.sdkKey,
          "User-Agent": `opencode/${Installation.VERSION}`,
          "X-LaunchDarkly-Event-Schema": "4",
        },
        body: JSON.stringify(events),
      })

      if (!response.ok) {
        throw new Error(`LaunchDarkly API error: ${response.status}`)
      }

      log.debug("LaunchDarkly events flushed", { count: events.length })
    } catch (error) {
      log.error("Failed to flush LaunchDarkly events", {
        error: error instanceof Error ? error.message : String(error),
      })
      _eventBuffer = [...events, ..._eventBuffer].slice(0, MAX_EVENT_BUFFER_SIZE)
    }
  }

  function sanitizeUser(user: User): Record<string, unknown> {
    return {
      key: user.key,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      ip: user.ip,
      country: user.country,
      anonymous: user.anonymous,
      custom: user.custom,
    }
  }

  export const Flags = {
    isEnabled(flag: string, user?: User): boolean {
      return boolVariation(flag, user, false)
    },

    AgentMultiplayer: {
      isEnabled(user?: User): boolean {
        return boolVariation("agent.multiplayer.enabled", user, false)
      },
    },

    WarmPool: {
      isEnabled(user?: User): boolean {
        return boolVariation("sandbox.warm-pool.enabled", user, true)
      },
      maxSize(user?: User): number {
        return numberVariation("sandbox.warm-pool.max-size", user, 5)
      },
    },

    BackgroundAgent: {
      isEnabled(user?: User): boolean {
        return boolVariation("background-agent.enabled", user, true)
      },
      maxConcurrent(user?: User): number {
        return numberVariation("background-agent.max-concurrent", user, 10)
      },
      maxQueueSize(user?: User): number {
        return numberVariation("background-agent.max-queue-size", user, 100)
      },
    },

    Voice: {
      isEnabled(user?: User): boolean {
        return boolVariation("voice.enabled", user, false)
      },
    },

    Desktop: {
      isEnabled(user?: User): boolean {
        return boolVariation("desktop.enabled", user, false)
      },
    },

    Skills: {
      isEnabled(user?: User): boolean {
        return boolVariation("skills.enabled", user, true)
      },
      allowCustom(user?: User): boolean {
        return boolVariation("skills.allow-custom", user, true)
      },
    },

    Integrations: {
      sentryEnabled(user?: User): boolean {
        return boolVariation("integrations.sentry.enabled", user, false)
      },
      datadogEnabled(user?: User): boolean {
        return boolVariation("integrations.datadog.enabled", user, false)
      },
    },
  }
}

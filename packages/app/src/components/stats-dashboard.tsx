import { type ComponentProps, createMemo, For, Show, splitProps } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Tooltip } from "@opencode-ai/ui/tooltip"

/**
 * Live metrics for the stats dashboard
 */
export interface LiveMetrics {
  activeSessions: number
  activeAgents: number
  warmPoolSize: number
  warmPoolTarget: number
  queuedPrompts: number
  runningPrompts: number
}

/**
 * Historical metrics for a time period
 */
export interface HistoricalMetrics {
  period: "hour" | "day" | "week" | "month"
  promptsSent: number
  promptsCompleted: number
  tokensUsed: number
  averageLatency: number
  errorRate: number
  topModels: Array<{ model: string; count: number }>
  topAgents: Array<{ agent: string; count: number }>
}

/**
 * Usage breakdown by model/agent
 */
export interface UsageBreakdown {
  label: string
  value: number
  percentage: number
  color?: string
}

export interface StatsDashboardProps extends ComponentProps<"div"> {
  /**
   * Live metrics
   */
  live?: LiveMetrics
  /**
   * Historical metrics for selected period
   */
  historical?: HistoricalMetrics
  /**
   * Loading state
   */
  loading?: boolean
  /**
   * Error message if any
   */
  error?: string
}

/**
 * StatsDashboard displays usage metrics and statistics.
 *
 * Features:
 * - Live metrics: active sessions, agents, warm pool
 * - Historical metrics: prompts, tokens, latency
 * - Usage breakdown by model/agent
 */
export function StatsDashboard(props: StatsDashboardProps) {
  const [local, others] = splitProps(props, [
    "live",
    "historical",
    "loading",
    "error",
    "class",
    "classList",
  ])

  const warmPoolPercentage = createMemo(() => {
    if (!local.live) return 0
    if (local.live.warmPoolTarget === 0) return 100
    return Math.round((local.live.warmPoolSize / local.live.warmPoolTarget) * 100)
  })

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  const formatLatency = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(1)}%`
  }

  return (
    <div
      data-component="stats-dashboard"
      classList={{
        "flex flex-col gap-6": true,
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      {/* Error state */}
      <Show when={local.error}>
        <div class="flex items-center gap-2 p-3 rounded-md bg-surface-error-base text-text-error-base">
          <Icon name="circle-x" size="small" />
          <span class="text-13-regular">{local.error}</span>
        </div>
      </Show>

      {/* Live Metrics */}
      <Show when={local.live}>
        {(live) => (
          <section class="flex flex-col gap-3">
            <h3 class="text-13-medium text-text-strong">Live</h3>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                icon="layers"
                label="Active Sessions"
                value={live().activeSessions}
                loading={local.loading}
              />
              <StatCard
                icon="brain"
                label="Active Agents"
                value={live().activeAgents}
                loading={local.loading}
              />
              <StatCard
                icon="list"
                label="Queued Prompts"
                value={live().queuedPrompts}
                loading={local.loading}
              />
              <StatCard
                icon="play"
                label="Running"
                value={live().runningPrompts}
                loading={local.loading}
              />
            </div>

            {/* Warm Pool Gauge */}
            <div class="flex items-center gap-4 p-3 rounded-md bg-surface-base">
              <ProgressCircle
                percentage={warmPoolPercentage()}
                size={48}
                strokeWidth={4}
              />
              <div class="flex flex-col">
                <span class="text-14-medium text-text-strong">Warm Pool</span>
                <span class="text-12-regular text-text-weak">
                  {live().warmPoolSize} / {live().warmPoolTarget} sandboxes ready
                </span>
              </div>
            </div>
          </section>
        )}
      </Show>

      {/* Historical Metrics */}
      <Show when={local.historical}>
        {(historical) => (
          <section class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <h3 class="text-13-medium text-text-strong">
                Last {historical().period}
              </h3>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard
                icon="chat"
                label="Prompts Sent"
                value={formatNumber(historical().promptsSent)}
                loading={local.loading}
              />
              <StatCard
                icon="check"
                label="Completed"
                value={formatNumber(historical().promptsCompleted)}
                loading={local.loading}
              />
              <StatCard
                icon="document-text"
                label="Tokens Used"
                value={formatNumber(historical().tokensUsed)}
                loading={local.loading}
              />
              <StatCard
                icon="clock"
                label="Avg Latency"
                value={formatLatency(historical().averageLatency)}
                loading={local.loading}
              />
              <StatCard
                icon="alert-triangle"
                label="Error Rate"
                value={formatPercentage(historical().errorRate)}
                variant={historical().errorRate > 0.05 ? "warning" : "default"}
                loading={local.loading}
              />
            </div>

            {/* Top Models */}
            <Show when={historical().topModels.length > 0}>
              <div class="flex flex-col gap-2 p-3 rounded-md bg-surface-base">
                <span class="text-12-medium text-text-strong">Top Models</span>
                <div class="flex flex-col gap-1">
                  <For each={historical().topModels.slice(0, 5)}>
                    {(item) => (
                      <UsageBar
                        label={item.model}
                        value={item.count}
                        max={historical().topModels[0].count}
                      />
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Top Agents */}
            <Show when={historical().topAgents.length > 0}>
              <div class="flex flex-col gap-2 p-3 rounded-md bg-surface-base">
                <span class="text-12-medium text-text-strong">Top Agents</span>
                <div class="flex flex-col gap-1">
                  <For each={historical().topAgents.slice(0, 5)}>
                    {(item) => (
                      <UsageBar
                        label={item.agent}
                        value={item.count}
                        max={historical().topAgents[0].count}
                      />
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </section>
        )}
      </Show>

      {/* Empty state */}
      <Show when={!local.live && !local.historical && !local.loading}>
        <div class="flex flex-col items-center gap-2 py-8 text-center">
          <Icon name="server" class="size-10 text-icon-weak" />
          <p class="text-14-regular text-text-weak">No statistics available</p>
          <p class="text-12-regular text-text-subtle">
            Start using the agent to see usage metrics
          </p>
        </div>
      </Show>

      {/* Loading state */}
      <Show when={local.loading && !local.live && !local.historical}>
        <div class="flex items-center justify-center py-8">
          <div class="animate-spin size-6 border-2 border-icon-base border-t-transparent rounded-full" />
        </div>
      </Show>
    </div>
  )
}

/**
 * Individual stat card
 */
interface StatCardProps {
  icon: string
  label: string
  value: string | number
  variant?: "default" | "warning" | "error" | "success"
  loading?: boolean
}

function StatCard(props: StatCardProps) {
  return (
    <div
      classList={{
        "flex flex-col gap-1 p-3 rounded-md bg-surface-base": true,
        "border-l-2 border-icon-warning-base": props.variant === "warning",
        "border-l-2 border-icon-error-base": props.variant === "error",
        "border-l-2 border-icon-success-base": props.variant === "success",
      }}
    >
      <div class="flex items-center gap-2">
        <Icon name={props.icon as any} size="small" class="text-icon-base" />
        <span class="text-11-regular text-text-weak">{props.label}</span>
      </div>
      <Show
        when={!props.loading}
        fallback={
          <div class="h-6 w-16 bg-surface-raised-base animate-pulse rounded" />
        }
      >
        <span class="text-18-medium text-text-strong">{props.value}</span>
      </Show>
    </div>
  )
}

/**
 * Usage bar for breakdown display
 */
interface UsageBarProps {
  label: string
  value: number
  max: number
  color?: string
}

function UsageBar(props: UsageBarProps) {
  const percentage = () => {
    if (props.max === 0) return 0
    return Math.round((props.value / props.max) * 100)
  }

  return (
    <div class="flex items-center gap-2">
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between mb-1">
          <span class="text-12-regular text-text-base truncate">{props.label}</span>
          <span class="text-11-regular text-text-weak">{props.value}</span>
        </div>
        <div class="h-1.5 rounded-full bg-surface-raised-base overflow-hidden">
          <div
            class="h-full rounded-full bg-icon-primary transition-all"
            style={{
              width: `${percentage()}%`,
              "background-color": props.color,
            }}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Compact stats widget for sidebar
 */
export interface StatsCompactProps extends Omit<ComponentProps<"button">, "onClick"> {
  activeSessions: number
  activeAgents: number
  queuedPrompts: number
  onClick?: () => void
}

export function StatsCompact(props: StatsCompactProps) {
  const [local, others] = splitProps(props, [
    "activeSessions",
    "activeAgents",
    "queuedPrompts",
    "onClick",
    "class",
    "classList",
  ])

  return (
    <button
      type="button"
      onClick={() => local.onClick?.()}
      data-component="stats-compact"
      classList={{
        "flex items-center gap-4 px-3 py-2 rounded-md transition-colors": true,
        "hover:bg-surface-raised-base-hover": true,
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      <Tooltip placement="top" value="Active sessions">
        <div class="flex items-center gap-1">
          <Icon name="task" size="small" class="text-icon-base" />
          <span class="text-12-medium text-text-base">{local.activeSessions}</span>
        </div>
      </Tooltip>
      <Tooltip placement="top" value="Active agents">
        <div class="flex items-center gap-1">
          <Icon name="brain" size="small" class="text-icon-base" />
          <span class="text-12-medium text-text-base">{local.activeAgents}</span>
        </div>
      </Tooltip>
      <Tooltip placement="top" value="Queued prompts">
        <div class="flex items-center gap-1">
          <Icon name="bullet-list" size="small" class="text-icon-base" />
          <span class="text-12-medium text-text-base">{local.queuedPrompts}</span>
        </div>
      </Tooltip>
    </button>
  )
}

import { type ComponentProps, createMemo, For, Show, splitProps, createSignal } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"
import { Avatar } from "@opencode-ai/ui/avatar"

/**
 * Prompt in the queue
 */
export interface QueuedPrompt {
  id: string
  userID: string
  userName: string
  userColor: string
  userAvatar?: string
  content: string
  queuedAt: number
  priority: number
}

/**
 * Currently executing prompt
 */
export interface ExecutingPrompt {
  id: string
  userID: string
  userName: string
  userColor: string
  userAvatar?: string
  content: string
  startedAt: number
}

export interface PromptQueueProps extends Omit<ComponentProps<"div">, "onCancel"> {
  /**
   * List of queued prompts
   */
  queue: QueuedPrompt[]
  /**
   * Currently executing prompt (if any)
   */
  executing?: ExecutingPrompt
  /**
   * ID of the current user (for permission checks)
   */
  currentUserID?: string
  /**
   * Whether the current user can manage the queue
   */
  canManage?: boolean
  /**
   * Called when user cancels a prompt
   */
  onCancel?: (promptID: string) => void
  /**
   * Called when user reorders a prompt
   */
  onReorder?: (promptID: string, newIndex: number) => void
  /**
   * Called when user wants to start next prompt
   */
  onStartNext?: () => void
  /**
   * Whether the queue is in a loading state
   */
  loading?: boolean
  /**
   * Maximum items to show before scrolling
   */
  maxVisible?: number
}

/**
 * PromptQueue displays the queue of prompts waiting to be executed.
 *
 * Features:
 * - Shows currently executing prompt with progress
 * - Lists queued prompts with user avatars
 * - Allows canceling own prompts
 * - Shows relative time since queued
 */
export function PromptQueue(props: PromptQueueProps) {
  const [local, others] = splitProps(props, [
    "queue",
    "executing",
    "currentUserID",
    "canManage",
    "onCancel",
    "onReorder",
    "onStartNext",
    "loading",
    "maxVisible",
    "class",
    "classList",
  ])

  const [expanded, setExpanded] = createSignal(false)

  const visibleQueue = createMemo(() => {
    const max = local.maxVisible ?? 5
    if (expanded() || local.queue.length <= max) {
      return local.queue
    }
    return local.queue.slice(0, max)
  })

  const hiddenCount = createMemo(() => {
    const max = local.maxVisible ?? 5
    if (expanded() || local.queue.length <= max) {
      return 0
    }
    return local.queue.length - max
  })

  const canCancelPrompt = (prompt: QueuedPrompt) => {
    return local.currentUserID === prompt.userID || local.canManage
  }

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return "just now"
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  const formatElapsed = (startedAt: number) => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000)
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes}:${secs.toString().padStart(2, "0")}`
  }

  return (
    <div
      data-component="prompt-queue"
      classList={{
        "flex flex-col gap-2": true,
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      {/* Currently executing prompt */}
      <Show when={local.executing}>
        {(executing) => (
          <div class="flex flex-col gap-2 p-3 rounded-md bg-surface-info-base border border-border-info-base">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="relative">
                  <Avatar
                    fallback={executing().userName}
                    src={executing().userAvatar}
                    background={executing().userColor}
                    foreground="#ffffff"
                    size="small"
                  />
                  <div class="absolute -bottom-0.5 -right-0.5 size-2 bg-icon-success-base rounded-full animate-pulse" />
                </div>
                <span class="text-12-medium text-text-strong">{executing().userName}</span>
                <span class="text-12-regular text-text-weak">is running</span>
              </div>
              <span class="text-12-regular text-text-weak font-mono">
                {formatElapsed(executing().startedAt)}
              </span>
            </div>
            <p class="text-13-regular text-text-base line-clamp-2">{executing().content}</p>
          </div>
        )}
      </Show>

      {/* Queue header */}
      <Show when={local.queue.length > 0}>
        <div class="flex items-center justify-between px-1">
          <div class="flex items-center gap-2">
            <Icon name="bullet-list" size="small" class="text-icon-base" />
            <span class="text-12-medium text-text-strong">Queue</span>
            <span class="text-12-regular text-text-weak">({local.queue.length})</span>
          </div>
          <Show when={!local.executing && local.canManage}>
            <Button
              variant="ghost"
              size="small"
              onClick={() => local.onStartNext?.()}
              disabled={local.loading}
            >
              <Icon name="chevron-right" size="small" />
              Start next
            </Button>
          </Show>
        </div>
      </Show>

      {/* Queue list */}
      <Show when={local.queue.length > 0}>
        <div class="flex flex-col gap-1">
          <For each={visibleQueue()}>
            {(prompt, index) => (
              <div
                class="flex items-center gap-3 p-2 rounded-md bg-surface-base hover:bg-surface-raised-base-hover transition-colors group"
                draggable={local.canManage}
                onDragStart={(e) => {
                  e.dataTransfer?.setData("text/plain", prompt.id)
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const draggedID = e.dataTransfer?.getData("text/plain")
                  if (draggedID && draggedID !== prompt.id) {
                    local.onReorder?.(draggedID, index())
                  }
                }}
              >
                {/* Position indicator */}
                <div class="flex items-center justify-center size-5 rounded bg-surface-raised-base">
                  <span class="text-11-medium text-text-weak">{index() + 1}</span>
                </div>

                {/* User avatar */}
                <Avatar
                  fallback={prompt.userName}
                  src={prompt.userAvatar}
                  background={prompt.userColor}
                  foreground="#ffffff"
                  size="small"
                />

                {/* Prompt content */}
                <div class="flex-1 min-w-0">
                  <p class="text-13-regular text-text-base truncate">{prompt.content}</p>
                  <div class="flex items-center gap-2 text-11-regular text-text-weak">
                    <span>{prompt.userName}</span>
                    <span>·</span>
                    <span>{formatTimeAgo(prompt.queuedAt)}</span>
                    <Show when={prompt.priority > 0}>
                      <span>·</span>
                      <span class="text-text-warning-base">priority {prompt.priority}</span>
                    </Show>
                  </div>
                </div>

                {/* Actions */}
                <Show when={canCancelPrompt(prompt)}>
                  <Tooltip placement="left" value="Cancel prompt">
                    <IconButton
                      icon="close"
                      variant="ghost"
                      class="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => local.onCancel?.(prompt.id)}
                    />
                  </Tooltip>
                </Show>
              </div>
            )}
          </For>

          {/* Show more button */}
          <Show when={hiddenCount() > 0}>
            <button
              type="button"
              class="flex items-center justify-center gap-1 p-2 rounded-md hover:bg-surface-raised-base-hover transition-colors"
              onClick={() => setExpanded(true)}
            >
              <span class="text-12-regular text-text-weak">
                Show {hiddenCount()} more
              </span>
              <Icon name="chevron-down" size="small" class="text-icon-base" />
            </button>
          </Show>

          <Show when={expanded() && local.queue.length > (local.maxVisible ?? 5)}>
            <button
              type="button"
              class="flex items-center justify-center gap-1 p-2 rounded-md hover:bg-surface-raised-base-hover transition-colors"
              onClick={() => setExpanded(false)}
            >
              <span class="text-12-regular text-text-weak">Show less</span>
              <Icon name="chevron-down" size="small" class="text-icon-base rotate-180" />
            </button>
          </Show>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={local.queue.length === 0 && !local.executing}>
        <div class="flex flex-col items-center gap-2 py-6 text-center">
          <Icon name="bullet-list" class="size-8 text-icon-weak" />
          <p class="text-13-regular text-text-weak">No prompts in queue</p>
          <p class="text-12-regular text-text-subtle">
            Prompts submitted by users will appear here
          </p>
        </div>
      </Show>

      {/* Loading overlay */}
      <Show when={local.loading}>
        <div class="absolute inset-0 bg-surface-raised-stronger-non-alpha/50 flex items-center justify-center rounded-md">
          <div class="animate-spin size-5 border-2 border-icon-base border-t-transparent rounded-full" />
        </div>
      </Show>
    </div>
  )
}

/**
 * Compact version of the prompt queue for sidebars
 */
export interface PromptQueueCompactProps extends Omit<ComponentProps<"button">, "onClick"> {
  queueLength: number
  executing?: boolean
  onClick?: () => void
}

export function PromptQueueCompact(props: PromptQueueCompactProps) {
  const [local, others] = splitProps(props, [
    "queueLength",
    "executing",
    "onClick",
    "class",
    "classList",
  ])

  return (
    <button
      type="button"
      onClick={() => local.onClick?.()}
      data-component="prompt-queue-compact"
      classList={{
        "flex items-center gap-2 px-2 py-1 rounded-md transition-colors": true,
        "hover:bg-surface-raised-base-hover": true,
        "bg-surface-info-base": local.executing,
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      <Show
        when={local.executing}
        fallback={<Icon name="bullet-list" size="small" class="text-icon-base" />}
      >
        <div class="relative">
          <Icon name="chevron-right" size="small" class="text-icon-info-active" />
          <div class="absolute -top-0.5 -right-0.5 size-1.5 bg-icon-success-base rounded-full animate-pulse" />
        </div>
      </Show>
      <span class="text-12-regular text-text-base">
        <Show when={local.executing} fallback={`${local.queueLength} queued`}>
          Running
          <Show when={local.queueLength > 0}> · {local.queueLength} queued</Show>
        </Show>
      </span>
    </button>
  )
}

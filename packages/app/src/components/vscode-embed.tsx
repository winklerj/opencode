import {
  type ComponentProps,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  splitProps,
} from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"

/**
 * Editor status
 */
export type EditorStatus = "stopped" | "starting" | "running" | "stopping" | "error"

export interface VSCodeEmbedProps extends Omit<ComponentProps<"div">, "onError" | "onLoad"> {
  /**
   * URL to the code-server instance
   */
  url?: string
  /**
   * Current status of the editor
   */
  status: EditorStatus
  /**
   * Error message if status is "error"
   */
  error?: string
  /**
   * Sandbox ID for the editor
   */
  sandboxID: string
  /**
   * Called when user requests to start the editor
   */
  onStart?: () => void
  /**
   * Called when user requests to stop the editor
   */
  onStop?: () => void
  /**
   * Called when editor finishes loading
   */
  onLoad?: () => void
  /**
   * Called when there's an error loading the editor
   */
  onError?: (error: Error) => void
  /**
   * Whether to show the toolbar
   */
  showToolbar?: boolean
  /**
   * Whether to allow full-screen mode
   */
  allowFullscreen?: boolean
}

/**
 * VSCodeEmbed embeds a code-server instance in an iframe.
 *
 * Features:
 * - Lazy loading with status indicator
 * - Error handling and retry
 * - Full-screen support
 * - Start/stop controls
 */
export function VSCodeEmbed(props: VSCodeEmbedProps) {
  const [local, others] = splitProps(props, [
    "url",
    "status",
    "error",
    "sandboxID",
    "onStart",
    "onStop",
    "onLoad",
    "onError",
    "showToolbar",
    "allowFullscreen",
    "class",
    "classList",
  ])

  const [loaded, setLoaded] = createSignal(false)
  const [fullscreen, setFullscreen] = createSignal(false)
  let iframeRef: HTMLIFrameElement | undefined
  let containerRef: HTMLDivElement | undefined

  const isReady = () => local.status === "running" && !!local.url

  // Handle iframe load
  const handleLoad = () => {
    setLoaded(true)
    local.onLoad?.()
  }

  // Handle iframe error
  const handleError = () => {
    const error = new Error("Failed to load editor")
    local.onError?.(error)
  }

  // Reset loaded state when URL changes
  createEffect(
    on(
      () => local.url,
      () => {
        setLoaded(false)
      },
    ),
  )

  // Handle fullscreen changes
  const handleFullscreenChange = () => {
    setFullscreen(document.fullscreenElement === containerRef)
  }

  onMount(() => {
    document.addEventListener("fullscreenchange", handleFullscreenChange)
  })

  onCleanup(() => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange)
  })

  const toggleFullscreen = async () => {
    if (!containerRef) return

    try {
      if (fullscreen()) {
        await document.exitFullscreen()
      } else {
        await containerRef.requestFullscreen()
      }
    } catch {
      // Fullscreen not supported or denied
    }
  }

  const openInNewTab = () => {
    if (local.url) {
      window.open(local.url, "_blank")
    }
  }

  return (
    <div
      ref={containerRef}
      data-component="vscode-embed"
      classList={{
        "relative flex flex-col size-full bg-surface-base": true,
        "fullscreen-container": fullscreen(),
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      {/* Toolbar */}
      <Show when={local.showToolbar !== false}>
        <div class="flex items-center justify-between px-3 py-2 border-b border-border-base bg-surface-raised-stronger-non-alpha">
          <div class="flex items-center gap-2">
            <Icon name="code" size="small" class="text-icon-base" />
            <span class="text-12-medium text-text-strong">Editor</span>
            <Show when={local.status === "running"}>
              <div class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-success-base">
                <div class="size-1.5 bg-icon-success-base rounded-full" />
                <span class="text-10-regular text-text-success-base">Running</span>
              </div>
            </Show>
          </div>

          <div class="flex items-center gap-1">
            <Show when={isReady()}>
              <Tooltip placement="bottom" value="Open in new tab">
                <IconButton
                  icon="square-arrow-top-right"
                  variant="ghost"
                  onClick={openInNewTab}
                />
              </Tooltip>
              <Show when={local.allowFullscreen !== false}>
                <Tooltip placement="bottom" value={fullscreen() ? "Exit fullscreen" : "Fullscreen"}>
                  <IconButton
                    icon={fullscreen() ? "collapse" : "expand"}
                    variant="ghost"
                    onClick={toggleFullscreen}
                  />
                </Tooltip>
              </Show>
            </Show>
            <Show when={local.status === "running"}>
              <Tooltip placement="bottom" value="Stop editor">
                <IconButton
                  icon="stop"
                  variant="ghost"
                  onClick={() => local.onStop?.()}
                />
              </Tooltip>
            </Show>
          </div>
        </div>
      </Show>

      {/* Content area */}
      <div class="relative flex-1 overflow-hidden">
        {/* Loading/Starting state */}
        <Show when={local.status === "starting" || (local.status === "running" && !loaded())}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface-base z-10">
            <div class="animate-spin size-8 border-2 border-icon-base border-t-transparent rounded-full" />
            <div class="flex flex-col items-center gap-1">
              <span class="text-14-regular text-text-strong">
                {local.status === "starting" ? "Starting editor..." : "Loading editor..."}
              </span>
              <span class="text-12-regular text-text-weak">
                This may take a few moments
              </span>
            </div>
          </div>
        </Show>

        {/* Stopped state */}
        <Show when={local.status === "stopped"}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface-base">
            <div class="flex flex-col items-center gap-2">
              <Icon name="code" class="size-12 text-icon-weak" />
              <span class="text-14-regular text-text-strong">Editor not running</span>
              <span class="text-12-regular text-text-weak">
                Start the editor to view and modify code
              </span>
            </div>
            <Button variant="primary" onClick={() => local.onStart?.()}>
              <Icon name="chevron-right" size="small" />
              Start Editor
            </Button>
          </div>
        </Show>

        {/* Error state */}
        <Show when={local.status === "error"}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface-base">
            <div class="flex flex-col items-center gap-2 max-w-sm text-center">
              <Icon name="circle-x" class="size-12 text-icon-error-base" />
              <span class="text-14-regular text-text-strong">Failed to start editor</span>
              <span class="text-12-regular text-text-weak">
                {local.error ?? "An unknown error occurred"}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <Button variant="primary" onClick={() => local.onStart?.()}>
                <Icon name="enter" size="small" />
                Retry
              </Button>
            </div>
          </div>
        </Show>

        {/* Stopping state */}
        <Show when={local.status === "stopping"}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface-base z-10">
            <div class="animate-spin size-8 border-2 border-icon-base border-t-transparent rounded-full" />
            <span class="text-14-regular text-text-strong">Stopping editor...</span>
          </div>
        </Show>

        {/* Iframe */}
        <Show when={isReady() && local.url}>
          <iframe
            ref={iframeRef}
            src={local.url}
            onLoad={handleLoad}
            onError={handleError}
            title={`Code Editor - ${local.sandboxID}`}
            allow="clipboard-read; clipboard-write"
            classList={{
              "size-full border-0": true,
              "opacity-0": !loaded(),
              "opacity-100": loaded(),
            }}
            style={{ transition: "opacity 0.2s ease-in-out" }}
          />
        </Show>
      </div>
    </div>
  )
}

/**
 * Compact editor status indicator
 */
export interface EditorStatusBadgeProps extends Omit<ComponentProps<"button">, "onClick"> {
  status: EditorStatus
  onClick?: () => void
}

export function EditorStatusBadge(props: EditorStatusBadgeProps) {
  const [local, others] = splitProps(props, ["status", "onClick", "class", "classList"])

  const getStatusConfig = () => {
    switch (local.status) {
      case "running":
        return { icon: "code", color: "success", label: "Editor" }
      case "starting":
        return { icon: "code", color: "info", label: "Starting" }
      case "stopping":
        return { icon: "code", color: "warning", label: "Stopping" }
      case "error":
        return { icon: "circle-x", color: "error", label: "Error" }
      default:
        return { icon: "code", color: "neutral", label: "Editor" }
    }
  }

  const config = () => getStatusConfig()

  return (
    <button
      type="button"
      onClick={() => local.onClick?.()}
      data-component="editor-status-badge"
      classList={{
        "flex items-center gap-2 px-2 py-1 rounded-md transition-colors": true,
        "hover:bg-surface-raised-base-hover": true,
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      <Icon
        name={config().icon as any}
        size="small"
        classList={{
          "text-icon-base": config().color === "neutral",
          "text-icon-success-base": config().color === "success",
          "text-icon-info-active": config().color === "info",
          "text-icon-warning-base": config().color === "warning",
          "text-icon-error-base": config().color === "error",
          "animate-spin": local.status === "starting" || local.status === "stopping",
        }}
      />
      <span class="text-12-regular text-text-base">{config().label}</span>
      <Show when={local.status === "running"}>
        <div class="size-1.5 bg-icon-success-base rounded-full" />
      </Show>
    </button>
  )
}

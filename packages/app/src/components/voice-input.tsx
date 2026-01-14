import {
  type ComponentProps,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
  splitProps,
} from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"

/**
 * Voice recognition status
 */
export type VoiceStatus = "idle" | "starting" | "listening" | "processing" | "error"

/**
 * Transcript segment from voice recognition
 */
export interface TranscriptSegment {
  text: string
  isFinal: boolean
  confidence: number
  timestamp: number
}

export interface VoiceInputProps extends Omit<ComponentProps<"div">, "onSubmit"> {
  /**
   * Current voice recognition status
   */
  status: VoiceStatus
  /**
   * Current transcript text
   */
  transcript?: string
  /**
   * Whether the transcript is final
   */
  isFinal?: boolean
  /**
   * Error message if status is "error"
   */
  error?: string
  /**
   * Called when user starts voice input
   */
  onStart?: () => void
  /**
   * Called when user stops voice input
   */
  onStop?: () => void
  /**
   * Called when user submits the transcript
   */
  onSubmit?: (text: string) => void
  /**
   * Called when user cancels voice input
   */
  onCancel?: () => void
  /**
   * Whether to auto-submit when silence detected
   */
  autoSubmit?: boolean
  /**
   * Whether to show waveform visualization
   */
  showWaveform?: boolean
}

/**
 * VoiceInput provides a voice-to-text interface for prompts.
 *
 * Features:
 * - Push-to-talk or continuous listening
 * - Real-time transcript display
 * - Audio level visualization
 * - Auto-submit on silence (optional)
 */
export function VoiceInput(props: VoiceInputProps) {
  const [local, others] = splitProps(props, [
    "status",
    "transcript",
    "isFinal",
    "error",
    "onStart",
    "onStop",
    "onSubmit",
    "onCancel",
    "autoSubmit",
    "showWaveform",
    "class",
    "classList",
  ])

  const [audioLevel, setAudioLevel] = createSignal(0)
  let animationFrame: number | undefined

  // Simulate audio level for visualization
  createEffect(
    on(
      () => local.status,
      (status) => {
        if (status === "listening") {
          const animate = () => {
            // Simulate audio levels with some randomness
            const level = Math.random() * 0.6 + 0.2
            setAudioLevel(level)
            animationFrame = requestAnimationFrame(animate)
          }
          animate()
        } else {
          setAudioLevel(0)
          if (animationFrame) {
            cancelAnimationFrame(animationFrame)
          }
        }
      },
    ),
  )

  onCleanup(() => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
    }
  })

  const isActive = () => local.status === "listening" || local.status === "processing"
  const canSubmit = () => local.transcript && local.transcript.trim().length > 0

  const handleToggle = () => {
    if (isActive()) {
      local.onStop?.()
    } else {
      local.onStart?.()
    }
  }

  const handleSubmit = () => {
    if (canSubmit()) {
      local.onSubmit?.(local.transcript!)
    }
  }

  return (
    <div
      data-component="voice-input"
      classList={{
        "flex flex-col gap-3": true,
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      {/* Main voice button and waveform */}
      <div class="flex items-center gap-4">
        {/* Voice toggle button */}
        <Tooltip
          placement="top"
          value={isActive() ? "Stop listening" : "Start voice input"}
        >
          <button
            type="button"
            onClick={handleToggle}
            classList={{
              "relative flex items-center justify-center size-12 rounded-full transition-all": true,
              "bg-surface-base hover:bg-surface-raised-base-hover": !isActive(),
              "bg-icon-error-base hover:bg-icon-error-base-hover": isActive(),
            }}
            disabled={local.status === "starting" || local.status === "processing"}
          >
            <Show
              when={local.status !== "starting"}
              fallback={
                <div class="animate-spin size-5 border-2 border-white border-t-transparent rounded-full" />
              }
            >
              <Icon
                name={isActive() ? "stop" : "speech-bubble"}
                class={isActive() ? "text-white" : "text-icon-base"}
              />
            </Show>

            {/* Pulsing ring when listening */}
            <Show when={local.status === "listening"}>
              <div
                class="absolute inset-0 rounded-full border-2 border-icon-error-base animate-ping"
                style={{ "animation-duration": "1.5s" }}
              />
            </Show>
          </button>
        </Tooltip>

        {/* Waveform visualization */}
        <Show when={local.showWaveform && isActive()}>
          <div class="flex items-center gap-0.5 h-8">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                class="w-1 bg-icon-primary rounded-full transition-all"
                style={{
                  height: `${Math.max(4, audioLevel() * 32 * Math.sin((i / 12) * Math.PI + Date.now() / 100))}px`,
                }}
              />
            ))}
          </div>
        </Show>

        {/* Status indicator */}
        <div class="flex items-center gap-2">
          <Show when={local.status === "listening"}>
            <div class="flex items-center gap-2">
              <div class="size-2 bg-icon-error-base rounded-full animate-pulse" />
              <span class="text-12-regular text-text-weak">Listening...</span>
            </div>
          </Show>
          <Show when={local.status === "processing"}>
            <div class="flex items-center gap-2">
              <div class="animate-spin size-3 border-2 border-icon-base border-t-transparent rounded-full" />
              <span class="text-12-regular text-text-weak">Processing...</span>
            </div>
          </Show>
          <Show when={local.status === "idle" && !local.transcript}>
            <span class="text-12-regular text-text-subtle">
              Click to start voice input
            </span>
          </Show>
        </div>
      </div>

      {/* Transcript display */}
      <Show when={local.transcript}>
        <div
          classList={{
            "flex flex-col gap-2 p-3 rounded-md": true,
            "bg-surface-base": local.isFinal,
            "bg-surface-info-base border border-dashed border-border-info-base": !local.isFinal,
          }}
        >
          <div class="flex items-start justify-between gap-2">
            <p class="text-14-regular text-text-base flex-1">{local.transcript}</p>
            <Show when={!local.isFinal}>
              <span class="text-10-regular text-text-subtle uppercase">Live</span>
            </Show>
          </div>

          {/* Action buttons when we have a final transcript */}
          <Show when={local.isFinal && canSubmit()}>
            <div class="flex items-center gap-2">
              <Button variant="primary" size="small" onClick={handleSubmit}>
                <Icon name="arrow-up" size="small" />
                Send
              </Button>
              <Button variant="ghost" size="small" onClick={() => local.onCancel?.()}>
                Cancel
              </Button>
            </div>
          </Show>
        </div>
      </Show>

      {/* Error display */}
      <Show when={local.status === "error" && local.error}>
        <div class="flex items-center gap-2 p-3 rounded-md bg-surface-error-base">
          <Icon name="circle-x" size="small" class="text-icon-error-base" />
          <span class="text-13-regular text-text-error-base">{local.error}</span>
          <Button
            variant="ghost"
            size="small"
            class="ml-auto"
            onClick={() => local.onStart?.()}
          >
            Retry
          </Button>
        </div>
      </Show>
    </div>
  )
}

/**
 * Compact voice button for embedding in other inputs
 */
export interface VoiceButtonProps extends Omit<ComponentProps<"button">, "onToggle"> {
  status: VoiceStatus
  onToggle?: () => void
}

export function VoiceButton(props: VoiceButtonProps) {
  const [local, others] = splitProps(props, ["status", "onToggle", "class", "classList"])

  const isActive = () => local.status === "listening" || local.status === "processing"

  return (
    <Tooltip placement="top" value={isActive() ? "Stop" : "Voice input"}>
      <IconButton
        icon={isActive() ? "stop" : "speech-bubble"}
        variant={isActive() ? "primary" : "ghost"}
        onClick={() => local.onToggle?.()}
        disabled={local.status === "starting"}
        classList={{
          "relative": true,
          ...(local.classList ?? {}),
          [local.class ?? ""]: !!local.class,
        }}
        {...others}
      >
        <Show when={local.status === "starting"}>
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="animate-spin size-4 border-2 border-current border-t-transparent rounded-full" />
          </div>
        </Show>
        <Show when={local.status === "listening"}>
          <div class="absolute -top-0.5 -right-0.5 size-2 bg-icon-error-base rounded-full animate-pulse" />
        </Show>
      </IconButton>
    </Tooltip>
  )
}

/**
 * Voice input modal overlay
 */
export interface VoiceInputModalProps {
  open: boolean
  status: VoiceStatus
  transcript?: string
  isFinal?: boolean
  error?: string
  onStart?: () => void
  onStop?: () => void
  onSubmit?: (text: string) => void
  onClose?: () => void
}

export function VoiceInputModal(props: VoiceInputModalProps) {
  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <div
          class="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={() => props.onClose?.()}
        />

        {/* Modal content */}
        <div class="relative bg-surface-raised-stronger-non-alpha rounded-xl p-6 shadow-xl max-w-md w-full mx-4">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-16-medium text-text-strong">Voice Input</h2>
            <IconButton
              icon="close"
              variant="ghost"
              onClick={() => props.onClose?.()}
            />
          </div>

          <VoiceInput
            status={props.status}
            transcript={props.transcript}
            isFinal={props.isFinal}
            error={props.error}
            onStart={props.onStart}
            onStop={props.onStop}
            onSubmit={props.onSubmit}
            onCancel={props.onClose}
            showWaveform
          />

          <p class="mt-4 text-12-regular text-text-subtle text-center">
            Press Escape to cancel
          </p>
        </div>
      </div>
    </Show>
  )
}

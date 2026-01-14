import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed"
    platform: string
  }>
  prompt(): Promise<void>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }
}

const DISMISSED_KEY = "opencode-pwa-install-dismissed"
const DISMISSED_EXPIRY_DAYS = 7

function wasDismissedRecently(): boolean {
  const dismissed = localStorage.getItem(DISMISSED_KEY)
  if (!dismissed) return false
  const dismissedAt = parseInt(dismissed, 10)
  const expiryMs = DISMISSED_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  return Date.now() - dismissedAt < expiryMs
}

function markDismissed(): void {
  localStorage.setItem(DISMISSED_KEY, Date.now().toString())
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = createSignal<BeforeInstallPromptEvent | null>(null)
  const [showPrompt, setShowPrompt] = createSignal(false)
  const [isInstalled, setIsInstalled] = createSignal(false)

  onMount(() => {
    // Check if already installed as PWA
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true)
      return
    }

    // Check if on iOS (needs special handling)
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream

    // Listen for the beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: BeforeInstallPromptEvent) => {
      e.preventDefault()
      setDeferredPrompt(e)

      // Only show prompt if not dismissed recently
      if (!wasDismissedRecently()) {
        // Delay showing the prompt to not interrupt initial load
        setTimeout(() => setShowPrompt(true), 3000)
      }
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)

    // Handle app installed event
    const handleAppInstalled = () => {
      setIsInstalled(true)
      setShowPrompt(false)
      setDeferredPrompt(null)
    }

    window.addEventListener("appinstalled", handleAppInstalled)

    // For iOS, show manual install instructions after delay
    if (isIOS && !wasDismissedRecently()) {
      setTimeout(() => setShowPrompt(true), 5000)
    }

    onCleanup(() => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
      window.removeEventListener("appinstalled", handleAppInstalled)
    })
  })

  const handleInstall = async () => {
    const prompt = deferredPrompt()
    if (prompt) {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === "accepted") {
        setShowPrompt(false)
      }
      setDeferredPrompt(null)
    }
  }

  const handleDismiss = () => {
    markDismissed()
    setShowPrompt(false)
  }

  const isIOS = () =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream

  return (
    <Show when={showPrompt() && !isInstalled()}>
      <div class="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-50 animate-in slide-in-from-bottom-4 duration-300">
        <div class="bg-surface-raised-base rounded-lg shadow-lg border border-border-weak-base p-4">
          <div class="flex items-start gap-3">
            <div class="flex-shrink-0 w-10 h-10 bg-surface-interactive-base rounded-lg flex items-center justify-center">
              <Icon name="download" class="w-5 h-5 text-text-interactive-base" />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-14-medium text-text-strong">Install OpenCode</h3>
              <p class="text-12-regular text-text-base mt-1">
                <Show when={isIOS()} fallback="Install the app for a better mobile experience.">
                  Tap the share button and select "Add to Home Screen" to install.
                </Show>
              </p>
            </div>
            <IconButton
              icon="close"
              variant="ghost"
              size="normal"
              class="flex-shrink-0 -mt-1 -mr-1"
              onClick={handleDismiss}
            />
          </div>
          <Show when={!isIOS()}>
            <div class="flex gap-2 mt-3">
              <Button variant="ghost" size="small" class="flex-1" onClick={handleDismiss}>
                Not now
              </Button>
              <Button variant="primary" size="small" class="flex-1" onClick={handleInstall}>
                Install
              </Button>
            </div>
          </Show>
          <Show when={isIOS()}>
            <div class="flex items-center gap-2 mt-3 text-12-regular text-text-subtle">
              <Icon name="share" class="w-4 h-4" />
              <span>Tap Share, then "Add to Home Screen"</span>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}

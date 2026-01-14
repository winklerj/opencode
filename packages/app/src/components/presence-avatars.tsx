import { type ComponentProps, createMemo, For, Show, splitProps } from "solid-js"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Icon } from "@opencode-ai/ui/icon"

/**
 * User presence information for multiplayer sessions
 */
export interface PresenceUser {
  id: string
  name: string
  email?: string
  avatar?: string
  color: string
  cursor?: {
    file?: string
    line?: number
    column?: number
  }
  isEditing?: boolean
}

export interface PresenceAvatarsProps extends ComponentProps<"div"> {
  /**
   * List of users in the session
   */
  users: PresenceUser[]
  /**
   * ID of the current user (for highlighting)
   */
  currentUserID?: string
  /**
   * ID of the user holding the edit lock
   */
  editLockHolder?: string
  /**
   * Maximum number of avatars to show before collapsing
   */
  maxVisible?: number
  /**
   * Size of the avatars
   */
  size?: "small" | "normal" | "large"
  /**
   * Click handler for a user avatar
   */
  onUserClick?: (user: PresenceUser) => void
}

/**
 * PresenceAvatars displays multiplayer user presence as a stack of avatars.
 *
 * Features:
 * - Shows user avatars with their assigned colors
 * - Indicates which user holds the edit lock
 * - Shows cursor position on hover
 * - Collapses excess users with a +N indicator
 */
export function PresenceAvatars(props: PresenceAvatarsProps) {
  const [local, others] = splitProps(props, [
    "users",
    "currentUserID",
    "editLockHolder",
    "maxVisible",
    "size",
    "onUserClick",
    "class",
    "classList",
  ])

  const maxVisible = () => local.maxVisible ?? 5

  const visibleUsers = createMemo(() => {
    const users = local.users
    if (users.length <= maxVisible()) {
      return users
    }
    return users.slice(0, maxVisible())
  })

  const overflowCount = createMemo(() => {
    const users = local.users
    if (users.length <= maxVisible()) {
      return 0
    }
    return users.length - maxVisible()
  })

  const overflowUsers = createMemo(() => {
    const users = local.users
    if (users.length <= maxVisible()) {
      return []
    }
    return users.slice(maxVisible())
  })

  const getTooltipContent = (user: PresenceUser) => {
    const parts: string[] = [user.name]

    if (user.id === local.editLockHolder) {
      parts.push("(editing)")
    }

    if (user.cursor?.file) {
      const location = user.cursor.line
        ? `${user.cursor.file}:${user.cursor.line}`
        : user.cursor.file
      parts.push(`at ${location}`)
    }

    return parts.join(" ")
  }

  return (
    <div
      data-component="presence-avatars"
      classList={{
        "flex items-center -space-x-2": true,
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      <For each={visibleUsers()}>
        {(user) => (
          <Tooltip placement="bottom" value={getTooltipContent(user)}>
            <button
              type="button"
              onClick={() => local.onUserClick?.(user)}
              classList={{
                "relative ring-2 ring-surface-raised-stronger-non-alpha rounded-full transition-all": true,
                "hover:ring-border-strong-base hover:z-10": true,
                "ring-icon-success-base!": user.id === local.editLockHolder,
              }}
            >
              <Avatar
                fallback={user.name}
                src={user.avatar}
                background={user.color}
                foreground="#ffffff"
                size={local.size ?? "normal"}
              />
              <Show when={user.id === local.editLockHolder}>
                <div class="absolute -bottom-0.5 -right-0.5 size-3 bg-icon-success-base rounded-full flex items-center justify-center">
                  <Icon name="pencil-line" class="size-2 text-white" />
                </div>
              </Show>
              <Show when={user.id === local.currentUserID}>
                <div class="absolute -top-0.5 -left-0.5 size-2 bg-icon-primary rounded-full" />
              </Show>
            </button>
          </Tooltip>
        )}
      </For>
      <Show when={overflowCount() > 0}>
        <Tooltip
          placement="bottom"
          value={
            <div class="flex flex-col gap-1">
              <For each={overflowUsers()}>
                {(user) => (
                  <div class="flex items-center gap-2">
                    <div
                      class="size-2 rounded-full"
                      style={{ "background-color": user.color }}
                    />
                    <span>{user.name}</span>
                  </div>
                )}
              </For>
            </div>
          }
        >
          <div
            classList={{
              "relative flex items-center justify-center rounded-full bg-surface-base border border-border-base": true,
              "size-6": local.size === "small",
              "size-8": !local.size || local.size === "normal",
              "size-10": local.size === "large",
            }}
          >
            <span class="text-11-medium text-text-weak">+{overflowCount()}</span>
          </div>
        </Tooltip>
      </Show>
    </div>
  )
}

/**
 * PresenceCursor displays a user's cursor position indicator.
 * Can be used in editor overlays to show where other users are editing.
 */
export interface PresenceCursorProps extends ComponentProps<"div"> {
  user: PresenceUser
  animate?: boolean
}

export function PresenceCursor(props: PresenceCursorProps) {
  const [local, others] = splitProps(props, ["user", "animate", "class", "classList"])

  return (
    <div
      data-component="presence-cursor"
      classList={{
        "flex items-center gap-1 pointer-events-none": true,
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      {...others}
    >
      <div
        classList={{
          "w-0.5 h-5 rounded-full": true,
          "animate-pulse": local.animate,
        }}
        style={{ "background-color": local.user.color }}
      />
      <div
        class="px-1.5 py-0.5 rounded text-10-medium text-white whitespace-nowrap"
        style={{ "background-color": local.user.color }}
      >
        {local.user.name}
      </div>
    </div>
  )
}

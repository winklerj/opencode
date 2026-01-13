/**
 * Block Kit UI Builder for Slack responses.
 *
 * Provides type-safe builders for common Slack message layouts:
 * - Status messages (processing, complete, error)
 * - Progress updates
 * - Code snippets
 * - Action buttons
 * - Session information
 */

import type { ThreadConversation, RepositoryContext } from "./types"

/**
 * Slack Block types
 */
export interface Block {
  type: string
  [key: string]: unknown
}

export interface TextObject {
  type: "plain_text" | "mrkdwn"
  text: string
  emoji?: boolean
}

export interface SectionBlock extends Block {
  type: "section"
  text?: TextObject
  fields?: TextObject[]
  accessory?: Block
}

export interface ContextBlock extends Block {
  type: "context"
  elements: Array<TextObject | { type: "image"; image_url: string; alt_text: string }>
}

export interface DividerBlock extends Block {
  type: "divider"
}

export interface ActionsBlock extends Block {
  type: "actions"
  elements: Array<ButtonElement | SelectElement>
}

export interface ButtonElement {
  type: "button"
  text: TextObject
  action_id: string
  value?: string
  style?: "primary" | "danger"
  url?: string
}

export interface SelectElement {
  type: "static_select"
  placeholder?: TextObject
  action_id: string
  options: Array<{
    text: TextObject
    value: string
  }>
}

export interface HeaderBlock extends Block {
  type: "header"
  text: TextObject
}

/**
 * Message attachment with blocks for Block Kit responses
 */
export interface BlockKitMessage {
  text?: string
  blocks?: Block[]
  attachments?: Array<{
    color?: string
    blocks?: Block[]
  }>
  thread_ts?: string
  unfurl_links?: boolean
  unfurl_media?: boolean
}

/**
 * Block Kit builder namespace
 */
export namespace BlockKit {
  /**
   * Create a text object
   */
  export function text(content: string, markdown = true): TextObject {
    return {
      type: markdown ? "mrkdwn" : "plain_text",
      text: content,
      emoji: !markdown,
    }
  }

  /**
   * Create a section block
   */
  export function section(content: string | TextObject, fields?: string[]): SectionBlock {
    const block: SectionBlock = {
      type: "section",
      text: typeof content === "string" ? text(content) : content,
    }
    if (fields) {
      block.fields = fields.map((f) => text(f))
    }
    return block
  }

  /**
   * Create a context block
   */
  export function context(...elements: string[]): ContextBlock {
    return {
      type: "context",
      elements: elements.map((e) => text(e)),
    }
  }

  /**
   * Create a divider block
   */
  export function divider(): DividerBlock {
    return { type: "divider" }
  }

  /**
   * Create a header block
   */
  export function header(content: string): HeaderBlock {
    return {
      type: "header",
      text: text(content, false),
    }
  }

  /**
   * Create a button element
   */
  export function button(
    label: string,
    actionId: string,
    options?: { value?: string; style?: "primary" | "danger"; url?: string },
  ): ButtonElement {
    return {
      type: "button",
      text: text(label, false),
      action_id: actionId,
      value: options?.value,
      style: options?.style,
      url: options?.url,
    }
  }

  /**
   * Create an actions block
   */
  export function actions(...elements: Array<ButtonElement | SelectElement>): ActionsBlock {
    return {
      type: "actions",
      elements,
    }
  }

  /**
   * Build a processing status message
   */
  export function processingMessage(task: string, thread?: ThreadConversation): BlockKitMessage {
    const blocks: Block[] = [section(`:hourglass_flowing_sand: *Processing*\n${task}`)]

    if (thread?.repository?.repository) {
      blocks.push(context(`Repository: ${thread.repository.repository}`))
    }

    blocks.push(
      actions(
        button("Cancel", "cancel_task", { style: "danger", value: thread?.threadTs }),
        button("View Details", "view_details", { value: thread?.sessionID }),
      ),
    )

    return {
      text: `Processing: ${task}`,
      blocks,
    }
  }

  /**
   * Build a progress update message
   */
  export function progressMessage(step: string, progress: number, details?: string): BlockKitMessage {
    const progressBar = buildProgressBar(progress)

    const blocks: Block[] = [section(`:gear: *${step}*`), section(progressBar)]

    if (details) {
      blocks.push(context(details))
    }

    return {
      text: `Progress: ${step} (${Math.round(progress * 100)}%)`,
      blocks,
    }
  }

  /**
   * Build a completion message
   */
  export function completeMessage(summary: string, options?: { prUrl?: string; artifacts?: string[] }): BlockKitMessage {
    const blocks: Block[] = [section(`:white_check_mark: *Complete*\n${summary}`)]

    if (options?.artifacts && options.artifacts.length > 0) {
      blocks.push(divider())
      blocks.push(section("*Artifacts:*"))
      for (const artifact of options.artifacts) {
        blocks.push(context(`• ${artifact}`))
      }
    }

    if (options?.prUrl) {
      blocks.push(divider())
      blocks.push(
        actions(button("View Pull Request", "view_pr", { style: "primary", url: options.prUrl })),
      )
    }

    return {
      text: `Complete: ${summary}`,
      blocks,
    }
  }

  /**
   * Build an error message
   */
  export function errorMessage(error: string, details?: string): BlockKitMessage {
    const blocks: Block[] = [section(`:x: *Error*\n${error}`)]

    if (details) {
      blocks.push(context(details))
    }

    blocks.push(
      actions(button("Retry", "retry_task", { style: "primary" }), button("Get Help", "get_help")),
    )

    return {
      text: `Error: ${error}`,
      blocks,
      attachments: [
        {
          color: "#ff0000",
          blocks: [],
        },
      ],
    }
  }

  /**
   * Build a code snippet message
   */
  export function codeMessage(code: string, language?: string, filename?: string): BlockKitMessage {
    const header = filename ? `*${filename}*` : "Code"
    const codeBlock = "```" + (language ?? "") + "\n" + code + "\n```"

    return {
      text: filename ?? "Code snippet",
      blocks: [section(header), section(codeBlock)],
    }
  }

  /**
   * Build a session info message
   */
  export function sessionInfoMessage(thread: ThreadConversation): BlockKitMessage {
    const statusEmoji = getStatusEmoji(thread.status)
    const fields = [
      `*Status:* ${statusEmoji} ${thread.status}`,
      `*Messages:* ${thread.messageCount}`,
      `*Started:* <!date^${Math.floor(thread.startedAt / 1000)}^{date_short_pretty} at {time}|${new Date(thread.startedAt).toISOString()}>`,
    ]

    if (thread.sessionID) {
      fields.push(`*Session:* \`${thread.sessionID.slice(0, 8)}...\``)
    }

    if (thread.repository?.repository) {
      fields.push(`*Repository:* ${thread.repository.repository}`)
    }

    const blocks: Block[] = [header("Session Information"), section("", fields)]

    if (thread.errorMessage) {
      blocks.push(divider())
      blocks.push(section(`:warning: ${thread.errorMessage}`))
    }

    return {
      text: `Session: ${thread.status}`,
      blocks,
    }
  }

  /**
   * Build a welcome/help message
   */
  export function welcomeMessage(): BlockKitMessage {
    return {
      text: "Welcome to OpenCode!",
      blocks: [
        header("Welcome to OpenCode! :wave:"),
        section(
          "I'm your AI coding assistant. Mention me in a message to start a conversation about your code.",
        ),
        divider(),
        section("*Here's how to get started:*"),
        section(
          "1. Mention me with a task: `@OpenCode fix the bug in auth.ts`\n" +
            "2. I'll work on it in the background\n" +
            "3. Reply in the thread for follow-ups",
        ),
        divider(),
        section("*Tips:*"),
        context(
          "• Include GitHub links for context",
          "• Use threads for multi-turn conversations",
          "• React with :white_check_mark: when done",
        ),
      ],
    }
  }

  /**
   * Build a repository context message
   */
  export function repositoryContextMessage(repo: RepositoryContext): BlockKitMessage {
    const confidence = Math.round(repo.confidence * 100)
    const sourceLabel = getSourceLabel(repo.source)

    const blocks: Block[] = [
      section(
        repo.repository
          ? `:package: Working with *${repo.repository}*${repo.branch ? ` (${repo.branch})` : ""}`
          : ":question: No repository detected",
      ),
      context(`Source: ${sourceLabel} • Confidence: ${confidence}%`),
    ]

    if (!repo.repository || repo.confidence < 0.5) {
      blocks.push(
        actions(
          button("Set Repository", "set_repository", { style: "primary" }),
          button("Use Default", "use_default"),
        ),
      )
    }

    return {
      text: repo.repository ?? "No repository",
      blocks,
    }
  }

  /**
   * Build a progress bar string
   */
  function buildProgressBar(progress: number): string {
    const width = 20
    const filled = Math.round(progress * width)
    const empty = width - filled
    const bar = "█".repeat(filled) + "░".repeat(empty)
    return `\`${bar}\` ${Math.round(progress * 100)}%`
  }

  /**
   * Get emoji for thread status
   */
  function getStatusEmoji(status: ThreadConversation["status"]): string {
    switch (status) {
      case "active":
        return ":large_blue_circle:"
      case "processing":
        return ":hourglass_flowing_sand:"
      case "waiting":
        return ":eyes:"
      case "completed":
        return ":white_check_mark:"
      case "error":
        return ":x:"
      default:
        return ":grey_question:"
    }
  }

  /**
   * Get label for repository source
   */
  function getSourceLabel(source: RepositoryContext["source"]): string {
    switch (source) {
      case "channel_topic":
        return "Channel topic"
      case "channel_name":
        return "Channel name"
      case "mention":
        return "Message mention"
      case "link":
        return "GitHub link"
      case "history":
        return "Thread history"
      case "default":
        return "Default"
      default:
        return "Unknown"
    }
  }
}

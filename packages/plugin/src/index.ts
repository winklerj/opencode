import type {
  Event,
  createOpencodeClient,
  Project,
  Model,
  Provider,
  Permission,
  UserMessage,
  Message,
  Part,
  Auth,
  Config,
} from "@opencode-ai/sdk"

import type { BunShell } from "./shell"
import { type ToolDefinition } from "./tool"

export * from "./tool"

export type ProviderContext = {
  source: "env" | "config" | "custom" | "api"
  info: Provider
  options: Record<string, any>
}

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  $: BunShell
}

export type Plugin = (input: PluginInput) => Promise<Hooks>

export type AuthHook = {
  provider: string
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: (
    | {
        type: "oauth"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              condition?: (inputs: Record<string, string>) => boolean
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              condition?: (inputs: Record<string, string>) => boolean
            }
        >
        authorize(inputs?: Record<string, string>): Promise<AuthOuathResult>
      }
    | {
        type: "api"
        label: string
        prompts?: Array<
          | {
              type: "text"
              key: string
              message: string
              placeholder?: string
              validate?: (value: string) => string | undefined
              condition?: (inputs: Record<string, string>) => boolean
            }
          | {
              type: "select"
              key: string
              message: string
              options: Array<{
                label: string
                value: string
                hint?: string
              }>
              condition?: (inputs: Record<string, string>) => boolean
            }
        >
        authorize?(inputs?: Record<string, string>): Promise<
          | {
              type: "success"
              key: string
              provider?: string
            }
          | {
              type: "failed"
            }
        >
      }
  )[]
}

export type AuthOuathResult = { url: string; instructions: string } & (
  | {
      method: "auto"
      callback(): Promise<
        | ({
            type: "success"
            provider?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
              }
            | { key: string }
          ))
        | {
            type: "failed"
          }
      >
    }
  | {
      method: "code"
      callback(code: string): Promise<
        | ({
            type: "success"
            provider?: string
          } & (
            | {
                refresh: string
                access: string
                expires: number
                accountId?: string
              }
            | { key: string }
          ))
        | {
            type: "failed"
          }
      >
    }
)

export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: {
    [key: string]: ToolDefinition
  }
  auth?: AuthHook
  /**
   * Called when a new message is received
   */
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>
  /**
   * Modify parameters sent to LLM
   */
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
  ) => Promise<void>
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: {
      title: string
      output: string
      metadata: any
    },
  ) => Promise<void>
  "experimental.chat.messages.transform"?: (
    input: {},
    output: {
      messages: {
        info: Message
        parts: Part[]
      }[]
    },
  ) => Promise<void>
  "experimental.chat.system.transform"?: (
    input: { sessionID: string },
    output: {
      system: string[]
    },
  ) => Promise<void>
  /**
   * Called before session compaction starts. Allows plugins to customize
   * the compaction prompt.
   *
   * - `context`: Additional context strings appended to the default prompt
   * - `prompt`: If set, replaces the default compaction prompt entirely
   */
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
  "experimental.text.complete"?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>

  // =====================
  // Hosted Agent Hooks
  // =====================

  /**
   * Called before creating a sandbox.
   * Allows plugins to modify services to start or the image tag.
   */
  "sandbox.create.before"?: (
    input: {
      projectID: string
      repository: string
      branch: string
      services: string[]
      imageTag?: string
    },
    output: {
      services: string[]
      imageTag?: string
    },
  ) => Promise<void>

  /**
   * Called when a sandbox becomes ready.
   * Use for post-initialization setup.
   */
  "sandbox.ready"?: (
    input: {
      sandboxID: string
      projectID: string
      status: "ready"
      services: Array<{
        name: string
        status: "starting" | "running" | "stopped" | "error"
        port?: number
        url?: string
      }>
    },
    output: {},
  ) => Promise<void>

  /**
   * Called before edit tools execute.
   * Allows gating edits until git sync is complete.
   */
  "sandbox.edit.before"?: (
    input: { sandboxID: string; file: string; tool: string },
    output: { allowed: boolean; reason?: string },
  ) => Promise<void>

  /**
   * Called on user typing to trigger sandbox warmup.
   * Enables pre-warming sandboxes before the prompt is sent.
   */
  "prompt.typing"?: (
    input: {
      sessionID: string
      partialPrompt: string
      keystrokeTimestamp: number
    },
    output: {
      warmupHints?: {
        services: string[]
        estimatedRepo?: string
      }
    },
  ) => Promise<void>

  /**
   * Called when spawning a background agent.
   * Allows plugins to configure the sandbox for the spawned agent.
   */
  "background.spawn"?: (
    input: {
      parentSessionID: string
      task: string
      sandboxConfig?: {
        repository: string
        branch?: string
        imageTag?: string
      }
    },
    output: {
      sandboxConfig?: {
        projectID?: string
        repository?: string
        branch?: string
        services?: string[]
        imageTag?: string
      }
    },
  ) => Promise<void>

  /**
   * Called when a user joins a multiplayer session.
   * Allows plugins to configure permissions for the joining user.
   */
  "multiplayer.join"?: (
    input: {
      sessionID: string
      user: {
        id: string
        name: string
        email?: string
        avatar?: string
        color: string
      }
    },
    output: {
      permissions?: Array<{
        path?: string
        tool?: string
        allow: boolean
      }>
    },
  ) => Promise<void>

  /**
   * Called after voice input is transcribed.
   * Allows plugins to process or filter transcribed text.
   */
  "voice.transcribed"?: (
    input: {
      sessionID: string
      transcript: string
      isFinal: boolean
      confidence: number
    },
    output: {
      processedText?: string
      reject?: boolean
    },
  ) => Promise<void>

  /**
   * Called to capture a screenshot for PR descriptions.
   * Allows plugins to customize screenshot capture behavior.
   */
  "pr.screenshot"?: (
    input: {
      sandboxID: string
      prURL: string
      type: "before" | "after"
    },
    output: {
      screenshotUrl?: string
      include: boolean
    },
  ) => Promise<void>

  /**
   * Called when a desktop environment is started.
   */
  "desktop.started"?: (input: { sandboxID: string; vncUrl: string }, output: {}) => Promise<void>

  /**
   * Called when a prompt is sent for statistics tracking.
   */
  "stats.prompt.sent"?: (
    input: {
      sessionID: string
      userID: string
      repository?: string
    },
    output: {},
  ) => Promise<void>

  /**
   * Called before a skill is invoked.
   * Allows plugins to modify the skill prompt or skip execution.
   */
  "skill.invoke.before"?: (
    input: {
      skillName: string
      sessionID: string
      context?: string
    },
    output: {
      modifiedPrompt?: string
      skip?: boolean
    },
  ) => Promise<void>

  /**
   * Called after a skill completes execution.
   */
  "skill.invoke.after"?: (
    input: {
      skillName: string
      sessionID: string
      result: string
    },
    output: {},
  ) => Promise<void>

  /**
   * Called when a PR comment is received.
   * Allows plugins to decide whether to create a session for the comment.
   */
  "pr.comment.received"?: (
    input: {
      repository: string
      prNumber: number
      commentID: number
      author: string
      body: string
      file?: string
      line?: number
    },
    output: {
      createSession: boolean
      prompt?: string
    },
  ) => Promise<void>

  /**
   * Called when a PR comment is addressed.
   * Allows plugins to customize the response.
   */
  "pr.comment.addressed"?: (
    input: {
      repository: string
      prNumber: number
      commentID: number
      commitSHA: string
      summary: string
    },
    output: {
      responseBody?: string
    },
  ) => Promise<void>
}

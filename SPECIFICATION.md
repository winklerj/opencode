# Hosted Background Coding Agent Specification for OpenCode

## Executive Summary

This specification defines a hosted background coding agent system for OpenCode, inspired by Ramp's Inspect. The design leverages OpenCode's server-first architecture, plugin hooks, and session management while adding remote sandbox orchestration, multiplayer collaboration, and multi-client support.

> "We built our own background coding agent. It writes code like any other coding agent, but closes the loop on verifying its work by having all the context and tools needed to prove it, as a human engineer would."

**Key Principles:**

- **Unlimited Concurrency**: Sessions are effectively free to run—spin up multiple versions of the same prompt, try different approaches or swap models without thinking twice. Your laptop doesn't need to be involved at all. There's no limit to how many sessions you can have running concurrently.
- **Capture Ideas Instantly**: Notice a bug while winding down for the night? Kick off a session, talk to it if you want (we added voice), and check the PR in the morning. You can go home and let the agent cook (and resume after dinner from your couch and mobile phone).
- **Speed Only Limited by Model**: Session speed should only be limited by model-provider time-to-first-token. Everything else—cloning, installing—is done before you start. When background agents are fast, they're strictly better than local: same intelligence, more power, and unlimited concurrency.
- **Full Engineer Context**: Agents should have agency, never limited by missing context or tools, only by model intelligence itself. For backend work, agents can run tests, review telemetry, and query feature flags. For frontend, they visually verify their work and provide screenshots and live previews.
- **Verification Built-In**: The agent doesn't just write code—it closes the loop by verifying its work using the same tools a human engineer would. This includes running test suites, checking Sentry for errors, querying Datadog metrics, and visually confirming UI changes.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                               CLIENTS                                          │
├────────────┬──────────┬────────────┬──────────┬─────────┬──────────┬─────────┤
│ Slack Bot  │ Web App  │ Chrome Ext │ Desktop  │  Voice  │ GitHub PR│ Mobile  │
└─────┬──────┴─────┬────┴─────┬──────┴────┬─────┴────┬────┴────┬─────┴────┬────┘
      │            │          │           │          │         │          │
      └────────────┴──────────┴───────────┼──────────┴─────────┴──────────┘
                                          │
                     ┌────────────────────▼────────────────────┐
                     │        OpenCode API Server               │
                     │        (Hono + SSE + WebSocket)          │
                     │                                          │
                     │  ┌─────────────┐    ┌─────────────────┐ │
                     │  │   Skills    │    │   All Models    │ │
                     │  │   System    │    │   + MCPs        │ │
                     │  └─────────────┘    └─────────────────┘ │
                     └────────────────────┬────────────────────┘
                                          │
       ┌──────────────────────────────────┼───────────────────────────────────┐
       │                                  │                                   │
┌──────▼──────┐              ┌────────────▼────────────┐          ┌──────────▼──────────┐
│  Cloudflare  │              │   Modal Sandbox         │          │  Background         │
│  Durable     │              │   Orchestrator          │          │  Agent Queue        │
│  Objects     │              │                         │          │                     │
│  (State)     │              │  ┌───────────────────┐  │          │  ┌───────────────┐  │
│              │              │  │ Warm Pool         │  │          │  │ Spawner       │  │
│  - Sessions  │              │  ├───────────────────┤  │          │  ├───────────────┤  │
│  - Prompts   │              │  │ Image Registry    │  │          │  │ Monitor       │  │
│  - Users     │              │  ├───────────────────┤  │          │  ├───────────────┤  │
│  - Skills    │              │  │ Snapshots         │  │          │  │ Unlimited     │  │
└──────────────┘              │  └───────────────────┘  │          │  │ Concurrency   │  │
                              └────────────┬────────────┘          │  └───────────────┘  │
                                           │                       └────────────────────┘
                     ┌─────────────────────▼─────────────────────┐
                     │              Modal VMs                     │
                     │  ┌─────────┐ ┌─────────┐ ┌──────────────┐ │
                     │  │  Vite   │ │Postgres │ │  Temporal    │ │
                     │  └─────────┘ └─────────┘ └──────────────┘ │
                     │  ┌────────────────┐ ┌───────────────────┐ │
                     │  │  code-server   │ │  Desktop/VNC      │ │
                     │  └────────────────┘ └───────────────────┘ │
                     └───────────────────────────────────────────┘
                                           │
                     ┌─────────────────────▼─────────────────────┐
                     │              INTEGRATIONS                  │
                     │  ┌────────┐ ┌─────────┐ ┌──────────────┐  │
                     │  │ Sentry │ │ Datadog │ │ LaunchDarkly │  │
                     │  └────────┘ └─────────┘ └──────────────┘  │
                     │  ┌────────────┐ ┌──────────┐ ┌─────────┐  │
                     │  │ Braintrust │ │ Buildkite│ │ GitHub  │  │
                     │  └────────────┘ └──────────┘ └─────────┘  │
                     └───────────────────────────────────────────┘
```

---

## 2. New Package Structure

```
packages/
├── sandbox/                    # Sandbox orchestration
│   └── src/
│       ├── provider/           # Sandbox backends
│       │   ├── index.ts        # Provider interface
│       │   ├── modal.ts        # Modal.com implementation
│       │   └── local.ts        # Local dev fallback
│       ├── pool/               # Warm pool management
│       │   ├── manager.ts
│       │   └── warmup.ts
│       ├── image/              # Image registry
│       │   ├── builder.ts
│       │   └── registry.ts
│       └── snapshot/           # VM snapshots
│           └── snapshot.ts
│
├── multiplayer/                # Real-time collaboration
│   └── src/
│       ├── state/              # Durable Object state
│       │   ├── durable-object.ts
│       │   └── sqlite-state.ts
│       ├── sync/               # Real-time sync
│       │   ├── websocket.ts
│       │   └── conflict.ts
│       └── presence/           # User presence
│           └── awareness.ts
│
├── background/                 # Background agent orchestration
│   └── src/
│       ├── queue/              # Prompt queuing
│       │   └── queue.ts
│       ├── scheduler/          # Resource scheduling
│       │   └── scheduler.ts
│       └── spawn/              # Sub-agent spawning
│           ├── spawner.ts
│           └── status.ts
│
├── skills/                     # Skills system (encoded best practices)
│   └── src/
│       ├── index.ts            # Skills registry
│       ├── loader.ts           # Load skills from files
│       ├── executor.ts         # Execute skills with context
│       └── builtin/            # Built-in skills
│           ├── code-review.ts
│           ├── pr-description.ts
│           └── test-generation.ts
│
└── clients/                    # Client implementations
    ├── slack-bot/
    ├── chrome-extension/
    ├── github-pr/              # GitHub PR discussion client
    │   ├── webhook-handler.ts
    │   └── session-manager.ts
    └── web-hosted/             # Hosted web extensions
```

---

## 3. Core Data Models

### 3.1 Sandbox

```typescript
export namespace Sandbox {
  export const Info = z.object({
    id: z.string(),
    projectID: z.string(),
    status: z.enum(["initializing", "ready", "running", "suspended", "terminated"]),
    provider: z.enum(["modal", "local", "kubernetes"]),

    image: z.object({
      id: z.string(),
      tag: z.string(),
      digest: z.string(),
      builtAt: z.number()
    }),

    git: z.object({
      repo: z.string(),
      branch: z.string(),
      commit: z.string(),
      syncStatus: z.enum(["pending", "syncing", "synced", "error"]),
      syncedAt: z.number().optional()
    }),

    services: z.array(z.object({
      name: z.string(),          // "vite", "postgres", "temporal"
      status: z.enum(["starting", "running", "stopped", "error"]),
      port: z.number().optional(),
      url: z.string().optional()
    })),

    network: z.object({
      internalIP: z.string(),
      ports: z.record(z.string(), z.number()),
      publicURL: z.string().optional()
    }),

    snapshot: z.object({
      id: z.string(),
      createdAt: z.number()
    }).optional(),

    time: z.object({
      created: z.number(),
      ready: z.number().optional(),
      lastActivity: z.number()
    })
  })

  export interface Provider {
    create(input: CreateInput): Promise<Info>
    start(sandboxID: string): Promise<void>
    stop(sandboxID: string): Promise<void>
    terminate(sandboxID: string): Promise<void>
    snapshot(sandboxID: string): Promise<string>
    restore(snapshotID: string): Promise<Info>
    execute(sandboxID: string, command: string[]): Promise<ExecuteResult>
    streamLogs(sandboxID: string, service: string): AsyncIterable<string>
  }
}
```

### 3.2 Multiplayer Session

```typescript
export namespace Multiplayer {
  export const User = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().optional(),
    avatar: z.string().optional(),
    color: z.string(),             // For cursor/highlight color
    cursor: z.object({
      file: z.string().optional(),
      line: z.number().optional(),
      column: z.number().optional()
    }).optional()
  })

  export const Session = z.object({
    id: z.string(),
    sessionID: z.string(),         // OpenCode session
    sandboxID: z.string().optional(),
    users: z.array(User),

    activePrompt: z.object({
      userID: z.string(),
      content: z.string(),
      startedAt: z.number()
    }).optional(),

    promptQueue: z.array(z.object({
      id: z.string(),
      userID: z.string(),
      content: z.string(),
      queuedAt: z.number(),
      priority: z.number()
    })),

    state: z.object({
      gitSyncStatus: z.enum(["pending", "syncing", "synced", "error"]),
      agentStatus: z.enum(["idle", "thinking", "executing"]),
      editLock: z.string().optional()  // userID holding lock
    })
  })
}
```

### 3.3 Background Agent

```typescript
export namespace BackgroundAgent {
  export const SpawnInput = z.object({
    parentSessionID: z.string().optional(),
    task: z.string(),
    type: z.enum(["research", "parallel-work", "review"]),
    repository: z.string().optional(),
    branch: z.string().optional(),
    agent: z.string().optional(),
    priority: z.number().default(0),
    timeout: z.number().optional()
  })

  export const Info = z.object({
    id: z.string(),
    parentSessionID: z.string().optional(),
    sessionID: z.string(),
    sandboxID: z.string().optional(),
    status: z.enum(["queued", "initializing", "running", "completed", "failed", "cancelled"]),
    task: z.string(),
    type: SpawnInput.shape.type,

    progress: z.object({
      steps: z.number(),
      currentStep: z.string().optional(),
      toolCalls: z.number()
    }),

    result: z.object({
      summary: z.string(),
      output: z.string().optional(),
      pullRequestURL: z.string().optional(),
      artifacts: z.array(z.string()).optional(),
      error: z.string().optional()
    }).optional(),

    time: z.object({
      created: z.number(),
      started: z.number().optional(),
      completed: z.number().optional()
    })
  })
}
```

---

## 4. API Endpoints

### 4.1 Sandbox API (`/sandbox/*`)

```
POST   /sandbox                    Create sandbox
GET    /sandbox/:id                Get sandbox info
GET    /sandbox                    List sandboxes
POST   /sandbox/:id/start          Start sandbox
POST   /sandbox/:id/stop           Stop sandbox
POST   /sandbox/:id/terminate      Terminate sandbox
POST   /sandbox/:id/snapshot       Create snapshot
POST   /sandbox/restore            Restore from snapshot
POST   /sandbox/:id/exec           Execute command
GET    /sandbox/:id/logs/:service  Stream service logs (SSE)
GET    /sandbox/:id/git            Get git sync status
POST   /sandbox/:id/git/sync       Force git sync
```

### 4.2 Multiplayer API (`/multiplayer/*`)

```
POST   /multiplayer/:sessionID/join      Join session
POST   /multiplayer/:sessionID/leave     Leave session
PUT    /multiplayer/:sessionID/cursor    Update cursor position
POST   /multiplayer/:sessionID/prompt    Queue prompt
DELETE /multiplayer/:sessionID/prompt/:id Cancel queued prompt
GET    /multiplayer/:sessionID/ws        WebSocket connection
```

### 4.3 Background Agent API (`/background/*`)

```
POST   /background/spawn           Spawn background agent
GET    /background/:id             Get agent status
GET    /background                 List agents
POST   /background/:id/cancel      Cancel agent
GET    /background/:id/output      Get agent output
GET    /background/:id/events      Stream agent events (SSE)
```

### 4.4 Integration Webhooks (`/webhook/*`)

```
POST   /webhook/github             GitHub webhook receiver
POST   /webhook/slack/events       Slack events
POST   /webhook/slack/interactions Slack interactions
```

### 4.5 Voice API (`/voice/*`)

```
POST   /session/:sessionID/voice/start    Start voice recognition
POST   /session/:sessionID/voice/stop     Stop voice recognition
GET    /session/:sessionID/voice/status   Get voice recognition status
POST   /session/:sessionID/voice          Send voice prompt (base64 audio)
```

### 4.6 Desktop API (`/desktop/*`)

```
GET    /sandbox/:id/desktop               Get desktop stream info
POST   /sandbox/:id/desktop/start         Start desktop environment
POST   /sandbox/:id/desktop/stop          Stop desktop environment
GET    /sandbox/:id/desktop/screenshot    Capture screenshot
GET    /sandbox/:id/desktop/ws            WebSocket for VNC stream
```

### 4.7 Editor API (`/editor/*`)

```
GET    /sandbox/:id/editor                Get editor URL (redirects to code-server)
POST   /sandbox/:id/editor/start          Start code-server if not running
POST   /sandbox/:id/editor/stop           Stop code-server
```

### 4.8 Statistics API (`/stats/*`)

```
GET    /stats                             Get dashboard statistics
GET    /stats/live                        Get live metrics only
GET    /stats/historical                  Get historical metrics by period
```

### 4.9 Skills API (`/skills/*`)

```
GET    /skills                            List available skills
GET    /skills/:name                      Get skill details
POST   /skills                            Create custom skill
PUT    /skills/:name                      Update custom skill
DELETE /skills/:name                      Delete custom skill
POST   /skills/:name/invoke               Invoke skill in session context
```

### 4.10 PR Session API (`/pr-session/*`)

```
POST   /pr-session                        Create session from PR
GET    /pr-session/:prNumber              Get session for PR
GET    /pr-session/:prNumber/comments     List addressed comments
POST   /pr-session/:prNumber/respond      Post response to PR comment
```

---

## 5. Plugin Hooks Extensions

Add to existing `Hooks` interface in `packages/plugin/src/index.ts`:

```typescript
interface Hooks {
  // Existing hooks...

  // Sandbox hooks
  "sandbox.create.before"?: (
    input: Sandbox.CreateInput,
    output: { services: string[], imageTag: string }
  ) => Promise<void>

  "sandbox.ready"?: (
    input: { sandbox: Sandbox.Info },
    output: {}
  ) => Promise<void>

  // Critical: Gate edits until git sync complete
  "sandbox.edit.before"?: (
    input: { sandboxID: string, file: string, tool: string },
    output: { allowed: boolean, reason?: string }
  ) => Promise<void>

  // Warm sandbox on typing
  "prompt.typing"?: (
    input: { sessionID: string, partialPrompt: string },
    output: { warmupHints?: { services: string[] } }
  ) => Promise<void>

  // Background agent hooks
  "background.spawn"?: (
    input: BackgroundAgent.SpawnInput,
    output: { sandboxConfig?: Partial<Sandbox.CreateInput> }
  ) => Promise<void>

  // Multiplayer hooks
  "multiplayer.join"?: (
    input: { sessionID: string, user: Multiplayer.User },
    output: { permissions?: PermissionNext.Ruleset }
  ) => Promise<void>

  // Warm sandbox on typing (not just send)
  "prompt.typing"?: (
    input: {
      sessionID: string,
      partialPrompt: string,
      keystrokeTimestamp: number
    },
    output: {
      warmupHints?: {
        services: string[],
        estimatedRepo?: string
      }
    }
  ) => Promise<void>

  // Voice input processing
  "voice.transcribed"?: (
    input: {
      sessionID: string,
      transcript: string,
      isFinal: boolean,
      confidence: number
    },
    output: {
      processedText?: string,
      reject?: boolean
    }
  ) => Promise<void>

  // Screenshot capture for PR descriptions
  "pr.screenshot"?: (
    input: {
      sandboxID: string,
      prURL: string,
      type: "before" | "after"
    },
    output: {
      screenshotUrl?: string,
      include: boolean
    }
  ) => Promise<void>

  // Desktop stream events
  "desktop.started"?: (
    input: { sandboxID: string, vncUrl: string },
    output: {}
  ) => Promise<void>

  // Statistics events
  "stats.prompt.sent"?: (
    input: {
      sessionID: string,
      userID: string,
      repository?: string
    },
    output: {}
  ) => Promise<void>

  // Skills hooks
  "skill.invoke.before"?: (
    input: {
      skillName: string,
      sessionID: string,
      context?: string
    },
    output: {
      modifiedPrompt?: string,
      skip?: boolean
    }
  ) => Promise<void>

  "skill.invoke.after"?: (
    input: {
      skillName: string,
      sessionID: string,
      result: string
    },
    output: {}
  ) => Promise<void>

  // PR discussion hooks
  "pr.comment.received"?: (
    input: {
      repository: string,
      prNumber: number,
      commentID: number,
      author: string,
      body: string,
      file?: string,
      line?: number
    },
    output: {
      createSession: boolean,
      prompt?: string
    }
  ) => Promise<void>

  "pr.comment.addressed"?: (
    input: {
      repository: string,
      prNumber: number,
      commentID: number,
      commitSHA: string,
      summary: string
    },
    output: {
      responseBody?: string
    }
  ) => Promise<void>
}
```

---

## 6. New Tools

### 6.1 spawn_session

```typescript
// Allows agent to spawn parallel sessions
tool({
  name: "spawn_session",
  description: "Spawn a background coding session for parallel work or research",
  args: {
    task: z.string().describe("What the spawned agent should accomplish"),
    type: z.enum(["research", "parallel-work", "review"]),
    repository: z.string().optional(),
    branch: z.string().optional(),
    wait: z.boolean().default(false)
  },
  execute: async (args, ctx) => {
    const agent = await BackgroundAgent.spawn({
      parentSessionID: ctx.sessionID,
      ...args
    })
    return `Spawned session ${agent.id}`
  }
})
```

### 6.2 check_session

```typescript
// Allows agent to check on spawned sessions
tool({
  name: "check_session",
  description: "Check status of a spawned background session",
  args: {
    agentID: z.string(),
    includeOutput: z.boolean().default(false)
  },
  execute: async (args) => {
    const agent = await BackgroundAgent.get(args.agentID)
    return formatAgentStatus(agent)
  }
})
```

### 6.3 Skills System

Skills encode how your team ships—reusable workflows, best practices, and domain-specific knowledge. They let builders of all backgrounds contribute with the tooling and setup an engineer would have.

```typescript
// Example skill: Ramp's PR description generator
const prDescriptionSkill = {
  name: "pr-description",
  description: "Generate PR descriptions following Ramp's format",
  prompt: `You are generating a PR description for Ramp's codebase.

    Follow these conventions:
    - Start with a one-line summary
    - Include "## What" section explaining changes
    - Include "## Why" section with business context
    - Include "## Testing" section with verification steps
    - Link to related Linear tickets
    - Include before/after screenshots for UI changes`,
  tools: ["read", "grep", "computer_use"],  // Allow screenshot capture
  model: "claude-sonnet-4-20250514"
}

// Skills are invoked via the agent or explicitly
tool({
  name: "use_skill",
  description: "Apply a predefined skill to the current task",
  args: {
    skill: z.string().describe("Name of the skill to use"),
    context: z.string().optional().describe("Additional context for the skill")
  },
  execute: async (args, ctx) => {
    const skill = await Skills.get(args.skill)
    // Inject skill's system prompt and apply its configuration
    return await applySkill(skill, ctx, args.context)
  }
})
```

**Built-in Skills:**
- `code-review`: Review code changes with team conventions
- `pr-description`: Generate PR descriptions in your team's format
- `test-generation`: Create tests following your testing patterns
- `bug-fix`: Systematic approach to diagnosing and fixing bugs
- `feature-impl`: Implement features following architectural patterns

**Custom Skills:**

Define custom skills in `.opencode/skills/` as markdown files:

```markdown
<!-- .opencode/skills/ramp-api-endpoint.md -->
# Ramp API Endpoint Skill

## Description
Create new API endpoints following Ramp's patterns

## System Prompt
When creating a new API endpoint at Ramp:
1. Use our standard request/response types from @ramp/api-types
2. Add OpenAPI documentation inline
3. Include rate limiting configuration
4. Add Datadog metrics for latency and error rates
5. Write integration tests using our test harness

## Tools
- read
- write
- edit
- bash
- datadog_query
```

---

## 7. Configuration Schema

Add to `packages/opencode/src/config/config.ts`:

```typescript
export const HostedConfig = z.object({
  enabled: z.boolean().default(false),

  sandbox: z.object({
    provider: z.enum(["modal", "local"]).default("modal"),
    defaultImage: z.string().optional(),
    services: z.array(z.string()).default(["vite"]),
    warmPool: z.object({
      enabled: z.boolean().default(true),
      size: z.number().default(3),
      ttl: z.number().default(1800),  // 30 minutes
      typingTrigger: z.boolean().default(true)  // Warm on keystroke
    }).optional(),
    resources: z.object({
      cpu: z.number().default(2),
      memory: z.number().default(4096),
      disk: z.number().default(20)
    }).optional(),
    // VS Code in sandbox
    editor: z.object({
      enabled: z.boolean().default(true),
      type: z.enum(["code-server", "openvscode-server"]).default("code-server"),
      port: z.number().default(8080),
      extensions: z.array(z.string()).optional()  // Pre-installed extensions
    }).optional(),
    // Desktop streaming for visual verification
    desktop: z.object({
      enabled: z.boolean().default(false),
      resolution: z.object({
        width: z.number().default(1280),
        height: z.number().default(720)
      }).optional(),
      vncPort: z.number().default(5900)
    }).optional(),
    // Image build configuration
    imageBuild: z.object({
      rebuildInterval: z.number().default(1800),  // 30 minutes
      runTestsDuringBuild: z.boolean().default(true),
      testTimeout: z.number().default(600000),  // 10 minutes
      cacheWarmup: z.boolean().default(true)
    }).optional()
  }).optional(),

  multiplayer: z.object({
    enabled: z.boolean().default(false),
    stateProvider: z.enum(["cloudflare", "memory"]).default("memory")
  }).optional(),

  background: z.object({
    enabled: z.boolean().default(true),
    maxConcurrent: z.number().default(Infinity),  // Unlimited by default
    defaultTimeout: z.number().default(600000)
  }).optional(),

  // Skills encode how your team ships - reusable workflows and best practices
  skills: z.object({
    enabled: z.boolean().default(true),
    directory: z.string().default(".opencode/skills"),
    builtIn: z.array(z.string()).default(["code-review", "pr-description", "test-generation"]),
    custom: z.array(z.object({
      name: z.string(),
      description: z.string(),
      prompt: z.string(),           // System prompt for the skill
      tools: z.array(z.string()).optional(),  // Allowed tools
      model: z.string().optional()  // Override model for this skill
    })).optional()
  }).optional(),

  // Voice interface configuration
  voice: z.object({
    enabled: z.boolean().default(false),
    lang: z.string().default("en-US"),
    continuous: z.boolean().default(true),
    interimResults: z.boolean().default(true),
    commitDelay: z.number().default(250)  // ms before finalizing speech
  }).optional(),

  integrations: z.object({
    github: z.object({
      enabled: z.boolean(),
      webhooks: z.object({
        secret: z.string(),
        events: z.array(z.string())
      }).optional(),
      // GitHub App for image building (cloning without user tokens)
      appId: z.string().optional(),
      appPrivateKey: z.string().optional(),
      appInstallationId: z.string().optional()
    }).optional(),
    slack: z.object({
      enabled: z.boolean(),
      botToken: z.string(),
      signingSecret: z.string().optional(),
      // Repository classifier configuration
      classifier: z.object({
        model: z.string().default("gpt-4o-mini"),  // Fast model, no reasoning
        confidenceThreshold: z.number().default(0.8),
        allowUnknown: z.boolean().default(true),
        hints: z.array(z.object({
          channelPattern: z.string(),
          repository: z.string(),
          keywords: z.array(z.string()).optional()
        })).optional()
      }).optional()
    }).optional(),
    sentry: z.object({ enabled: z.boolean(), dsn: z.string() }).optional(),
    datadog: z.object({ enabled: z.boolean(), apiKey: z.string() }).optional(),
    launchDarkly: z.object({ enabled: z.boolean(), sdkKey: z.string() }).optional(),
    braintrust: z.object({ enabled: z.boolean(), apiKey: z.string() }).optional(),
    buildkite: z.object({ enabled: z.boolean(), token: z.string() }).optional()
  }).optional()
})
```

Example `opencode.jsonc`:
```jsonc
{
  "hosted": {
    "enabled": true,
    "sandbox": {
      "provider": "modal",
      "services": ["vite", "postgres", "temporal"],
      "warmPool": { "enabled": true, "size": 5, "typingTrigger": true },
      "editor": { "enabled": true, "type": "code-server" },
      "desktop": { "enabled": true },
      "imageBuild": { "rebuildInterval": 1800, "runTestsDuringBuild": true }
    },
    "multiplayer": { "enabled": true },
    "voice": { "enabled": true },
    "skills": {
      "enabled": true,
      "directory": ".opencode/skills",
      "builtIn": ["code-review", "pr-description", "test-generation"]
    },
    "integrations": {
      "github": {
        "enabled": true,
        "appId": "{env:GITHUB_APP_ID}",
        "appPrivateKey": "{env:GITHUB_APP_PRIVATE_KEY}",
        "webhooks": {
          "secret": "{env:GITHUB_WEBHOOK_SECRET}",
          "events": ["pull_request", "pull_request_review_comment", "issue_comment"]
        }
      },
      "slack": {
        "enabled": true,
        "botToken": "{env:SLACK_BOT_TOKEN}",
        "classifier": {
          "model": "gpt-4o-mini",
          "confidenceThreshold": 0.8
        }
      },
      "sentry": { "enabled": true, "dsn": "{env:SENTRY_DSN}" },
      "datadog": { "enabled": true, "apiKey": "{env:DATADOG_API_KEY}" },
      "launchDarkly": { "enabled": true, "sdkKey": "{env:LAUNCHDARKLY_SDK_KEY}" },
      "braintrust": { "enabled": true, "apiKey": "{env:BRAINTRUST_API_KEY}" },
      "buildkite": { "enabled": true, "token": "{env:BUILDKITE_TOKEN}" }
    }
  }
}
```

---

## 8. Key Implementation Details

### 8.1 Git Sync Gating (Critical)

Uses `tool.execute.before` hook to block edits until git sync completes:

```typescript
// packages/opencode/src/sandbox/sync-gate-plugin.ts
export const SyncGatePlugin: Plugin = async ({ client }) => {
  const pendingSyncs = new Map<string, Promise<void>>()

  return {
    "sandbox.ready": async ({ sandbox }) => {
      if (sandbox.git.syncStatus !== "synced") {
        pendingSyncs.set(sandbox.id, waitForSync(sandbox.id, client))
      }
    },

    "tool.execute.before": async ({ tool, sessionID }, { args }) => {
      const EDIT_TOOLS = ["edit", "write", "patch", "multiedit"]
      if (!EDIT_TOOLS.includes(tool)) return

      const session = await client.session.get({ sessionID })
      const pending = pendingSyncs.get(session.data?.hosted?.sandboxID)
      if (pending) await pending  // Block until sync complete
    }
  }
}
```

### 8.2 Warm Pool Strategy

1. Maintain pool of pre-warmed sandboxes per high-volume repository
2. Images rebuilt every 30 minutes with latest dependencies
3. **Start warming when user starts typing (not just when they send)**
   - `prompt.typing` hook triggers warmup on first keystroke
   - Claim sandbox from pool immediately
   - Begin git sync in background
4. Sandbox ready before user finishes typing
5. **Allow read operations during git sync, only block writes**

**Read vs Write Gating During Sync:**

```typescript
const READONLY_TOOLS = ["read", "glob", "grep", "ls", "codesearch"]
const WRITE_TOOLS = ["edit", "write", "patch", "bash", "multiedit"]

// In SyncGatePlugin
"tool.execute.before": async ({ tool, sessionID }, output) => {
  if (READONLY_TOOLS.includes(tool)) return  // Allow immediately

  if (WRITE_TOOLS.includes(tool)) {
    const session = await client.session.get({ sessionID })
    const sandbox = await client.sandbox.get(session.data?.hosted?.sandboxID)

    if (sandbox.git.syncStatus !== "synced") {
      // Block with informative message
      output.blocked = true
      output.reason = `Waiting for git sync (${sandbox.git.syncStatus})`
      output.retryAfter = 1000  // Retry in 1s
    }
  }
}
```

### 8.3 Prompt Queue Behavior

- Follow-up prompts during execution are queued (not inserted mid-stream)
- Queue visible to all multiplayer users
- Users can reorder/cancel their own queued prompts
- Agent stop mechanism available mid-execution

### 8.4 Session Attribution

- Each prompt tracks `userID` for commit attribution
- Git config updated per-prompt: `git config user.name "User Name"`
- PR opened using prompting user's GitHub token

### 8.5 Image Build Optimization

**30-Minute Rebuild Cycle:**
- Automated image rebuilds triggered every 30 minutes via cron
- Incremental layer caching to minimize rebuild time
- Parallel builds across multiple repositories

**GitHub App for Cloning:**

A dedicated GitHub App enables cloning without user OAuth tokens during image build:

```typescript
// packages/sandbox/src/image/github-app.ts
export async function getInstallationToken(appId: string, privateKey: string, installationId: string) {
  const jwt = generateJWT(appId, privateKey)
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } }
  )
  return response.json()
}

// Clone without user context
export async function cloneWithAppToken(repo: string, installationId: string) {
  const { token } = await getInstallationToken(...)
  // Use execFile for safe command execution
  await execFile('git', ['clone', `https://x-access-token:${token}@github.com/${repo}.git`])
}
```

**Pre-Build Cache Warming:**

Run application and test suite once during image build to create caches:

```python
# Modal image build
image = (
    modal.Image.debian_slim()
    .apt_install("git", "curl", "build-essential", "postgresql-client")
    .run_commands(
        "curl -fsSL https://bun.sh/install | bash",
        "curl -fsSL https://get.pnpm.io/install.sh | sh"
    )
    # Clone and install (token injected securely via secrets)
    .run_commands(
        "git clone $REPO_URL /workspace",
        "cd /workspace && pnpm install"
    )
    # Run build and tests once to populate caches
    .run_commands(
        "cd /workspace && pnpm build || true",  # Build artifacts cached
        "cd /workspace && timeout 600 pnpm test || true"  # Test caches populated
    )
)
```

**Git Config for User Attribution:**

```typescript
// Before committing on behalf of user
async function configureGitUser(sandbox: Sandbox, user: { name: string, email: string }) {
  await sandbox.execute(["git", "config", "user.name", user.name])
  await sandbox.execute(["git", "config", "user.email", user.email])
}
```

**Image Tagging Strategy:**
```
{registry}/opencode/{org}/{repo}:{branch}-{timestamp}
{registry}/opencode/{org}/{repo}:{branch}-latest
```

### 8.6 Sandbox Snapshots for Follow-Ups

When the agent finishes making changes, take a snapshot and restore later if the sandbox has exited and the user sends a follow-up. This is critical for session continuity.

**Snapshot Data Model:**

```typescript
export namespace SandboxSnapshot {
  export const Info = z.object({
    id: z.string(),
    sandboxID: z.string(),
    sessionID: z.string(),
    createdAt: z.number(),

    // Git state at snapshot time
    git: z.object({
      repo: z.string(),
      branch: z.string(),
      commit: z.string(),
      uncommittedChanges: z.boolean()
    }),

    // Filesystem snapshot reference
    filesystem: z.object({
      snapshotRef: z.string(),   // Modal snapshot ID or similar
      sizeBytes: z.number()
    }),

    // Service state (which services were running)
    services: z.array(z.object({
      name: z.string(),
      wasRunning: z.boolean(),
      port: z.number().optional()
    })),

    // Session context for restoration
    context: z.object({
      lastPrompt: z.string().optional(),
      conversationLength: z.number(),
      workingSummary: z.string().optional()
    })
  })

  export interface Manager {
    create(sandboxID: string, sessionID: string): Promise<Info>
    restore(snapshotID: string): Promise<Sandbox.Info>
    delete(snapshotID: string): Promise<void>
    list(sessionID: string): Promise<Info[]>
    getLatest(sessionID: string): Promise<Info | null>
  }
}
```

**Snapshot Lifecycle:**

```typescript
// packages/sandbox/src/snapshot/lifecycle.ts
export const SnapshotLifecycle = {
  // Create snapshot when agent completes work
  async onAgentComplete(sandbox: Sandbox.Info, session: Session.Info) {
    // Only snapshot if there are changes worth preserving
    const hasChanges = await checkForChanges(sandbox)
    if (!hasChanges) return null

    const snapshot = await SandboxSnapshot.Manager.create(
      sandbox.id,
      session.id
    )

    // Terminate sandbox to free resources
    await Sandbox.Provider.terminate(sandbox.id)

    return snapshot
  },

  // Restore when user sends follow-up
  async onFollowUpPrompt(sessionID: string, prompt: string) {
    const snapshot = await SandboxSnapshot.Manager.getLatest(sessionID)

    if (snapshot) {
      // Restore from snapshot
      const sandbox = await SandboxSnapshot.Manager.restore(snapshot.id)

      // Sync any new changes since snapshot
      await syncLatestChanges(sandbox, snapshot.git.commit)

      return sandbox
    } else {
      // Cold start if no snapshot
      return await createNewSandbox(sessionID)
    }
  },

  // Auto-expire old snapshots
  async cleanupExpiredSnapshots(maxAge: number = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAge
    const expired = await SandboxSnapshot.Manager.listExpired(cutoff)

    for (const snapshot of expired) {
      await SandboxSnapshot.Manager.delete(snapshot.id)
    }
  }
}
```

**Modal Snapshot Integration:**

```python
# Using Modal's native snapshot capability
@modal.cls(cpu=4, memory=8192)
class Sandbox:
    @modal.method()
    async def create_snapshot(self) -> str:
        """Create filesystem snapshot for later restoration"""
        snapshot_id = await modal.Snapshot.create(
            include_paths=["/workspace", "/home", "/tmp/caches"],
            exclude_paths=["/workspace/node_modules/.cache"]
        )
        return snapshot_id

    @staticmethod
    async def restore_from_snapshot(snapshot_id: str) -> "Sandbox":
        """Restore sandbox from snapshot"""
        return await Sandbox.from_snapshot(snapshot_id)
```

**Key Benefits:**

1. **Session Continuity**: Users can send follow-up prompts hours or days later
2. **Resource Efficiency**: Sandboxes don't sit idle between interactions
3. **Fast Restoration**: Snapshots restore faster than cold starts
4. **State Preservation**: Working directory, caches, and service state preserved

### 8.7 VS Code in Sandbox

Allow users to manually edit files within the sandbox without requiring a local clone.

**Implementation:**
- Run code-server (VS Code in browser) inside each sandbox
- Expose on internal port (default: 8080)
- Proxy through OpenCode server for authentication

**Service Definition:**

```typescript
export const EditorService = z.object({
  name: z.literal("code-server"),
  status: z.enum(["starting", "running", "stopped", "error"]),
  port: z.number().default(8080),
  url: z.string().optional(),  // Proxied URL
  auth: z.object({
    type: z.enum(["token", "password", "none"]),
    value: z.string().optional()
  }).optional()
})
```

**Sandbox Integration:**

```python
# In Modal sandbox
@modal.method()
async def start_editor(self) -> dict:
    """Start code-server for manual editing"""
    process = await asyncio.create_subprocess_exec(
        "code-server",
        "--bind-addr", "0.0.0.0:8080",
        "--auth", "none",  # Auth handled by proxy
        "/workspace",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    return {"port": 8080, "pid": process.pid}
```

### 8.8 Desktop/Browser Streaming

Visual verification for frontend work, enabling real-time preview of UI changes.

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                  Sandbox VM                                  │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │  Chromium/X11   │ -> │  VNC Server     │ -> Port 5900   │
│  │  (Headless)     │    │  (TigerVNC)     │                │
│  └─────────────────┘    └─────────────────┘                │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  OpenCode Server                                             │
│  ┌─────────────────┐                                        │
│  │  noVNC Proxy    │ -> WebSocket -> Client Browser         │
│  └─────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

**Data Models:**

```typescript
export namespace DesktopStream {
  export const Info = z.object({
    sandboxID: z.string(),
    status: z.enum(["starting", "running", "stopped", "error"]),
    resolution: z.object({
      width: z.number(),
      height: z.number()
    }),
    vncUrl: z.string().optional(),
    websocketUrl: z.string().optional()
  })

  export const Screenshot = z.object({
    sandboxID: z.string(),
    timestamp: z.number(),
    format: z.enum(["png", "jpeg"]),
    data: z.string(),  // base64
    url: z.string().optional()  // If stored for PR descriptions
  })
}
```

**Computer Use Tool:**

```typescript
tool({
  name: "computer_use",
  description: "Interact with the desktop environment for visual testing",
  args: {
    action: z.enum(["screenshot", "click", "type", "scroll", "navigate"]),
    x: z.number().optional(),
    y: z.number().optional(),
    text: z.string().optional(),
    url: z.string().optional()
  },
  execute: async (args, ctx) => {
    const desktop = await DesktopStream.get(ctx.sandboxID)
    switch (args.action) {
      case "screenshot":
        return await desktop.captureScreenshot()
      case "click":
        return await desktop.click(args.x!, args.y!)
      case "type":
        return await desktop.type(args.text!)
      case "navigate":
        return await desktop.navigate(args.url!)
    }
  }
})
```

**PR Description Enhancement:**

Automatically capture before/after screenshots for UI changes:

```typescript
// Hook into PR creation
"pr.screenshot"?: async (input, output) => {
  const { sandboxID, type } = input

  // Capture screenshot
  const screenshot = await DesktopStream.captureScreenshot(sandboxID)

  // Upload to temporary storage
  const url = await uploadScreenshot(screenshot)

  output.screenshotUrl = url
  output.include = true  // Include in PR description
}

// In PR description template
const prBody = `
## Summary
${summary}

## Visual Changes
| Before | After |
|--------|-------|
| ![Before](${beforeUrl}) | ![After](${afterUrl}) |
`
```

---

## 9. Client Specifications

### 9.1 Slack Bot

**Features:**
- Repository classifier using channel context + message content
- Thread-based conversation (replies to bot = follow-up prompts)
- Block Kit UI for status updates and actions
- Custom emoji support for personality
- Natural language interaction (no special syntax required)

**Classification Flow:**
```
Message → Extract context (channel, thread, text)
        → Fast model classification (GPT-4o-mini, no reasoning)
        → Return { repository, branch, confidence }
        → If confidence < 0.8, ask user to clarify
```

**Classifier Implementation:**

```typescript
// packages/clients/slack-bot/src/classifier.ts
export const ClassifierInput = z.object({
  channelName: z.string(),
  channelId: z.string(),
  messageText: z.string(),
  threadContext: z.string().optional(),
  hints: z.array(z.object({
    repository: z.string(),
    keywords: z.array(z.string()),
    recentUsage: z.number()  // Count in last 7 days
  }))
})

export const ClassifierOutput = z.object({
  repository: z.string().nullable(),  // null if unknown
  branch: z.string().default("main"),
  confidence: z.number(),  // 0-1
})

// Use fast model with no reasoning for speed
const classifier = async (input: ClassifierInput): Promise<ClassifierOutput> => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",  // Fast, no reasoning
    messages: [{
      role: "system",
      content: `Classify which repository this message is about.
        Available repositories: ${input.hints.map(h => h.repository).join(", ")}
        Channel: ${input.channelName}
        Return JSON: { repository, branch, confidence }`
    }, {
      role: "user",
      content: input.messageText
    }],
    response_format: { type: "json_object" }
  })
  return ClassifierOutput.parse(JSON.parse(response.choices[0].message.content))
}
```

**Virality Through Public Spaces:**
- Bot operates in public channels, making usage visible to the organization
- Others see the bot in action and learn from examples
- Status updates show progress, inspiring adoption

**Custom Emojis:**
- Add organization-specific emojis for the bot
- Use in status messages and reactions
- Creates personality and brand identity

### 9.2 Web Interface Extensions

**New Components:**
- `<VSCodeEmbed>` - code-server iframe for manual edits within sandbox
- `<DesktopStream>` - VNC/noVNC stream for visual verification
- `<PresenceAvatars>` - multiplayer user presence indicators
- `<PromptQueue>` - visible queue with reorder/cancel capabilities
- `<StatsDashboard>` - usage metrics, PR merge rates, live counts
- `<VoiceInput>` - voice-to-text input with interim display

**Mobile-First Design:**
- All components must work on mobile viewports (320px minimum)
- Touch-friendly interaction targets (44x44px minimum)
- Responsive layouts with collapsible navigation

**Statistics Dashboard:**

```typescript
// packages/app/src/components/StatsDashboard.tsx
export const StatsDashboard = () => {
  const stats = useStats()

  return (
    <div>
      {/* Live metrics */}
      <LiveMetric
        label="Humans Prompting"
        value={stats.live.humansPrompting}
        description="Active in last 5 minutes"
      />
      <LiveMetric
        label="Active Sessions"
        value={stats.live.activeSessions}
      />

      {/* Historical charts */}
      <Chart
        title="PRs Merged Over Time"
        data={stats.historical.prsMerged}
      />
      <Chart
        title="Session Completion Rate"
        data={stats.historical.completionRate}
      />

      {/* Top repositories */}
      <TopRepositories data={stats.historical.topRepositories} />
    </div>
  )
}
```

### 9.3 Chrome Extension

To inspire usage across non-engineering users, build a Chrome extension that allows visual changes to any React app. This significantly lowers the barrier for product managers, designers, and other builders to contribute.

**Features:**
- Sidebar chat interface via Chrome Extension Sidebar API
- Screenshot tool with DOM/React tree extraction (not actual images)
- Element highlighting for specific change requests
- Direct session creation from browser context

**Why DOM/React Tree Instead of Screenshots:**

Instead of sending actual screenshots (which consume many tokens and lose semantic meaning), extract the component tree. This gives the agent:
1. Exact component names and hierarchy
2. Current props and state values
3. CSS classes and styles
4. Precise element coordinates for targeting changes

```typescript
// packages/clients/chrome-extension/src/dom-extractor.ts
export interface ElementInfo {
  tagName: string
  className: string
  id?: string
  rect: DOMRect
  textContent?: string
  computedStyles?: Partial<CSSStyleDeclaration>
  reactComponent?: {
    name: string
    props: Record<string, unknown>
    state?: Record<string, unknown>
    hooks?: Array<{ name: string; value: unknown }>
  }
}

// Extract full tree from selection
export function extractElementTree(selection: Selection): ElementInfo[] {
  const elements: ElementInfo[] = []
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer

  // Walk up to find React root
  let node: Node | null = container
  while (node && !getReactFiber(node)) {
    node = node.parentNode
  }

  if (node) {
    walkReactTree(node, elements)
  } else {
    // Fallback to pure DOM extraction
    walkDOMTree(container, elements)
  }

  return elements
}

// Get React fiber from DOM node
function getReactFiber(node: Node): any {
  const keys = Object.keys(node)
  const fiberKey = keys.find(k => k.startsWith('__reactFiber$'))
  return fiberKey ? (node as any)[fiberKey] : null
}

// Walk React component tree
function walkReactTree(node: Node, elements: ElementInfo[]) {
  const fiber = getReactFiber(node)
  if (!fiber) return

  const element = node as Element

  elements.push({
    tagName: element.tagName,
    className: element.className,
    id: element.id || undefined,
    rect: element.getBoundingClientRect(),
    textContent: element.textContent?.slice(0, 100),
    computedStyles: extractRelevantStyles(element),
    reactComponent: fiber.type ? {
      name: getFiberName(fiber),
      props: sanitizeProps(fiber.memoizedProps),
      state: fiber.memoizedState ? extractState(fiber.memoizedState) : undefined
    } : undefined
  })

  // Recurse to children
  for (const child of element.children) {
    walkReactTree(child, elements)
  }
}

// Get component name from fiber
function getFiberName(fiber: any): string {
  if (typeof fiber.type === 'string') return fiber.type
  if (fiber.type?.displayName) return fiber.type.displayName
  if (fiber.type?.name) return fiber.type.name
  return 'Anonymous'
}

// Extract only relevant CSS properties
function extractRelevantStyles(element: Element): Partial<CSSStyleDeclaration> {
  const styles = window.getComputedStyle(element)
  return {
    display: styles.display,
    position: styles.position,
    color: styles.color,
    backgroundColor: styles.backgroundColor,
    fontSize: styles.fontSize,
    fontWeight: styles.fontWeight,
    padding: styles.padding,
    margin: styles.margin,
    border: styles.border,
    borderRadius: styles.borderRadius,
  }
}
```

**Integration with React DevTools:**

For apps with React DevTools installed, you can get even richer data:

```typescript
// packages/clients/chrome-extension/src/devtools-bridge.ts
export async function getComponentFromDevTools(element: Element): Promise<ComponentInfo | null> {
  // Check if React DevTools global hook is available
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__
  if (!hook) return null

  // Use DevTools API to get component info
  const fiber = hook.getFiberForNode?.(element)
  if (!fiber) return null

  return {
    name: getFiberName(fiber),
    props: fiber.memoizedProps,
    state: fiber.memoizedState,
    source: fiber._debugSource,  // File and line number!
    owner: fiber._debugOwner ? getFiberName(fiber._debugOwner) : null
  }
}
```

**Selection UI:**

```typescript
// packages/clients/chrome-extension/src/selection-overlay.ts
export class SelectionOverlay {
  private overlay: HTMLDivElement
  private selectedElements: Set<Element> = new Set()

  constructor() {
    this.overlay = this.createOverlay()
    document.body.appendChild(this.overlay)
  }

  startSelection() {
    document.addEventListener('mouseover', this.handleHover)
    document.addEventListener('click', this.handleClick, { capture: true })
  }

  private handleHover = (e: MouseEvent) => {
    const element = e.target as Element
    this.highlightElement(element)
  }

  private handleClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const element = e.target as Element
    this.selectedElements.add(element)
    this.updateOverlay()
  }

  getSelectedTree(): ElementInfo[] {
    return Array.from(this.selectedElements)
      .flatMap(el => extractElementTree(el))
  }
}
```

**MDM Distribution:**

Distribute the extension via managed device policy to avoid Chrome Web Store and increase adoption by putting it directly in your team's browsers.

```json
// Extension update manifest (hosted on internal server)
{
  "manifest_version": 3,
  "name": "OpenCode Visual Editor",
  "version": "1.0.0",
  "description": "Make visual changes to your React app with AI",
  "minimum_chrome_version": "88",
  "permissions": ["activeTab", "sidePanel", "storage"],
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "content_scripts": [{
    "matches": ["https://your-app.com/*"],
    "js": ["content.js"]
  }],
  "update_url": "https://updates.yourcompany.com/extension.xml"
}
```

**Chrome Enterprise Policy (via MDM):**

```json
// MDM Policy Template (for Jamf, Intune, etc.)
{
  "ExtensionInstallForcelist": [
    "your-extension-id;https://updates.yourcompany.com/extension.xml"
  ],
  "ExtensionSettings": {
    "your-extension-id": {
      "installation_mode": "force_installed",
      "update_url": "https://updates.yourcompany.com/extension.xml"
    }
  }
}
```

**Extension Update Server:**

Stand up a simple server that serves the XML manifest and CRX file:

```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='your-extension-id'>
    <updatecheck codebase='https://updates.yourcompany.com/opencode-extension-1.0.0.crx'
                 version='1.0.0' />
  </app>
</gupdate>
```

```typescript
// Simple update server using Hono
import { Hono } from 'hono'

const app = new Hono()

app.get('/extension.xml', (c) => {
  c.header('Content-Type', 'application/xml')
  return c.body(generateUpdateManifest())
})

app.get('/opencode-extension-:version.crx', async (c) => {
  const version = c.req.param('version')
  const crxPath = `./releases/opencode-extension-${version}.crx`
  const crx = await Bun.file(crxPath).arrayBuffer()
  c.header('Content-Type', 'application/x-chrome-extension')
  return c.body(crx)
})
```

### 9.4 Voice Interface

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                    Voice Interface Flow                      │
├─────────────────────────────────────────────────────────────┤
│  Audio Input → Speech Recognition → Text → OpenCode API      │
│                                                              │
│  OpenCode Response → Text-to-Speech → Audio Output           │
└─────────────────────────────────────────────────────────────┘
```

**Browser-Based Speech Recognition:**

Leverages Web Speech API for zero-latency local recognition:

```typescript
// packages/app/src/utils/speech.ts
export interface VoiceConfig {
  lang: string           // "en-US"
  continuous: boolean    // Keep listening
  interimResults: boolean // Show partial results
  commitDelay: number    // ms before finalizing
}

export function createSpeechRecognition(config: VoiceConfig) {
  const recognition = new webkitSpeechRecognition()

  recognition.lang = config.lang
  recognition.continuous = config.continuous
  recognition.interimResults = config.interimResults

  let finalTranscript = ''
  let interimTranscript = ''
  let commitTimer: NodeJS.Timeout

  recognition.onresult = (event) => {
    interimTranscript = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript
      if (event.results[i].isFinal) {
        finalTranscript += transcript
      } else {
        interimTranscript += transcript
      }
    }

    // Commit after silence
    clearTimeout(commitTimer)
    commitTimer = setTimeout(() => {
      if (finalTranscript) {
        onFinal(finalTranscript)
        finalTranscript = ''
      }
    }, config.commitDelay)
  }

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
    onInterim: (cb: (text: string) => void) => { onInterim = cb },
    onFinal: (cb: (text: string) => void) => { onFinal = cb }
  }
}
```

**Use Cases:**
- Kick off sessions while winding down for the night
- Talk to it on mobile while on the couch
- Hands-free prompting during testing

### 9.5 Mobile Web Support

**Explicit Requirements:**
- Responsive design for all web interface components
- Touch-friendly interaction patterns
- PWA capabilities for installable mobile experience
- Optimized data transfer for mobile networks

**Minimum Viewport Support:**
- Width: 320px minimum (iPhone SE)
- Touch targets: 44x44px minimum (Apple HIG)

**Mobile-Specific Patterns:**

```typescript
// packages/app/src/components/MobileLayout.tsx
export const MobileLayout = ({ children }) => {
  const isMobile = useMediaQuery('(max-width: 768px)')

  return (
    <div class={isMobile ? 'mobile-layout' : 'desktop-layout'}>
      {isMobile ? (
        <>
          <BottomNavigation />
          <SwipeableDrawer>{/* Sidebar content */}</SwipeableDrawer>
          <main>{children}</main>
        </>
      ) : (
        <>
          <Sidebar />
          <main>{children}</main>
        </>
      )}
    </div>
  )
}
```

**PWA Manifest:**

```json
{
  "name": "OpenCode Hosted",
  "short_name": "OpenCode",
  "display": "standalone",
  "orientation": "any",
  "start_url": "/",
  "theme_color": "#1a1a1a",
  "background_color": "#1a1a1a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**Mobile Use Cases:**
- Check PR status from mobile
- Resume sessions from couch after dinner
- Quick bug fixes on the go
- Review agent progress remotely

### 9.6 GitHub PR Discussion Interface

Discuss directly on Pull Requests and have the agent respond to review comments.

**Features:**
- Comment on PRs to request changes from the agent
- Agent responds to review comments with code changes
- Sync between PR discussions and active sessions
- Automatic re-push after addressing comments

**Webhook Integration:**

```typescript
// packages/clients/github-pr/src/webhook-handler.ts
export const GitHubWebhookHandler = {
  // Handle PR review comments
  async handlePullRequestReviewComment(payload: PullRequestReviewCommentEvent) {
    const { comment, pull_request, repository } = payload

    // Check if comment is directed at the agent
    if (!isAgentMention(comment.body)) return

    // Find or create session for this PR
    const session = await findOrCreatePRSession({
      repo: repository.full_name,
      prNumber: pull_request.number,
      branch: pull_request.head.ref,
      author: comment.user.login
    })

    // Extract the request from the comment
    const prompt = extractPromptFromComment(comment.body)

    // Queue the prompt in the session
    await session.queuePrompt({
      content: prompt,
      userID: comment.user.id,
      context: {
        file: comment.path,
        line: comment.line,
        originalComment: comment.body
      }
    })

    // React to acknowledge receipt
    await github.reactions.createForPullRequestReviewComment({
      owner: repository.owner.login,
      repo: repository.name,
      comment_id: comment.id,
      content: "eyes"
    })
  },

  // Handle issue comments on PRs
  async handleIssueComment(payload: IssueCommentEvent) {
    if (!payload.issue.pull_request) return

    const { comment, issue, repository } = payload

    if (!isAgentMention(comment.body)) return

    // Similar flow to review comments
    const session = await findOrCreatePRSession({
      repo: repository.full_name,
      prNumber: issue.number,
      branch: await getPRBranch(repository, issue.number),
      author: comment.user.login
    })

    await session.queuePrompt({
      content: extractPromptFromComment(comment.body),
      userID: comment.user.id
    })
  }
}
```

**PR Session Model:**

```typescript
export namespace PRSession {
  export const Info = z.object({
    id: z.string(),
    sessionID: z.string(),         // Underlying OpenCode session
    repository: z.string(),
    prNumber: z.number(),
    branch: z.string(),
    status: z.enum(["active", "waiting", "completed"]),

    // Track which comments have been addressed
    addressedComments: z.array(z.object({
      commentID: z.number(),
      addressedAt: z.number(),
      commitSHA: z.string()
    })),

    // Auto-respond when changes are pushed
    lastPushAt: z.number().optional()
  })
}
```

**Response Flow:**

```typescript
// After agent completes addressing a comment
async function handleCommentAddressed(
  session: PRSession.Info,
  commentID: number,
  commitSHA: string
) {
  // Reply to the comment with what was done
  await github.pulls.createReplyForReviewComment({
    owner,
    repo,
    pull_number: session.prNumber,
    comment_id: commentID,
    body: `✅ Addressed in ${commitSHA.slice(0, 7)}

Changes made:
${await session.getLastChangeSummary()}

[View session](${getSessionURL(session.sessionID)})`
  })

  // Mark comment as addressed
  await session.markCommentAddressed(commentID, commitSHA)
}
```

---

## 10. Security Considerations

### 10.1 Sandbox Isolation

```typescript
const SandboxSecurityConfig = {
  network: {
    allowedEgress: ["*.github.com", "*.npmjs.org", "api.anthropic.com"],
    denyEgress: ["169.254.169.254", "metadata.google.internal"]
  },
  filesystem: {
    readOnlyPaths: ["/etc", "/usr"],
    writablePaths: ["/workspace", "/tmp"]
  },
  limits: {
    maxProcesses: 100,
    maxMemoryMB: 8192,
    maxExecutionTimeMs: 3600000
  }
}
```

### 10.2 Authentication

- GitHub OAuth for user identity + PR permissions
- Session tokens with scoped permissions
- Rate limiting per endpoint category

### 10.3 PR Creation

- PRs opened with user's GitHub token (not app)
- Prevents self-approval vector
- Maintains audit trail of who prompted what

---

## 11. Event Bus Extensions

New events to add to `packages/opencode/src/bus/bus-event.ts`:

```typescript
// Sandbox events
"sandbox.created" | "sandbox.updated" | "sandbox.git.synced" |
"sandbox.service.ready" | "sandbox.terminated"

// Multiplayer events
"multiplayer.user.joined" | "multiplayer.user.left" |
"multiplayer.cursor.moved" | "multiplayer.prompt.queued" |
"multiplayer.state.changed"

// Background agent events
"background.spawned" | "background.status" | "background.completed"

// Integration events
"integration.github.webhook" | "integration.slack.message"

// Voice events
"voice.started" | "voice.transcript.interim" | "voice.transcript.final" | "voice.stopped"

// Desktop streaming events
"desktop.started" | "desktop.stopped" | "desktop.screenshot.captured"

// Statistics events
"stats.prompt.sent" | "stats.session.created" | "stats.pr.created" | "stats.pr.merged"

// Image build events
"image.build.started" | "image.build.completed" | "image.build.failed"

// Warm pool events
"warmpool.sandbox.claimed" | "warmpool.sandbox.returned" | "warmpool.typing.detected"

// Editor events
"editor.opened" | "editor.file.saved" | "editor.closed"

// PR discussion events
"pr.comment.received" | "pr.comment.addressed" | "pr.session.created" |
"pr.changes.pushed"

// Skills events
"skill.invoked" | "skill.completed" | "skill.custom.loaded"
```

---

## 12. OpenTelemetry Observability

The hosted agent system uses OpenTelemetry (OTel) for comprehensive observability. All telemetry is exported to Datadog via the OTel Collector.

### 12.1 Trace Definitions

```typescript
import { trace, SpanStatusCode, context } from '@opentelemetry/api'

const tracer = trace.getTracer('opencode-hosted-agent', '1.0.0')

// Semantic conventions for hosted agent spans
export const SpanNames = {
  // Sandbox lifecycle
  SANDBOX_CREATE: 'sandbox.create',
  SANDBOX_GIT_SYNC: 'sandbox.git.sync',
  SANDBOX_SNAPSHOT_CREATE: 'sandbox.snapshot.create',
  SANDBOX_SNAPSHOT_RESTORE: 'sandbox.snapshot.restore',
  SANDBOX_TERMINATE: 'sandbox.terminate',

  // Warm pool
  WARMPOOL_CLAIM: 'warmpool.claim',
  WARMPOOL_REPLENISH: 'warmpool.replenish',

  // Prompt execution
  PROMPT_EXECUTE: 'prompt.execute',
  PROMPT_QUEUE: 'prompt.queue',
  TOOL_EXECUTE: 'tool.execute',

  // Client operations
  CLIENT_CONNECT: 'client.connect',
  CLIENT_SYNC: 'client.sync',

  // Integrations
  SLACK_MESSAGE_PROCESS: 'slack.message.process',
  GITHUB_WEBHOOK_PROCESS: 'github.webhook.process',
  PR_COMMENT_RESPOND: 'pr.comment.respond',
} as const

// Span attributes following OTel semantic conventions
export const SpanAttributes = {
  // Session context
  SESSION_ID: 'opencode.session.id',
  USER_ID: 'opencode.user.id',
  ORGANIZATION_ID: 'opencode.organization.id',

  // Sandbox context
  SANDBOX_ID: 'opencode.sandbox.id',
  SANDBOX_STATUS: 'opencode.sandbox.status',
  SANDBOX_IMAGE_TAG: 'opencode.sandbox.image_tag',

  // Repository context
  GIT_REPO: 'vcs.repository.url.full',
  GIT_BRANCH: 'vcs.repository.ref.name',
  GIT_COMMIT: 'vcs.repository.ref.revision',

  // Prompt context
  PROMPT_ID: 'opencode.prompt.id',
  PROMPT_LENGTH: 'opencode.prompt.length',
  TOOL_NAME: 'opencode.tool.name',
  TOOL_BLOCKED: 'opencode.tool.blocked',

  // Client context
  CLIENT_TYPE: 'opencode.client.type',
  CLIENT_VERSION: 'opencode.client.version',

  // Snapshot context
  SNAPSHOT_ID: 'opencode.snapshot.id',
  SNAPSHOT_SIZE_BYTES: 'opencode.snapshot.size_bytes',

  // Performance
  QUEUE_WAIT_MS: 'opencode.queue.wait_ms',
  WARMPOOL_HIT: 'opencode.warmpool.hit',
} as const
```

### 12.2 Trace Examples

```typescript
// Sandbox creation with full context propagation
export async function createSandbox(
  sessionID: string,
  repo: Repository
): Promise<Sandbox> {
  return tracer.startActiveSpan(SpanNames.SANDBOX_CREATE, async (span) => {
    span.setAttributes({
      [SpanAttributes.SESSION_ID]: sessionID,
      [SpanAttributes.GIT_REPO]: repo.url,
      [SpanAttributes.GIT_BRANCH]: repo.branch,
    })

    try {
      // Try warm pool first
      const warmSandbox = await tracer.startActiveSpan(
        SpanNames.WARMPOOL_CLAIM,
        async (claimSpan) => {
          const result = await warmPool.claim(repo.imageTag)
          claimSpan.setAttributes({
            [SpanAttributes.WARMPOOL_HIT]: result !== null,
            [SpanAttributes.SANDBOX_IMAGE_TAG]: repo.imageTag,
          })
          return result
        }
      )

      const sandbox = warmSandbox ?? await modal.Sandbox.create(repo.imageTag)

      // Git sync as child span
      await tracer.startActiveSpan(
        SpanNames.SANDBOX_GIT_SYNC,
        async (syncSpan) => {
          syncSpan.setAttributes({
            [SpanAttributes.SANDBOX_ID]: sandbox.id,
            [SpanAttributes.GIT_REPO]: repo.url,
          })
          await sandbox.runCommand('git', ['fetch', 'origin', repo.branch])
          await sandbox.runCommand('git', ['checkout', repo.commit])
          syncSpan.setAttributes({
            [SpanAttributes.GIT_COMMIT]: repo.commit,
          })
        }
      )

      span.setAttributes({
        [SpanAttributes.SANDBOX_ID]: sandbox.id,
        [SpanAttributes.SANDBOX_STATUS]: 'ready',
      })

      return sandbox
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
      span.recordException(error)
      throw error
    } finally {
      span.end()
    }
  })
}

// Prompt execution with queue timing
export async function executePrompt(
  session: Session,
  prompt: Prompt
): Promise<void> {
  return tracer.startActiveSpan(SpanNames.PROMPT_EXECUTE, async (span) => {
    const queueWaitMs = Date.now() - prompt.queuedAt

    span.setAttributes({
      [SpanAttributes.SESSION_ID]: session.id,
      [SpanAttributes.PROMPT_ID]: prompt.id,
      [SpanAttributes.PROMPT_LENGTH]: prompt.content.length,
      [SpanAttributes.USER_ID]: prompt.userID,
      [SpanAttributes.QUEUE_WAIT_MS]: queueWaitMs,
    })

    // Tool calls as child spans
    for (const toolCall of prompt.toolCalls) {
      await tracer.startActiveSpan(SpanNames.TOOL_EXECUTE, async (toolSpan) => {
        toolSpan.setAttributes({
          [SpanAttributes.TOOL_NAME]: toolCall.name,
          [SpanAttributes.TOOL_BLOCKED]: toolCall.blocked,
        })
        // ... execute tool
      })
    }
  })
}
```

### 12.3 Metric Definitions

```typescript
import { metrics } from '@opentelemetry/api'

const meter = metrics.getMeter('opencode-hosted-agent', '1.0.0')

// Counters
export const sessionCounter = meter.createCounter('opencode.sessions.created', {
  description: 'Number of sessions created',
  unit: '1',
})

export const promptCounter = meter.createCounter('opencode.prompts.executed', {
  description: 'Number of prompts executed',
  unit: '1',
})

export const toolCallCounter = meter.createCounter('opencode.tool_calls.total', {
  description: 'Number of tool calls made',
  unit: '1',
})

export const snapshotCounter = meter.createCounter('opencode.snapshots.created', {
  description: 'Number of snapshots created',
  unit: '1',
})

// Histograms
export const promptLatencyHistogram = meter.createHistogram(
  'opencode.prompt.latency',
  {
    description: 'Prompt execution latency',
    unit: 'ms',
    advice: {
      explicitBucketBoundaries: [
        100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000
      ],
    },
  }
)

export const sandboxStartupHistogram = meter.createHistogram(
  'opencode.sandbox.startup_time',
  {
    description: 'Time to create and initialize sandbox',
    unit: 'ms',
    advice: {
      explicitBucketBoundaries: [500, 1000, 2000, 5000, 10000, 20000, 30000],
    },
  }
)

export const gitSyncHistogram = meter.createHistogram(
  'opencode.git_sync.duration',
  {
    description: 'Git sync duration',
    unit: 'ms',
    advice: {
      explicitBucketBoundaries: [100, 500, 1000, 2000, 5000, 10000],
    },
  }
)

export const snapshotRestoreHistogram = meter.createHistogram(
  'opencode.snapshot.restore_time',
  {
    description: 'Time to restore from snapshot',
    unit: 'ms',
    advice: {
      explicitBucketBoundaries: [100, 250, 500, 1000, 2000, 5000],
    },
  }
)

export const queueWaitHistogram = meter.createHistogram(
  'opencode.prompt.queue_wait',
  {
    description: 'Time prompts spend in queue',
    unit: 'ms',
    advice: {
      explicitBucketBoundaries: [0, 100, 500, 1000, 5000, 10000, 30000],
    },
  }
)

// Gauges (using UpDownCounter for gauges in OTel)
export const activeSandboxGauge = meter.createUpDownCounter(
  'opencode.sandboxes.active',
  {
    description: 'Number of active sandboxes',
    unit: '1',
  }
)

export const warmPoolSizeGauge = meter.createUpDownCounter(
  'opencode.warmpool.size',
  {
    description: 'Number of sandboxes in warm pool',
    unit: '1',
  }
)

export const queuedPromptsGauge = meter.createUpDownCounter(
  'opencode.prompts.queued',
  {
    description: 'Number of prompts in queue',
    unit: '1',
  }
)

export const connectedClientsGauge = meter.createUpDownCounter(
  'opencode.clients.connected',
  {
    description: 'Number of connected clients',
    unit: '1',
  }
)

// Observable gauges for snapshot metrics
meter.createObservableGauge('opencode.snapshots.active', {
  description: 'Number of active (non-expired) snapshots',
  unit: '1',
}, (observableResult) => {
  observableResult.observe(snapshotStore.getActiveCount())
})

meter.createObservableGauge('opencode.snapshots.total_size', {
  description: 'Total size of all snapshots',
  unit: 'By',
}, (observableResult) => {
  observableResult.observe(snapshotStore.getTotalSizeBytes())
})
```

### 12.4 Metric Recording Examples

```typescript
// Record session creation with attributes
sessionCounter.add(1, {
  [SpanAttributes.CLIENT_TYPE]: 'web',
  [SpanAttributes.ORGANIZATION_ID]: session.orgID,
})

// Record prompt execution with detailed attributes
promptCounter.add(1, {
  [SpanAttributes.SESSION_ID]: session.id,
  [SpanAttributes.CLIENT_TYPE]: session.clientType,
  'opencode.prompt.has_tools': prompt.toolCalls.length > 0,
})

// Record latency histograms
promptLatencyHistogram.record(executionTimeMs, {
  [SpanAttributes.SESSION_ID]: session.id,
  'opencode.prompt.tool_count': toolCallCount,
})

sandboxStartupHistogram.record(startupTimeMs, {
  [SpanAttributes.WARMPOOL_HIT]: fromWarmPool,
  [SpanAttributes.SANDBOX_IMAGE_TAG]: imageTag,
})

// Track warm pool hit rate
toolCallCounter.add(1, {
  [SpanAttributes.TOOL_NAME]: toolName,
  [SpanAttributes.TOOL_BLOCKED]: blocked,
  'opencode.tool.sync_status': syncStatus,
})
```

### 12.5 Structured Log Format

```typescript
import { logs, SeverityNumber } from '@opentelemetry/api-logs'

const logger = logs.getLogger('opencode-hosted-agent', '1.0.0')

// Log record structure following OTel semantic conventions
interface LogAttributes {
  // Always include trace context for correlation
  'trace_id'?: string
  'span_id'?: string

  // Session context
  'opencode.session.id': string
  'opencode.user.id'?: string
  'opencode.organization.id'?: string

  // Event-specific attributes
  'event.name': string
  'event.domain': 'sandbox' | 'prompt' | 'client' | 'integration' | 'system'

  // Error context (when applicable)
  'exception.type'?: string
  'exception.message'?: string
  'exception.stacktrace'?: string
}

// Logging helpers with automatic context propagation
export function logInfo(message: string, attrs: Partial<LogAttributes>) {
  const span = trace.getActiveSpan()
  logger.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: 'INFO',
    body: message,
    attributes: {
      ...attrs,
      'trace_id': span?.spanContext().traceId,
      'span_id': span?.spanContext().spanId,
    },
  })
}

export function logError(
  message: string,
  error: Error,
  attrs: Partial<LogAttributes>
) {
  const span = trace.getActiveSpan()
  logger.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
    body: message,
    attributes: {
      ...attrs,
      'trace_id': span?.spanContext().traceId,
      'span_id': span?.spanContext().spanId,
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack,
    },
  })
}

// Example log events
logInfo('Sandbox created', {
  'event.name': 'sandbox.created',
  'event.domain': 'sandbox',
  'opencode.session.id': sessionID,
  'opencode.sandbox.id': sandboxID,
})

logInfo('Prompt queued', {
  'event.name': 'prompt.queued',
  'event.domain': 'prompt',
  'opencode.session.id': sessionID,
  'opencode.prompt.id': promptID,
  'opencode.user.id': userID,
})

logError('Git sync failed', error, {
  'event.name': 'sandbox.git.sync.failed',
  'event.domain': 'sandbox',
  'opencode.session.id': sessionID,
  'opencode.sandbox.id': sandboxID,
})
```

### 12.6 Event Catalog

| Event Name | Domain | Severity | Description |
|------------|--------|----------|-------------|
| `sandbox.created` | sandbox | INFO | New sandbox created |
| `sandbox.ready` | sandbox | INFO | Sandbox initialization complete |
| `sandbox.git.sync.started` | sandbox | INFO | Git sync started |
| `sandbox.git.sync.completed` | sandbox | INFO | Git sync completed |
| `sandbox.git.sync.failed` | sandbox | ERROR | Git sync failed |
| `sandbox.snapshot.created` | sandbox | INFO | Snapshot created |
| `sandbox.snapshot.restored` | sandbox | INFO | Sandbox restored from snapshot |
| `sandbox.terminated` | sandbox | INFO | Sandbox terminated |
| `warmpool.sandbox.claimed` | sandbox | INFO | Sandbox claimed from warm pool |
| `warmpool.replenished` | sandbox | DEBUG | Warm pool replenished |
| `prompt.queued` | prompt | INFO | Prompt added to queue |
| `prompt.started` | prompt | INFO | Prompt execution started |
| `prompt.completed` | prompt | INFO | Prompt execution completed |
| `prompt.failed` | prompt | ERROR | Prompt execution failed |
| `prompt.cancelled` | prompt | INFO | Prompt cancelled by user |
| `tool.executed` | prompt | DEBUG | Tool call executed |
| `tool.blocked` | prompt | WARN | Tool call blocked (pre-sync) |
| `client.connected` | client | INFO | Client connected |
| `client.disconnected` | client | INFO | Client disconnected |
| `client.state.synced` | client | DEBUG | Client state synchronized |
| `multiplayer.user.joined` | client | INFO | User joined multiplayer session |
| `multiplayer.user.left` | client | INFO | User left multiplayer session |
| `slack.message.received` | integration | INFO | Slack message received |
| `slack.response.sent` | integration | INFO | Response sent to Slack |
| `github.webhook.received` | integration | INFO | GitHub webhook received |
| `github.pr.created` | integration | INFO | Pull request created |
| `pr.comment.received` | integration | INFO | PR comment received |
| `pr.comment.responded` | integration | INFO | Response posted to PR |
| `image.build.started` | system | INFO | Container image build started |
| `image.build.completed` | system | INFO | Container image build completed |
| `image.build.failed` | system | ERROR | Container image build failed |

### 12.7 OTel Collector Configuration

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 10s
    send_batch_size: 1000

  attributes:
    actions:
      - key: deployment.environment
        value: ${ENVIRONMENT}
        action: insert
      - key: service.name
        value: opencode-hosted-agent
        action: insert
      - key: service.version
        value: ${VERSION}
        action: insert

  # Filter out high-volume debug logs in production
  filter/logs:
    logs:
      exclude:
        match_type: strict
        severity_texts: ["DEBUG"]

exporters:
  datadog:
    api:
      key: ${DD_API_KEY}
      site: datadoghq.com

    traces:
      span_name_as_resource_name: true
      trace_buffer: 500

    metrics:
      histograms:
        mode: distributions

    logs:
      dump_payloads: false

  # Sentry for error tracking
  sentry:
    dsn: ${SENTRY_DSN}

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, attributes]
      exporters: [datadog]

    metrics:
      receivers: [otlp]
      processors: [batch, attributes]
      exporters: [datadog]

    logs:
      receivers: [otlp]
      processors: [batch, attributes, filter/logs]
      exporters: [datadog, sentry]
```

### 12.8 SDK Initialization

```typescript
// packages/opencode/src/telemetry/init.ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc'
import { Resource } from '@opentelemetry/resources'
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import {
  getNodeAutoInstrumentations
} from '@opentelemetry/auto-instrumentations-node'
import {
  PeriodicExportingMetricReader
} from '@opentelemetry/sdk-metrics'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'

export function initTelemetry() {
  const collectorEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317'

  const sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: 'opencode-hosted-agent',
      [SEMRESATTRS_SERVICE_VERSION]: process.env.VERSION ?? '0.0.0',
      'deployment.environment': process.env.ENVIRONMENT ?? 'development',
    }),

    traceExporter: new OTLPTraceExporter({
      url: collectorEndpoint,
    }),

    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: collectorEndpoint,
      }),
      exportIntervalMillis: 15000,
    }),

    logRecordProcessor: new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: collectorEndpoint,
      })
    ),

    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => {
            // Ignore health checks
            return req.url === '/health' || req.url === '/ready'
          },
        },
        '@opentelemetry/instrumentation-fs': {
          enabled: false, // Too noisy for sandbox operations
        },
      }),
    ],
  })

  sdk.start()

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('Telemetry shut down'))
      .catch((error) => console.error('Error shutting down telemetry', error))
      .finally(() => process.exit(0))
  })
}
```

---

## 13. Files to Modify

| File | Changes |
|------|---------|
| `packages/opencode/src/server/server.ts` | Add sandbox, multiplayer, background routes |
| `packages/opencode/src/session/index.ts` | Extend Session.Info with hosted fields |
| `packages/opencode/src/tool/registry.ts` | Register spawn_session, check_session, use_skill tools |
| `packages/opencode/src/config/config.ts` | Add HostedConfig schema |
| `packages/opencode/src/bus/bus-event.ts` | Add new event definitions |
| `packages/plugin/src/index.ts` | Extend Hooks interface |
| `packages/opencode/src/skill/index.ts` | New: Skills system implementation |
| `packages/opencode/src/skill/loader.ts` | New: Load skills from .opencode/skills/ |
| `packages/clients/github-pr/src/index.ts` | New: GitHub PR discussion client |
| `packages/clients/github-pr/src/webhook-handler.ts` | New: Handle PR comments |

---

## 14. Verification Plan

1. **Sandbox Creation**: Create sandbox, verify services start, execute commands
2. **Git Sync Gating**: Attempt edit before sync, verify blocked; after sync, verify allowed
3. **Warm Pool**: Verify sandbox claimed from pool on prompt typing
4. **Multiplayer**: Multiple users join, verify cursor sync and prompt queue
5. **Background Agents**: Spawn agent, verify status updates, verify completion
6. **Slack Bot**: Send message, verify repo classification, verify session creation
7. **GitHub Integration**: Verify webhook processing, PR creation with correct user
8. **Skills System**: Load custom skills, invoke via tool, verify prompt injection
9. **PR Discussion**: Comment on PR, verify session creation, verify response posted
10. **Unlimited Concurrency**: Spawn 20+ sessions simultaneously, verify no throttling
11. **Voice Input**: Test speech recognition, verify prompt submission, verify interim display

---

## 15. Deployment Architecture

### 15.1 Infrastructure Components

```yaml
components:
  opencode-server:
    type: containerized
    replicas: auto-scaling
    services: [http-api, sse-events, websocket]

  sandbox-orchestrator:
    type: serverless
    provider: modal
    functions: [create-sandbox, warm-pool-manager, image-builder]

  state-store:
    type: cloudflare-durable-objects
    classes: [MultiplayerSession, PromptQueue, SandboxState]

  queues:
    type: cloudflare-queues
    queues: [background-jobs, webhook-events, prompt-queue]

  slack-bot:
    type: cloudflare-worker
    triggers: [http, scheduled]

  web-app:
    type: spa
    hosting: cloudflare-pages
```

### 15.2 Modal VM Configuration

```python
import modal

image = (
    modal.Image.debian_slim()
    .apt_install("git", "curl", "build-essential", "postgresql-client")
    .pip_install("temporal-sdk")
    .run_commands(
        "curl -fsSL https://bun.sh/install | bash",
        "curl -fsSL https://get.pnpm.io/install.sh | sh"
    )
)

@modal.cls(cpu=4, memory=8192, timeout=3600)
class Sandbox:
    @modal.enter()
    async def setup(self): pass

    @modal.method()
    async def execute(self, command: list[str]) -> dict: pass

    @modal.method()
    async def start_service(self, service: str) -> dict: pass
```

---

## 16. Success Metrics

Based on Ramp's experience:
- **Target**: ~30% of PRs merged written by the agent
- **Key metric**: PRs merged (not just created)
- **Secondary**: Sessions per user, time-to-first-token, session completion rate

### 16.1 Statistics Dashboard

**Live Metrics (Real-time):**

```typescript
export const LiveStats = z.object({
  humansPrompting: z.number(),    // Users who sent a prompt in last 5 minutes
  activeSessions: z.number(),      // Sessions with activity in last 15 minutes
  sandboxesInUse: z.number(),      // Currently allocated sandboxes
  promptsPerMinute: z.number()     // Current throughput
})

// Query for "humans prompting"
const humansPrompting = await db.query(`
  SELECT COUNT(DISTINCT user_id)
  FROM prompts
  WHERE timestamp > NOW() - INTERVAL 5 MINUTE
`)
```

**Historical Metrics:**

```typescript
export const HistoricalStats = z.object({
  period: z.enum(["day", "week", "month", "quarter"]),

  // Volume metrics
  totalSessions: z.number(),
  totalPrompts: z.number(),
  uniqueUsers: z.number(),

  // Success metrics
  prsCreated: z.number(),
  prsMerged: z.number(),
  mergeRate: z.number(),  // prsMerged / prsCreated

  // Efficiency metrics
  avgSessionDuration: z.number(),  // minutes
  avgTimeToFirstToken: z.number(), // ms
  sessionCompletionRate: z.number(),

  // Repository breakdown
  topRepositories: z.array(z.object({
    repo: z.string(),
    sessions: z.number(),
    prsMerged: z.number()
  })),

  // Model usage
  modelDistribution: z.record(z.string(), z.number())
})
```

**Dashboard Components:**

- **Merged PRs Chart**: Line chart showing PRs merged over time
- **Live Count**: Real-time "humans prompting" counter
- **Merge Rate**: Percentage of created PRs that get merged
- **Top Repositories**: Leaderboard of most active repositories
- **Growth Trends**: Week-over-week growth metrics

### 16.2 API Endpoint

```typescript
// GET /stats
app.get("/stats", async (c) => {
  const live = await LiveStats.get()
  const historical = await HistoricalStats.get({
    period: c.req.query("period") ?? "week"
  })

  return c.json({ live, historical })
})
```

### 16.3 Key Insights from Ramp

- **30% of PRs merged** was achieved in just a couple months
- **Adoption was organic** - no one was forced to use it
- **Virality loops** through working in public spaces (Slack channels)
- **Let the product do the talking** - quality drives adoption

---

## 17. OpenCode as Recommended Agent

This specification recommends **OpenCode** as the foundation for hosted background coding agents. Here's why:

### 17.1 Server-First Architecture

OpenCode's server-first design makes it ideal for hosted deployments:

```
┌─────────────────────────────────────────────────────────────┐
│                   OpenCode Architecture                      │
├─────────────────────────────────────────────────────────────┤
│  Server Core (Hono)                                          │
│  ├── REST API (OpenAPI spec)                                │
│  ├── SSE for streaming                                       │
│  └── WebSocket for PTY                                       │
│                                                              │
│  Clients (built on top)                                      │
│  ├── TUI (Terminal)                                         │
│  ├── Desktop (Tauri)                                        │
│  ├── Web App                                                │
│  └── Custom clients (you build)                             │
└─────────────────────────────────────────────────────────────┘
```

- All operations exposed via REST/SSE APIs
- No assumption of local filesystem access
- State management via server-side storage
- Multi-client support out of the box

### 17.2 Typed SDK

The TypeScript SDK (`packages/sdk`) provides:

```typescript
import { createOpencodeClient } from '@opencode-ai/sdk'

const client = createOpencodeClient({
  baseURL: 'https://your-hosted-instance.com',
  directory: '/workspace'
})

// Fully typed operations
const session = await client.session.create({
  title: 'Fix authentication bug'
})

await client.session.message({
  sessionID: session.id,
  content: 'Fix the login timeout issue'
})
```

- Type-safe client generation from OpenAPI spec
- Consistent API contracts across all clients
- IDE autocompletion and error detection
- Runtime validation via Zod schemas

### 17.3 Plugin System

Extensible plugin architecture enables customization:

```typescript
// Custom plugin for your organization
export const MyPlugin: Plugin = async ({ client }) => {
  return {
    // Gate edits until git sync complete
    "tool.execute.before": async ({ tool }, output) => {
      if (WRITE_TOOLS.includes(tool)) {
        const synced = await checkGitSync()
        if (!synced) output.blocked = true
      }
    },

    // Custom tools
    tool: {
      "my_custom_tool": {
        description: "Company-specific tool",
        parameters: z.object({ ... }),
        execute: async (args) => { ... }
      }
    },

    // Authentication
    auth: async (provider) => {
      return { type: "api", key: await getApiKey(provider) }
    }
  }
}
```

Key hooks for hosted deployment:
- `tool.execute.before` - Gate tools (git sync)
- `sandbox.ready` - React to sandbox events
- `prompt.typing` - Warm sandbox on keystroke
- Custom tool registration
- Authentication integrations

### 17.4 Readable Source Code

A critical advantage often overlooked:

> "If something is unclear from the documentation, you can simply ask the AI to read the code of OpenCode itself, and figure out exactly what the behaviour should be."

- Well-organized package structure
- Consistent coding patterns throughout
- Comprehensive type definitions
- Clear separation of concerns

**This matters because:**
- AI agents can understand their own behavior
- No hallucination about capabilities
- Source code is the source of truth
- Self-debugging becomes possible

### 17.5 Active Development

- Regular releases and updates
- Responsive to community feedback
- Modern toolchain (Bun, Hono, Solid.js)
- Production-proven architecture

### 17.6 Why Not Other Agents?

| Feature | OpenCode | Others |
|---------|----------|--------|
| Server-first | ✅ Built-in | ❌ Often CLI-only |
| Typed SDK | ✅ Full TypeScript | ⚠️ Varies |
| Plugin system | ✅ Comprehensive | ⚠️ Limited |
| Source readable | ✅ Clean, documented | ⚠️ Varies |
| Multi-client | ✅ Native | ❌ Often single-client |
| Custom tools | ✅ Easy to add | ⚠️ Complex |

---

## 18. Getting Started

1. **Fork OpenCode** and familiarize yourself with the codebase
2. **Set up Modal** account for sandbox orchestration
3. **Configure GitHub App** for repository access
4. **Deploy OpenCode server** with hosted configuration
5. **Build your first client** (start with Slack bot)
6. **Iterate** based on user feedback

The goal is to build something **significantly more powerful than off-the-shelf tools**. After all, it only has to work on your code.

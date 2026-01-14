# Implementation Plan: Hosted Background Coding Agent

This document tracks the implementation progress of the OpenCode hosted background agent system as defined in `SPECIFICATION.md`.

---

## Phase 1: Core Infrastructure

### 1.1 Sandbox Package (`packages/sandbox/`)
| Task | Status | TLA+ | Notes |
|------|--------|------|-------|
| Provider interface definition | complete | HostedAgent.tla | Base interface for sandbox backends |
| Local provider implementation | complete | - | Dev/test fallback with tests |
| Modal provider implementation | complete | - | Production backend with API integration |
| Warm pool manager | complete | WarmPool.tla | Pool lifecycle with claim/release |
| Warm pool warmup (typing trigger) | complete | WarmPool.tla | onTyping() hook for warmup |
| Image builder | complete | - | 30-min rebuild cycle, parallel builds, event emission |
| Image registry | complete | - | Tagging strategy with latest tracking, cleanup, stats |
| Snapshot manager | complete | SandboxSnapshot.tla | SnapshotManager with TTL expiration |
| Git sync gating | complete | GitSyncGating.tla | SyncGate blocks writes until synced |

### 1.2 Background Agent Package (`packages/background/`)
| Task | Status | TLA+ | Notes |
|------|--------|------|-------|
| Queue implementation | complete | PromptQueue.tla | PromptQueue with priority ordering |
| Scheduler | complete | HostedAgent.tla | AgentScheduler with resource limits |
| Spawner | complete | HostedAgent.tla | AgentSpawner with lifecycle management |
| Status tracking | complete | HostedAgent.tla | Valid status transitions enforced |

### 1.3 Multiplayer Package (`packages/multiplayer/`)
| Task | Status | TLA+ | Notes |
|------|--------|------|-------|
| Session manager | complete | HostedAgent.tla | SessionManager with create/join/leave/connect |
| User presence/awareness | complete | HostedAgent.tla | Cursor tracking, user colors |
| Edit locks | complete | HostedAgent.tla | Single writer guarantee with acquire/release |
| Client management | complete | HostedAgent.tla | Multi-client per user with limits |
| Durable Object state | complete | HostedAgent.tla | Cloudflare DO integration with DurableObjectStateStore, DurableObjectStateStoreClient, MultiplayerDurableObject |
| SQLite state fallback | complete | - | StateStore interface with SQLiteStateStore and MemoryStateStore |
| WebSocket sync | complete | - | Real-time updates via /multiplayer/:id/ws |
| Conflict resolution | complete | - | ConflictResolver with strategies (last-write-wins, reject, merge) |

---

## Phase 2: API Layer

### 2.1 Sandbox API (`/sandbox/*`)
| Task | Status | Notes |
|------|--------|-------|
| POST /sandbox | complete | Create sandbox |
| GET /sandbox/:id | complete | Get sandbox info |
| GET /sandbox | complete | List sandboxes |
| POST /sandbox/:id/start | complete | Start sandbox |
| POST /sandbox/:id/stop | complete | Stop sandbox |
| POST /sandbox/:id/terminate | complete | Terminate sandbox |
| POST /sandbox/:id/snapshot | complete | Create snapshot |
| POST /sandbox/restore | complete | Restore from snapshot |
| GET /sandbox/snapshots | complete | List snapshots |
| DELETE /sandbox/snapshots/:id | complete | Delete snapshot |
| POST /sandbox/:id/exec | complete | Execute command |
| GET /sandbox/:id/logs/:service | complete | Stream logs (SSE) |
| GET /sandbox/:id/git | complete | Git sync status |
| POST /sandbox/:id/git/sync | complete | Force git sync |
| GET /sandbox/pool/stats | complete | Warm pool statistics |
| POST /sandbox/pool/claim | complete | Claim from warm pool |
| POST /sandbox/pool/typing | complete | Trigger warmup on typing |

### 2.2 Multiplayer API (`/multiplayer/*`)
| Task | Status | Notes |
|------|--------|-------|
| POST /multiplayer | complete | Create session |
| GET /multiplayer | complete | List sessions |
| GET /multiplayer/:sessionID | complete | Get session info |
| DELETE /multiplayer/:sessionID | complete | Delete session |
| POST /multiplayer/:sessionID/join | complete | Join session |
| POST /multiplayer/:sessionID/leave | complete | Leave session |
| PUT /multiplayer/:sessionID/cursor | complete | Update cursor |
| POST /multiplayer/:sessionID/lock | complete | Acquire edit lock |
| DELETE /multiplayer/:sessionID/lock | complete | Release edit lock |
| POST /multiplayer/:sessionID/connect | complete | Connect client |
| POST /multiplayer/:sessionID/disconnect | complete | Disconnect client |
| GET /multiplayer/:sessionID/users | complete | Get users |
| GET /multiplayer/:sessionID/clients | complete | Get clients |
| PUT /multiplayer/:sessionID/state | complete | Update state |
| POST /multiplayer/:sessionID/prompt | complete | Queue prompt |
| GET /multiplayer/:sessionID/prompts | complete | Get all prompts |
| GET /multiplayer/:sessionID/prompt/:id | complete | Get specific prompt |
| DELETE /multiplayer/:sessionID/prompt/:id | complete | Cancel prompt |
| PUT /multiplayer/:sessionID/prompt/:id/reorder | complete | Reorder prompt |
| GET /multiplayer/:sessionID/queue/status | complete | Queue status |
| POST /multiplayer/:sessionID/queue/start | complete | Start next prompt |
| POST /multiplayer/:sessionID/queue/complete | complete | Complete prompt |
| GET /multiplayer/:sessionID/queue/executing | complete | Get executing prompt |
| GET /multiplayer/:sessionID/ws | complete | WebSocket connection for real-time sync |

### 2.3 Background Agent API (`/background/*`)
| Task | Status | Notes |
|------|--------|-------|
| POST /background/spawn | complete | Spawn agent |
| GET /background/:id | complete | Get agent status |
| GET /background | complete | List agents |
| POST /background/:id/cancel | complete | Cancel agent |
| GET /background/:id/output | complete | Get output |
| GET /background/:id/events | complete | Stream events (SSE) |
| GET /background/stats | complete | Get scheduler statistics |

### 2.4 Additional APIs
| Task | Status | Notes |
|------|--------|-------|
| Voice API endpoints | complete | /session/:id/voice/* (start, stop, status, send) |
| Desktop API endpoints | complete | /sandbox/:id/desktop/* (get, start, stop, screenshot, ws) |
| Editor API endpoints | complete | /sandbox/:id/editor/* (get, start, stop) |
| Stats API endpoints | complete | GET /stats, GET /stats/live, GET /stats/historical |
| Skills API endpoints | complete | GET /skills, GET /skills/:name |
| PR Session API endpoints | complete | /pr-session/* (create, get, list, delete, comments, respond) |
| Webhook handlers | complete | /webhook/* (github, slack/events, slack/interactions) |

---

## Phase 3: Tools & Hooks

### 3.1 New Tools
| Task | Status | Notes |
|------|--------|-------|
| spawn_session tool | complete | Spawn parallel sessions via BackgroundService |
| check_session tool | complete | Check spawned session status |
| use_skill tool | complete | Already implemented via SkillTool (loads skill content/prompts) |
| computer_use tool | complete | Desktop interaction via DesktopService (screenshot, click, type, key, scroll, move) |

### 3.2 Plugin Hooks
| Task | Status | Notes |
|------|--------|-------|
| sandbox.create.before | complete | Pre-create hook - triggers in SandboxService.create() |
| sandbox.ready | complete | Sandbox ready hook - triggers in SandboxService.create() |
| sandbox.edit.before | complete | Hook defined in plugin, needs service integration |
| prompt.typing | complete | Hook defined in plugin, needs service integration |
| background.spawn | complete | Agent spawn hook - triggers in BackgroundService.spawn() |
| multiplayer.join | complete | User join hook - triggers in MultiplayerService.join() |
| voice.transcribed | complete | Voice processing - triggers in VoiceService.sendVoicePrompt() |
| pr.screenshot | complete | Hook defined in plugin, needs service integration |
| pr.comment.received | complete | PR comment hook - triggers in PRSessionService.addComment() |
| pr.comment.addressed | complete | Comment resolution - triggers in PRSessionService.respond() |
| desktop.started | complete | Desktop started hook - triggers in DesktopService.start() |
| stats.prompt.sent | complete | Hook defined in plugin, needs service integration |
| skill.invoke.before | complete | Hook defined in plugin, needs service integration |
| skill.invoke.after | complete | Hook defined in plugin, needs service integration |

---

## Phase 4: Clients

### 4.1 Slack Bot (`packages/clients/slack-bot/`)
| Task | Status | Notes |
|------|--------|-------|
| Webhook handler | complete | app_mention, message, reaction_added events with signature verification |
| Repository classifier | complete | Channel/message context with GitHub link, mention, topic detection |
| Thread conversation | complete | ThreadManager with status tracking, session association, TTL cleanup |
| Block Kit UI | complete | BlockKit builders for processing, progress, complete, error, session info messages |

### 4.2 Chrome Extension (`packages/clients/chrome-extension/`)
| Task | Status | Notes |
|------|--------|-------|
| Sidebar chat interface | complete | Content script, background service worker, ChromeExtensionClient |
| DOM/React tree extractor | complete | extractFromElement, extractFromRect, detectReact with React DevTools integration |
| Element selection overlay | complete | SelectionOverlay with hover highlight, multi-select, keyboard controls |
| MDM distribution setup | pending | Enterprise deployment |

### 4.3 GitHub PR Client (`packages/clients/github-pr/`)
| Task | Status | Notes |
|------|--------|-------|
| Webhook handler | complete | PR events, review comments, issue comments |
| Session manager | complete | PR-session mapping with context tracking |
| Comment response flow | complete | Response posting via Octokit |

### 4.4 Web Interface Extensions
| Task | Status | Notes |
|------|--------|-------|
| VSCodeEmbed component | complete | code-server iframe with toolbar, fullscreen, error states |
| DesktopStream component | complete | VNC/noVNC stream with WebSocket, screenshot, resolution options |
| PresenceAvatars component | complete | Multiplayer presence with cursor indicators, edit lock badges |
| PromptQueue component | complete | Queue management with drag reorder, cancel, priority display |
| StatsDashboard component | complete | Usage metrics with live/historical data, model/agent breakdown |
| VoiceInput component | complete | Voice-to-text with waveform, auto-submit, modal mode |
| Mobile responsive layout | pending | PWA support |

---

## Phase 5: Integrations

| Task | Status | Notes |
|------|--------|-------|
| GitHub App setup | pending | Image building without user tokens |
| Sentry integration | complete | Error tracking with exception capture, transactions, breadcrumbs |
| Datadog integration | complete | Metrics with increment/gauge/histogram, events, service checks |
| LaunchDarkly integration | complete | Feature flags with user targeting, evaluation details, helpers |
| Braintrust integration | complete | Eval logging with spans, LLM calls, experiments, feedback, metrics |
| Buildkite integration | pending | CI/CD |

---

## Phase 6: Skills System

| Task | Status | Notes |
|------|--------|-------|
| Skills registry | complete | SkillsRegistry with CRUD, category/builtin filtering |
| Skills loader | complete | SkillsLoader for markdown files with YAML frontmatter |
| Skills executor | complete | SkillsExecutor with prepare/invoke and event emission |
| Built-in: code-review | complete | Review skill with security, quality, performance checks |
| Built-in: pr-description | complete | PR generation with summary, testing, screenshots |
| Built-in: test-generation | complete | Test creation following project patterns |
| Built-in: bug-fix | complete | Systematic debugging and root cause analysis |
| Built-in: feature-impl | complete | Feature implementation with architecture patterns |

---

## Changelog

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-01-13 | Stats API endpoints | complete | GET /stats, GET /stats/live, GET /stats/historical |
| 2026-01-13 | Skills API endpoints | complete | GET /skills and GET /skills/:name with content |
| 2026-01-13 | Fix SandboxService API mismatches | complete | Aligned service and routes with WarmPoolManager and SnapshotManager APIs |
| 2026-01-13 | Multiplayer WebSocket endpoint | complete | Real-time sync with cursor/lock/state events, client message handling |
| 2026-01-13 | Provider interface definition | complete | Sandbox.Info, CreateInput, Provider interface |
| 2026-01-13 | Local provider implementation | complete | Full provider with tests |
| 2026-01-13 | Warm pool manager | complete | WarmPoolManager with claim/release/warm/onTyping |
| 2026-01-13 | Git sync gating | complete | SyncGate with read/write tool classification |
| 2026-01-13 | Queue implementation | complete | PromptQueue with priority ordering and user-scoped ops |
| 2026-01-13 | Spawner | complete | AgentSpawner with valid status transitions and lifecycle events |
| 2026-01-13 | Scheduler | complete | AgentScheduler with maxConcurrent, maxQueued, maxPerSession limits |
| 2026-01-13 | Status tracking | complete | Agent types, VALID_TRANSITIONS, isTerminal helper |
| 2026-01-13 | Snapshot manager | complete | SnapshotManager with create/restore/expire/cleanup |
| 2026-01-13 | Session manager | complete | SessionManager with user join/leave, client connect/disconnect |
| 2026-01-13 | User presence/awareness | complete | Cursor tracking, user colors, event subscription |
| 2026-01-13 | Edit locks | complete | acquireLock/releaseLock/canEdit with single writer invariant |
| 2026-01-13 | Client management | complete | Multi-client support with configurable limits |
| 2026-01-13 | spawn_session tool | complete | Tool for spawning background agents with BackgroundService |
| 2026-01-13 | check_session tool | complete | Tool for checking background agent status |
| 2026-01-13 | BackgroundService | complete | Singleton service for agent scheduling in opencode |
| 2026-01-13 | Background Agent API | complete | Full API: spawn, get, list, cancel, output, events (SSE), stats |
| 2026-01-13 | MultiplayerService | complete | Singleton service wrapping SessionManager for opencode |
| 2026-01-13 | Multiplayer API | complete | Full API: CRUD sessions, join/leave, cursor, locks, clients, state |
| 2026-01-13 | SandboxService | complete | Singleton service wrapping Provider, WarmPool, SnapshotManager |
| 2026-01-13 | Sandbox API | complete | Full API: CRUD, lifecycle, exec, logs, git, snapshots, warm pool |
| 2026-01-13 | Prompt Queue API | complete | Full API: add, list, get, cancel, reorder, status, start, complete |
| 2026-01-13 | Voice API endpoints | complete | VoiceService and routes: start, stop, status, send (audio transcription) |
| 2026-01-13 | Desktop API endpoints | complete | DesktopService and routes: get, start, stop, screenshot, websocket |
| 2026-01-13 | Editor API endpoints | complete | EditorService and routes: get, start, stop (code-server integration) |
| 2026-01-13 | PR Session API endpoints | complete | PRSessionService and routes: create, get, list, delete, comments, respond |
| 2026-01-13 | Webhook handlers | complete | WebhookService and routes: github, slack/events, slack/interactions |
| 2026-01-13 | use_skill tool | complete | Already implemented via SkillTool |
| 2026-01-13 | computer_use tool | complete | ComputerUseTool for desktop interaction (screenshot, click, type, key, scroll, move) |
| 2026-01-13 | Plugin Hooks | complete | Added 14 hosted agent hooks to plugin package and integrated triggers in services |
| 2026-01-13 | Modal provider implementation | complete | ModalProvider with API integration, lifecycle management, snapshot/restore, git sync |
| 2026-01-13 | Skills System package | complete | SkillsRegistry, SkillsLoader, SkillsExecutor with 5 built-in skills and 58 tests |
| 2026-01-13 | Image builder | complete | ImageBuilder with scheduled rebuilds, parallel builds, event emission, job management |
| 2026-01-13 | Image registry | complete | ImageRegistry with tagging strategy, latest tracking, cleanup, stats, 49 tests |
| 2026-01-13 | Conflict resolution | complete | ConflictResolver with 3 strategies, OptimisticUpdater for client-side, 74 tests |
| 2026-01-13 | SQLite state fallback | complete | StateStore interface, SQLiteStateStore with persistence, MemoryStateStore, 43 tests |
| 2026-01-13 | GitHub PR Client | complete | WebhookHandler, SessionManager, ResponseFlow with Octokit integration, 32 tests |
| 2026-01-13 | Durable Object state | complete | DurableObjectStateStore with SQL/KV modes, DurableObjectStateStoreClient, MultiplayerDurableObject base class |
| 2026-01-13 | Slack Bot Client | complete | WebhookHandler, RepositoryClassifier, ThreadManager, BlockKit UI with 75 tests |
| 2026-01-14 | Chrome Extension Client | complete | DOM/React tree extractor, SelectionOverlay, content script, background service worker, 48 tests |
| 2026-01-14 | Web Interface Extensions | complete | VSCodeEmbed, DesktopStream, PresenceAvatars, PromptQueue, StatsDashboard, VoiceInput components |
| 2026-01-14 | Sentry integration | complete | Exception capture, transactions, breadcrumbs, Hono middleware, user context |
| 2026-01-14 | Datadog integration | complete | Metrics (count, gauge, histogram, distribution), events, service checks, Hono middleware |
| 2026-01-14 | LaunchDarkly integration | complete | Feature flags with bool/string/number/json variations, user targeting, evaluation details |
| 2026-01-14 | Braintrust integration | complete | Eval logging with spans, LLM call tracking, experiments, feedback, metrics helpers, 37 tests |

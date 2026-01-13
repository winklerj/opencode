# Implementation Plan: Hosted Background Coding Agent

This document tracks the implementation progress of the OpenCode hosted background agent system as defined in `SPECIFICATION.md`.

---

## Phase 1: Core Infrastructure

### 1.1 Sandbox Package (`packages/sandbox/`)
| Task | Status | TLA+ | Notes |
|------|--------|------|-------|
| Provider interface definition | complete | HostedAgent.tla | Base interface for sandbox backends |
| Local provider implementation | complete | - | Dev/test fallback with tests |
| Modal provider implementation | pending | - | Production backend |
| Warm pool manager | complete | WarmPool.tla | Pool lifecycle with claim/release |
| Warm pool warmup (typing trigger) | complete | WarmPool.tla | onTyping() hook for warmup |
| Image builder | pending | - | 30-min rebuild cycle |
| Image registry | pending | - | Tagging strategy |
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
| Durable Object state | pending | HostedAgent.tla | Cloudflare DO integration |
| SQLite state fallback | pending | - | Local/memory fallback |
| WebSocket sync | complete | - | Real-time updates via /multiplayer/:id/ws |
| Conflict resolution | pending | - | Edit conflict handling |

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
| PR Session API endpoints | pending | /pr-session/* |
| Webhook handlers | pending | /webhook/* |

---

## Phase 3: Tools & Hooks

### 3.1 New Tools
| Task | Status | Notes |
|------|--------|-------|
| spawn_session tool | complete | Spawn parallel sessions via BackgroundService |
| check_session tool | complete | Check spawned session status |
| use_skill tool | pending | Apply predefined skills |
| computer_use tool | pending | Desktop interaction |

### 3.2 Plugin Hooks
| Task | Status | Notes |
|------|--------|-------|
| sandbox.create.before | pending | Pre-create hook |
| sandbox.ready | pending | Sandbox ready hook |
| sandbox.edit.before | pending | Git sync gating |
| prompt.typing | pending | Warm pool trigger |
| background.spawn | pending | Agent spawn hook |
| multiplayer.join | pending | User join hook |
| voice.transcribed | pending | Voice processing |
| pr.screenshot | pending | PR screenshot capture |
| pr.comment.received | pending | GitHub PR comment |
| pr.comment.addressed | pending | Comment resolution |

---

## Phase 4: Clients

### 4.1 Slack Bot (`packages/clients/slack-bot/`)
| Task | Status | Notes |
|------|--------|-------|
| Webhook handler | pending | Events + interactions |
| Repository classifier | pending | Channel/message context |
| Thread conversation | pending | Follow-up prompts |
| Block Kit UI | pending | Status updates |

### 4.2 Chrome Extension (`packages/clients/chrome-extension/`)
| Task | Status | Notes |
|------|--------|-------|
| Sidebar chat interface | pending | Chrome Sidebar API |
| DOM/React tree extractor | pending | Component extraction |
| Element selection overlay | pending | Visual selection |
| MDM distribution setup | pending | Enterprise deployment |

### 4.3 GitHub PR Client (`packages/clients/github-pr/`)
| Task | Status | Notes |
|------|--------|-------|
| Webhook handler | pending | PR events |
| Session manager | pending | PR-session mapping |
| Comment response flow | pending | Address + reply |

### 4.4 Web Interface Extensions
| Task | Status | Notes |
|------|--------|-------|
| VSCodeEmbed component | pending | code-server iframe |
| DesktopStream component | pending | VNC/noVNC stream |
| PresenceAvatars component | pending | Multiplayer presence |
| PromptQueue component | pending | Queue management |
| StatsDashboard component | pending | Usage metrics |
| VoiceInput component | pending | Voice-to-text |
| Mobile responsive layout | pending | PWA support |

---

## Phase 5: Integrations

| Task | Status | Notes |
|------|--------|-------|
| GitHub App setup | pending | Image building without user tokens |
| Sentry integration | pending | Error tracking |
| Datadog integration | pending | Metrics |
| LaunchDarkly integration | pending | Feature flags |
| Braintrust integration | pending | Eval logging |
| Buildkite integration | pending | CI/CD |

---

## Phase 6: Skills System

| Task | Status | Notes |
|------|--------|-------|
| Skills registry | pending | packages/skills/ |
| Skills loader | pending | Load from .opencode/skills/ |
| Skills executor | pending | Context injection |
| Built-in: code-review | pending | - |
| Built-in: pr-description | pending | - |
| Built-in: test-generation | pending | - |
| Built-in: bug-fix | pending | - |
| Built-in: feature-impl | pending | - |

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

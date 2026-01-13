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
| WebSocket sync | pending | - | Real-time updates |
| Conflict resolution | pending | - | Edit conflict handling |

---

## Phase 2: API Layer

### 2.1 Sandbox API (`/sandbox/*`)
| Task | Status | Notes |
|------|--------|-------|
| POST /sandbox | pending | Create sandbox |
| GET /sandbox/:id | pending | Get sandbox info |
| GET /sandbox | pending | List sandboxes |
| POST /sandbox/:id/start | pending | Start sandbox |
| POST /sandbox/:id/stop | pending | Stop sandbox |
| POST /sandbox/:id/terminate | pending | Terminate sandbox |
| POST /sandbox/:id/snapshot | pending | Create snapshot |
| POST /sandbox/restore | pending | Restore from snapshot |
| POST /sandbox/:id/exec | pending | Execute command |
| GET /sandbox/:id/logs/:service | pending | Stream logs (SSE) |
| GET /sandbox/:id/git | pending | Git sync status |
| POST /sandbox/:id/git/sync | pending | Force git sync |

### 2.2 Multiplayer API (`/multiplayer/*`)
| Task | Status | Notes |
|------|--------|-------|
| POST /multiplayer/:sessionID/join | pending | Join session |
| POST /multiplayer/:sessionID/leave | pending | Leave session |
| PUT /multiplayer/:sessionID/cursor | pending | Update cursor |
| POST /multiplayer/:sessionID/prompt | pending | Queue prompt |
| DELETE /multiplayer/:sessionID/prompt/:id | pending | Cancel prompt |
| GET /multiplayer/:sessionID/ws | pending | WebSocket connection |

### 2.3 Background Agent API (`/background/*`)
| Task | Status | Notes |
|------|--------|-------|
| POST /background/spawn | pending | Spawn agent |
| GET /background/:id | pending | Get agent status |
| GET /background | pending | List agents |
| POST /background/:id/cancel | pending | Cancel agent |
| GET /background/:id/output | pending | Get output |
| GET /background/:id/events | pending | Stream events (SSE) |

### 2.4 Additional APIs
| Task | Status | Notes |
|------|--------|-------|
| Voice API endpoints | pending | /session/:id/voice/* |
| Desktop API endpoints | pending | /sandbox/:id/desktop/* |
| Editor API endpoints | pending | /sandbox/:id/editor/* |
| Stats API endpoints | pending | /stats/* |
| Skills API endpoints | pending | /skills/* |
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

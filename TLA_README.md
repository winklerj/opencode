# TLA+ Specifications for OpenCode Hosted Agent

This directory contains formal TLA+ specifications for the critical concurrent behaviors of the OpenCode Hosted Background Coding Agent system.

## Overview

TLA+ (Temporal Logic of Actions) is a formal specification language for designing, modeling, and verifying concurrent and distributed systems. These specifications model the key safety and liveness properties of the hosted agent system.

## Modules

### 1. HostedAgent.tla (Main Specification)

The comprehensive specification covering all major subsystems:

- **Sandbox Lifecycle**: States (initializing, ready, running, suspended, terminated) and transitions
- **Git Sync Gating**: Blocking writes until sync completes
- **Warm Pool Management**: Pre-warmed sandbox allocation
- **Multiplayer Sessions**: Multi-user coordination and edit locks
- **Prompt Queues**: FIFO prompt processing with user ownership
- **Background Agents**: Spawning and monitoring sub-agents

**Key Invariants:**
- `NoWritesBeforeSync`: No file modifications before git sync completes
- `OnePromptExecutingPerSession`: At most one prompt executing at a time
- `SingleEditLockHolder`: Edit lock held by at most one user
- `WarmPoolSandboxesReady`: Warm pool contains only ready sandboxes

### 2. GitSyncGating.tla (Critical Safety Property)

Focused specification for the git synchronization gating logic:

- Read operations (read, glob, grep, ls) are **always allowed**
- Write operations (edit, write, patch, multiedit) are **blocked** until sync completes
- Pending writes are queued and released after sync

**Critical Safety Property:**
```tla
NoCompletedWritesBeforeSync ==
    syncStatus /= "synced" =>
        \A i \in 1..Len(completedOps) : IsReadTool(completedOps[i].tool)
```

### 3. PromptQueue.tla (Queue Behavior)

Specification for prompt queue management:

- Follow-up prompts are **queued** (not inserted mid-execution)
- Users can only cancel their **own** queued prompts
- Prompts are processed in FIFO order
- Agent can be stopped mid-execution

**Key Properties:**
- `AtMostOneExecuting`: At most one prompt executing at any time
- `NoStarvation`: All queued prompts eventually execute or are cancelled

### 4. WarmPool.tla (Performance Optimization)

Specification for warm sandbox pool management:

- Sandboxes claimed when user **starts typing** (not on send)
- Pool replenished as sandboxes are claimed
- Sandboxes expire after TTL
- New image builds invalidate existing warm sandboxes

**Key Properties:**
- `PoolSizeLimit`: Pool size never exceeds maximum
- `PoolHitRate`: Target >80% cache hit rate

### 5. SandboxSnapshot.tla (Session Continuity)

Specification for snapshot/restore behavior enabling follow-up prompts:

- Snapshots created when agent **completes work**
- Snapshots restored when user sends **follow-up prompts**
- Sandboxes terminated after snapshot to **free resources**
- Snapshots expire after TTL and are cleaned up
- Git sync required after restore to get latest changes

**Key Properties:**
- `AtMostOneActiveSandboxPerSession`: No duplicate sandboxes per session
- `SnapshotsReferenceValidSessions`: Snapshots reference existing sessions
- `AgentStatusConsistency`: Agent status matches sandbox state
- `PendingFollowUpsConsistency`: Follow-ups only for idle agents

**Critical Behavior:**
```tla
\* Create snapshot when agent completes work
CreateSnapshot(sessionID) ==
    /\ agentStatus[sessionID] = "completed"
    /\ HasActiveSandbox(sessionID)
    ...

\* Restore from snapshot for follow-up
RestoreFromSnapshot(sessionID) ==
    /\ HasValidSnapshot(sessionID)
    /\ ~HasActiveSandbox(sessionID)
    ...
```

## Running the Specifications

### Prerequisites

Install TLA+ Toolbox or the command-line tools:

```bash
# Using the TLA+ Toolbox (GUI)
# Download from: https://lamport.azurewebsites.net/tla/toolbox.html

# Or using tla2tools.jar (CLI)
wget https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar
```

### Running with TLC Model Checker

```bash
# Check GitSyncGating (fast, focused)
java -jar tla2tools.jar GitSyncGating.tla -config GitSyncGating.cfg

# Check PromptQueue
java -jar tla2tools.jar PromptQueue.tla -config PromptQueue.cfg

# Check WarmPool
java -jar tla2tools.jar WarmPool.tla -config WarmPool.cfg

# Check SandboxSnapshot (session continuity)
java -jar tla2tools.jar SandboxSnapshot.tla -config SandboxSnapshot.cfg

# Check full HostedAgent (slower, comprehensive)
java -jar tla2tools.jar HostedAgent.tla -config HostedAgent.cfg
```

### Expected Output

A successful run produces:
```
Model checking completed. No error has been found.
  Diameter: <N>
  States Found: <N>
  Distinct States: <N>
```

If an invariant is violated:
```
Error: Invariant NoCompletedWritesBeforeSync is violated.
<Counter-example trace showing the violation>
```

## Key Safety Properties Verified

| Property | Module | Description |
|----------|--------|-------------|
| NoWritesBeforeSync | HostedAgent, GitSyncGating | Writes blocked until git sync completes |
| OnePromptExecutingPerSession | HostedAgent, PromptQueue | At most one prompt executing |
| SingleEditLockHolder | HostedAgent | Edit lock held by at most one user |
| WarmPoolSandboxesReady | HostedAgent, WarmPool | Warm pool contains only ready sandboxes |
| PoolSizeLimit | WarmPool | Pool size within bounds |
| AtMostOneExecuting | PromptQueue | Only one prompt executes at a time |
| AtMostOneActiveSandboxPerSession | SandboxSnapshot | No duplicate sandboxes per session |
| SnapshotsReferenceValidSessions | SandboxSnapshot | Snapshots reference existing sessions |
| ValidSnapshotReferences | HostedAgent | Snapshots reference valid sandboxes |
| SessionSnapshotConsistency | HostedAgent | Session snapshots point to valid snapshots |
| ValidClientTypes | HostedAgent | Connected clients have valid types |

## Liveness Properties Verified

| Property | Module | Description |
|----------|--------|-------------|
| GitSyncEventuallyCompletes | HostedAgent | Sync eventually finishes |
| QueuedPromptsEventuallyExecute | HostedAgent, PromptQueue | No prompt starvation |
| AgentsEventuallyTerminate | HostedAgent | Background agents complete |
| PoolEventuallyReady | WarmPool | Warm pool stays populated |
| FollowUpsEventuallyServiced | SandboxSnapshot | Follow-ups get a sandbox |
| CompletedWorkEventuallySnapshotted | SandboxSnapshot | Completed work creates snapshot |
| ExpiredSnapshotsEventuallyCleaned | SandboxSnapshot | Expired snapshots removed |

## Extending the Specifications

### Adding New Invariants

Add to the `SafetyInvariant` definition:

```tla
NewInvariant ==
    \* Your property here

SafetyInvariant ==
    /\ ExistingInvariants
    /\ NewInvariant
```

### Adding New Actions

Add to the `Next` state relation:

```tla
NewAction(args) ==
    /\ preconditions
    /\ state_changes
    /\ UNCHANGED <<unaffected_vars>>

Next ==
    \/ ExistingActions
    \/ \E args : NewAction(args)
```

## Integration with Implementation

These specifications serve as:

1. **Design Documentation**: Precise description of expected behavior
2. **Test Oracle**: Generate test cases from counter-examples
3. **Code Review Guide**: Verify implementation matches spec
4. **Regression Prevention**: Check that changes maintain invariants

The specifications directly map to code in:
- `packages/sandbox/src/pool/` → WarmPool.tla
- `packages/sandbox/src/snapshot/` → SandboxSnapshot.tla
- `packages/opencode/src/sandbox/sync-gate-plugin.ts` → GitSyncGating.tla
- `packages/multiplayer/src/` → HostedAgent.tla (multiplayer sections)
- `packages/multiplayer/src/sync/` → HostedAgent.tla (client sync sections)
- `packages/background/src/queue/` → PromptQueue.tla
- `packages/opencode/src/telemetry/init.ts` → OpenTelemetry instrumentation (SPECIFICATION.md §12)

## References

- [TLA+ Home Page](https://lamport.azurewebsites.net/tla/tla.html)
- [Learn TLA+](https://learntla.com/)
- [TLA+ Video Course](https://lamport.azurewebsites.net/video/videos.html)
- [Specifying Systems (Book)](https://lamport.azurewebsites.net/tla/book.html)

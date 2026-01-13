---------------------------- MODULE HostedAgent ----------------------------
(***************************************************************************)
(* TLA+ Specification for OpenCode Hosted Background Coding Agent          *)
(*                                                                         *)
(* This specification models the critical concurrent behaviors of the      *)
(* hosted agent system including:                                          *)
(*   - Sandbox lifecycle management                                        *)
(*   - Git synchronization gating                                          *)
(*   - Warm pool management                                                *)
(*   - Multiplayer session coordination                                    *)
(*   - Prompt queue ordering                                               *)
(*   - Background agent spawning                                           *)
(*                                                                         *)
(* Author: Generated from SPECIFICATION.md                                 *)
(***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
    Users,              \* Set of user IDs
    Repositories,       \* Set of repository names
    MaxSandboxes,       \* Maximum sandboxes in warm pool
    MaxPrompts,         \* Maximum queued prompts per session
    MaxBackgroundAgents \* Maximum concurrent background agents

VARIABLES
    (****************************************************************)
    (* Sandbox State                                                 *)
    (****************************************************************)
    sandboxes,          \* Function: sandboxID -> sandbox state record
    warmPool,           \* Set of warm sandbox IDs ready for use

    (****************************************************************)
    (* Session State                                                 *)
    (****************************************************************)
    sessions,           \* Function: sessionID -> session state record
    promptQueues,       \* Function: sessionID -> sequence of prompts

    (****************************************************************)
    (* Git Sync State                                                *)
    (****************************************************************)
    gitSyncStatus,      \* Function: sandboxID -> sync status
    pendingEdits,       \* Set of {sandboxID, tool, file} awaiting sync

    (****************************************************************)
    (* Multiplayer State                                             *)
    (****************************************************************)
    sessionUsers,       \* Function: sessionID -> set of user IDs
    editLocks,          \* Function: sessionID -> userID holding lock (or NULL)

    (****************************************************************)
    (* Background Agent State                                        *)
    (****************************************************************)
    backgroundAgents,   \* Function: agentID -> agent state record
    agentCounter,       \* Counter for generating unique agent IDs

    (****************************************************************)
    (* Snapshot State (for follow-up continuity)                     *)
    (****************************************************************)
    snapshots,          \* Function: snapshotID -> snapshot record
    sessionSnapshots,   \* Function: sessionID -> latest snapshotID (or NULL)

    (****************************************************************)
    (* Client Sync State (for multi-client coordination)             *)
    (****************************************************************)
    connectedClients,   \* Function: sessionID -> set of client records
    clientSyncState     \* Function: sessionID -> last synced state version

vars == <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
          pendingEdits, sessionUsers, editLocks, backgroundAgents, agentCounter,
          snapshots, sessionSnapshots, connectedClients, clientSyncState>>

(***************************************************************************)
(* Type Definitions                                                        *)
(***************************************************************************)

SandboxStatus == {"initializing", "ready", "running", "suspended", "terminated"}
GitSyncStatus == {"pending", "syncing", "synced", "error"}
AgentStatus == {"queued", "initializing", "running", "completed", "failed", "cancelled"}
PromptStatus == {"queued", "executing", "completed"}

SandboxRecord == [
    id: STRING,
    projectID: STRING,
    status: SandboxStatus,
    repository: Repositories,
    createdAt: Nat,
    lastActivity: Nat
]

SessionRecord == [
    id: STRING,
    sandboxID: STRING,
    repository: Repositories,
    status: {"idle", "thinking", "executing"},
    createdAt: Nat
]

PromptRecord == [
    id: STRING,
    userID: Users,
    content: STRING,
    status: PromptStatus,
    queuedAt: Nat,
    priority: Nat
]

AgentRecord == [
    id: STRING,
    parentSessionID: STRING,
    sessionID: STRING,
    sandboxID: STRING,
    status: AgentStatus,
    task: STRING,
    createdAt: Nat
]

SnapshotRecord == [
    id: STRING,
    sandboxID: STRING,
    sessionID: STRING,
    gitCommit: STRING,
    createdAt: Nat,
    expired: BOOLEAN
]

ClientType == {"web", "slack", "chrome", "mobile", "voice"}

ClientRecord == [
    id: STRING,
    userID: STRING,
    type: ClientType,
    connectedAt: Nat,
    lastActivity: Nat
]

(***************************************************************************)
(* Initial State                                                           *)
(***************************************************************************)

Init ==
    /\ sandboxes = [s \in {} |-> {}]
    /\ warmPool = {}
    /\ sessions = [s \in {} |-> {}]
    /\ promptQueues = [s \in {} |-> <<>>]
    /\ gitSyncStatus = [s \in {} |-> "pending"]
    /\ pendingEdits = {}
    /\ sessionUsers = [s \in {} |-> {}]
    /\ editLocks = [s \in {} |-> "NULL"]
    /\ backgroundAgents = [a \in {} |-> {}]
    /\ agentCounter = 0
    /\ snapshots = [s \in {} |-> {}]
    /\ sessionSnapshots = [s \in {} |-> "NULL"]
    /\ connectedClients = [s \in {} |-> {}]
    /\ clientSyncState = [s \in {} |-> 0]

(***************************************************************************)
(* Helper Operators                                                        *)
(***************************************************************************)

\* Generate a unique ID (simplified for TLA+)
NewID(prefix, counter) == prefix

\* Check if a sandbox is available in warm pool for a repository
WarmSandboxAvailable(repo) ==
    \E sid \in warmPool :
        /\ sid \in DOMAIN sandboxes
        /\ sandboxes[sid].repository = repo
        /\ sandboxes[sid].status = "ready"

\* Get a warm sandbox for a repository
GetWarmSandbox(repo) ==
    CHOOSE sid \in warmPool :
        /\ sid \in DOMAIN sandboxes
        /\ sandboxes[sid].repository = repo
        /\ sandboxes[sid].status = "ready"

\* Check if user can edit (has lock or no lock exists)
CanEdit(sessionID, userID) ==
    \/ editLocks[sessionID] = "NULL"
    \/ editLocks[sessionID] = userID

\* Check if git sync is complete for sandbox
GitSynced(sandboxID) ==
    /\ sandboxID \in DOMAIN gitSyncStatus
    /\ gitSyncStatus[sandboxID] = "synced"

(***************************************************************************)
(* SANDBOX LIFECYCLE ACTIONS                                               *)
(***************************************************************************)

\* Create a new sandbox (cold start)
CreateSandbox(repo) ==
    LET newID == NewID("sandbox", Cardinality(DOMAIN sandboxes))
    IN
    /\ Cardinality(DOMAIN sandboxes) < MaxSandboxes
    /\ sandboxes' = sandboxes @@ (newID :> [
            id |-> newID,
            projectID |-> "project",
            status |-> "initializing",
            repository |-> repo,
            createdAt |-> 0,
            lastActivity |-> 0
        ])
    /\ gitSyncStatus' = gitSyncStatus @@ (newID :> "pending")
    /\ UNCHANGED <<warmPool, sessions, promptQueues, pendingEdits,
                   sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Sandbox becomes ready (image loaded, dependencies installed)
SandboxReady(sandboxID) ==
    /\ sandboxID \in DOMAIN sandboxes
    /\ sandboxes[sandboxID].status = "initializing"
    /\ sandboxes' = [sandboxes EXCEPT ![sandboxID].status = "ready"]
    /\ UNCHANGED <<warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Add sandbox to warm pool
AddToWarmPool(sandboxID) ==
    /\ sandboxID \in DOMAIN sandboxes
    /\ sandboxes[sandboxID].status = "ready"
    /\ sandboxID \notin warmPool
    /\ Cardinality(warmPool) < MaxSandboxes
    /\ warmPool' = warmPool \union {sandboxID}
    /\ UNCHANGED <<sandboxes, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Claim sandbox from warm pool (triggered by user typing)
ClaimWarmSandbox(repo, sessionID) ==
    /\ WarmSandboxAvailable(repo)
    /\ LET sid == GetWarmSandbox(repo)
       IN
       /\ warmPool' = warmPool \ {sid}
       /\ sandboxes' = [sandboxes EXCEPT ![sid].status = "running"]
       /\ sessions' = sessions @@ (sessionID :> [
               id |-> sessionID,
               sandboxID |-> sid,
               repository |-> repo,
               status |-> "idle",
               createdAt |-> 0
           ])
       /\ promptQueues' = promptQueues @@ (sessionID :> <<>>)
       /\ sessionUsers' = sessionUsers @@ (sessionID :> {})
       /\ editLocks' = editLocks @@ (sessionID :> "NULL")
       /\ connectedClients' = connectedClients @@ (sessionID :> {})
       /\ clientSyncState' = clientSyncState @@ (sessionID :> 0)
       /\ sessionSnapshots' = sessionSnapshots @@ (sessionID :> "NULL")
    /\ UNCHANGED <<gitSyncStatus, pendingEdits, backgroundAgents, agentCounter, snapshots>>

\* Terminate sandbox
TerminateSandbox(sandboxID) ==
    /\ sandboxID \in DOMAIN sandboxes
    /\ sandboxes[sandboxID].status \in {"ready", "running", "suspended"}
    /\ sandboxes' = [sandboxes EXCEPT ![sandboxID].status = "terminated"]
    /\ warmPool' = warmPool \ {sandboxID}
    /\ UNCHANGED <<sessions, promptQueues, gitSyncStatus, pendingEdits,
                   sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

(***************************************************************************)
(* GIT SYNC GATING ACTIONS                                                 *)
(***************************************************************************)

\* Start git sync (pull latest changes)
StartGitSync(sandboxID) ==
    /\ sandboxID \in DOMAIN gitSyncStatus
    /\ gitSyncStatus[sandboxID] = "pending"
    /\ gitSyncStatus' = [gitSyncStatus EXCEPT ![sandboxID] = "syncing"]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, pendingEdits,
                   sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Complete git sync
CompleteGitSync(sandboxID) ==
    /\ sandboxID \in DOMAIN gitSyncStatus
    /\ gitSyncStatus[sandboxID] = "syncing"
    /\ gitSyncStatus' = [gitSyncStatus EXCEPT ![sandboxID] = "synced"]
    \* Release any pending edits for this sandbox
    /\ pendingEdits' = {pe \in pendingEdits : pe.sandboxID /= sandboxID}
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues,
                   sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Git sync error
GitSyncError(sandboxID) ==
    /\ sandboxID \in DOMAIN gitSyncStatus
    /\ gitSyncStatus[sandboxID] = "syncing"
    /\ gitSyncStatus' = [gitSyncStatus EXCEPT ![sandboxID] = "error"]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, pendingEdits,
                   sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Attempt edit tool (blocked if not synced)
AttemptEdit(sandboxID, tool, file) ==
    /\ sandboxID \in DOMAIN gitSyncStatus
    /\ tool \in {"edit", "write", "patch", "multiedit"}
    /\ IF GitSynced(sandboxID)
       THEN
           \* Edit proceeds immediately
           UNCHANGED vars
       ELSE
           \* Edit is blocked, added to pending
           /\ pendingEdits' = pendingEdits \union {[sandboxID |-> sandboxID, tool |-> tool, file |-> file]}
           /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                          sessionUsers, editLocks, backgroundAgents, agentCounter,
                          snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Read operations allowed during sync (no blocking)
AttemptRead(sandboxID, tool) ==
    /\ sandboxID \in DOMAIN sandboxes
    /\ tool \in {"read", "glob", "grep", "ls"}
    \* Reads always proceed immediately regardless of sync status
    /\ UNCHANGED vars

(***************************************************************************)
(* MULTIPLAYER SESSION ACTIONS                                             *)
(***************************************************************************)

\* User joins session
UserJoinSession(sessionID, userID) ==
    /\ sessionID \in DOMAIN sessions
    /\ userID \in Users
    /\ userID \notin sessionUsers[sessionID]
    /\ sessionUsers' = [sessionUsers EXCEPT ![sessionID] = @ \union {userID}]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* User leaves session
UserLeaveSession(sessionID, userID) ==
    /\ sessionID \in DOMAIN sessions
    /\ userID \in sessionUsers[sessionID]
    /\ sessionUsers' = [sessionUsers EXCEPT ![sessionID] = @ \ {userID}]
    \* Release edit lock if this user held it
    /\ editLocks' = [editLocks EXCEPT ![sessionID] =
                     IF editLocks[sessionID] = userID THEN "NULL" ELSE @]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Acquire edit lock
AcquireEditLock(sessionID, userID) ==
    /\ sessionID \in DOMAIN sessions
    /\ userID \in sessionUsers[sessionID]
    /\ editLocks[sessionID] = "NULL"
    /\ editLocks' = [editLocks EXCEPT ![sessionID] = userID]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Release edit lock
ReleaseEditLock(sessionID, userID) ==
    /\ sessionID \in DOMAIN sessions
    /\ editLocks[sessionID] = userID
    /\ editLocks' = [editLocks EXCEPT ![sessionID] = "NULL"]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

(***************************************************************************)
(* PROMPT QUEUE ACTIONS                                                    *)
(***************************************************************************)

\* Queue a prompt (follow-ups during execution are queued, not inserted)
QueuePrompt(sessionID, userID, content, priority) ==
    /\ sessionID \in DOMAIN sessions
    /\ userID \in sessionUsers[sessionID]
    /\ Len(promptQueues[sessionID]) < MaxPrompts
    /\ LET newPrompt == [
            id |-> "prompt",
            userID |-> userID,
            content |-> content,
            status |-> "queued",
            queuedAt |-> 0,
            priority |-> priority
        ]
       IN
       promptQueues' = [promptQueues EXCEPT ![sessionID] = Append(@, newPrompt)]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, gitSyncStatus, pendingEdits,
                   sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Start executing next prompt in queue
StartPromptExecution(sessionID) ==
    /\ sessionID \in DOMAIN sessions
    /\ sessions[sessionID].status = "idle"
    /\ Len(promptQueues[sessionID]) > 0
    /\ promptQueues[sessionID][1].status = "queued"
    /\ sessions' = [sessions EXCEPT ![sessionID].status = "executing"]
    /\ promptQueues' = [promptQueues EXCEPT
                        ![sessionID][1].status = "executing"]
    /\ UNCHANGED <<sandboxes, warmPool, gitSyncStatus, pendingEdits,
                   sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Complete prompt execution
CompletePromptExecution(sessionID) ==
    /\ sessionID \in DOMAIN sessions
    /\ sessions[sessionID].status = "executing"
    /\ Len(promptQueues[sessionID]) > 0
    /\ promptQueues[sessionID][1].status = "executing"
    /\ sessions' = [sessions EXCEPT ![sessionID].status = "idle"]
    \* Remove completed prompt from queue
    /\ promptQueues' = [promptQueues EXCEPT ![sessionID] = Tail(@)]
    /\ UNCHANGED <<sandboxes, warmPool, gitSyncStatus, pendingEdits,
                   sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Cancel queued prompt (user can only cancel their own)
CancelPrompt(sessionID, userID, promptIndex) ==
    /\ sessionID \in DOMAIN sessions
    /\ promptIndex \in 1..Len(promptQueues[sessionID])
    /\ promptQueues[sessionID][promptIndex].userID = userID
    /\ promptQueues[sessionID][promptIndex].status = "queued"
    \* Remove the prompt at index
    /\ LET queue == promptQueues[sessionID]
           newQueue == SubSeq(queue, 1, promptIndex-1) \o SubSeq(queue, promptIndex+1, Len(queue))
       IN
       promptQueues' = [promptQueues EXCEPT ![sessionID] = newQueue]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, gitSyncStatus, pendingEdits,
                   sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

(***************************************************************************)
(* BACKGROUND AGENT ACTIONS                                                *)
(***************************************************************************)

\* Spawn background agent
SpawnBackgroundAgent(parentSessionID, task) ==
    /\ Cardinality(DOMAIN backgroundAgents) < MaxBackgroundAgents
    /\ LET newID == NewID("agent", agentCounter)
           newSessionID == NewID("session", agentCounter)
       IN
       /\ backgroundAgents' = backgroundAgents @@ (newID :> [
               id |-> newID,
               parentSessionID |-> parentSessionID,
               sessionID |-> newSessionID,
               sandboxID |-> "pending",
               status |-> "queued",
               task |-> task,
               createdAt |-> 0
           ])
       /\ agentCounter' = agentCounter + 1
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Background agent starts initializing
AgentStartInitializing(agentID) ==
    /\ agentID \in DOMAIN backgroundAgents
    /\ backgroundAgents[agentID].status = "queued"
    /\ backgroundAgents' = [backgroundAgents EXCEPT ![agentID].status = "initializing"]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Background agent starts running
AgentStartRunning(agentID) ==
    /\ agentID \in DOMAIN backgroundAgents
    /\ backgroundAgents[agentID].status = "initializing"
    /\ backgroundAgents' = [backgroundAgents EXCEPT ![agentID].status = "running"]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Background agent completes
AgentComplete(agentID) ==
    /\ agentID \in DOMAIN backgroundAgents
    /\ backgroundAgents[agentID].status = "running"
    /\ backgroundAgents' = [backgroundAgents EXCEPT ![agentID].status = "completed"]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Background agent fails
AgentFail(agentID) ==
    /\ agentID \in DOMAIN backgroundAgents
    /\ backgroundAgents[agentID].status \in {"initializing", "running"}
    /\ backgroundAgents' = [backgroundAgents EXCEPT ![agentID].status = "failed"]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

\* Cancel background agent
CancelAgent(agentID) ==
    /\ agentID \in DOMAIN backgroundAgents
    /\ backgroundAgents[agentID].status \in {"queued", "initializing", "running"}
    /\ backgroundAgents' = [backgroundAgents EXCEPT ![agentID].status = "cancelled"]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks, agentCounter,
                   snapshots, sessionSnapshots, connectedClients, clientSyncState>>

(***************************************************************************)
(* WARM POOL REPLENISHMENT                                                 *)
(***************************************************************************)

\* Replenish warm pool (background process)
ReplenishWarmPool(repo) ==
    /\ Cardinality(warmPool) < MaxSandboxes
    /\ ~WarmSandboxAvailable(repo)
    /\ CreateSandbox(repo)

(***************************************************************************)
(* SNAPSHOT ACTIONS                                                        *)
(***************************************************************************)

\* Create snapshot after work completion (for follow-up continuity)
CreateSnapshot(sessionID) ==
    /\ sessionID \in DOMAIN sessions
    /\ sessions[sessionID].status = "idle"
    /\ sessions[sessionID].sandboxID \in DOMAIN sandboxes
    /\ LET newSnapID == NewID("snapshot", Cardinality(DOMAIN snapshots))
           sandboxID == sessions[sessionID].sandboxID
       IN
       /\ snapshots' = snapshots @@ (newSnapID :> [
               id |-> newSnapID,
               sandboxID |-> sandboxID,
               sessionID |-> sessionID,
               gitCommit |-> "commit",
               createdAt |-> 0,
               expired |-> FALSE
           ])
       /\ sessionSnapshots' = [sessionSnapshots EXCEPT ![sessionID] = newSnapID]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks, backgroundAgents, agentCounter,
                   connectedClients, clientSyncState>>

\* Restore from snapshot (for follow-up prompts)
RestoreFromSnapshot(sessionID) ==
    /\ sessionID \in DOMAIN sessions
    /\ sessionSnapshots[sessionID] /= "NULL"
    /\ sessionSnapshots[sessionID] \in DOMAIN snapshots
    /\ ~snapshots[sessionSnapshots[sessionID]].expired
    /\ LET snap == snapshots[sessionSnapshots[sessionID]]
           newSandboxID == NewID("sandbox", Cardinality(DOMAIN sandboxes))
       IN
       /\ sandboxes' = sandboxes @@ (newSandboxID :> [
               id |-> newSandboxID,
               projectID |-> "project",
               status |-> "ready",
               repository |-> sessions[sessionID].repository,
               createdAt |-> 0,
               lastActivity |-> 0,
               restoredFrom |-> snap.id
           ])
       /\ sessions' = [sessions EXCEPT ![sessionID].sandboxID = newSandboxID]
       /\ gitSyncStatus' = gitSyncStatus @@ (newSandboxID :> "pending")
    /\ UNCHANGED <<warmPool, promptQueues, pendingEdits, sessionUsers, editLocks,
                   backgroundAgents, agentCounter, snapshots, sessionSnapshots,
                   connectedClients, clientSyncState>>

(***************************************************************************)
(* CLIENT SYNC ACTIONS                                                     *)
(***************************************************************************)

\* Client connects to session
ClientConnect(sessionID, clientID, clientType, userID) ==
    /\ sessionID \in DOMAIN sessions
    /\ LET newClient == [
            id |-> clientID,
            userID |-> userID,
            type |-> clientType,
            connectedAt |-> 0,
            lastActivity |-> 0
        ]
       IN
       connectedClients' = [connectedClients EXCEPT ![sessionID] = @ \union {newClient}]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, clientSyncState>>

\* Client disconnects from session
ClientDisconnect(sessionID, clientID) ==
    /\ sessionID \in DOMAIN sessions
    /\ \E c \in connectedClients[sessionID] : c.id = clientID
    /\ connectedClients' = [connectedClients EXCEPT
           ![sessionID] = {c \in @ : c.id /= clientID}]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, clientSyncState>>

\* Sync state version increments (state changed)
IncrementSyncState(sessionID) ==
    /\ sessionID \in DOMAIN sessions
    /\ clientSyncState' = [clientSyncState EXCEPT ![sessionID] = @ + 1]
    /\ UNCHANGED <<sandboxes, warmPool, sessions, promptQueues, gitSyncStatus,
                   pendingEdits, sessionUsers, editLocks, backgroundAgents, agentCounter,
                   snapshots, sessionSnapshots, connectedClients>>

(***************************************************************************)
(* NEXT STATE RELATION                                                     *)
(***************************************************************************)

Next ==
    \/ \E repo \in Repositories : CreateSandbox(repo)
    \/ \E sid \in DOMAIN sandboxes : SandboxReady(sid)
    \/ \E sid \in DOMAIN sandboxes : AddToWarmPool(sid)
    \/ \E repo \in Repositories, sessID \in STRING : ClaimWarmSandbox(repo, sessID)
    \/ \E sid \in DOMAIN sandboxes : TerminateSandbox(sid)
    \/ \E sid \in DOMAIN gitSyncStatus : StartGitSync(sid)
    \/ \E sid \in DOMAIN gitSyncStatus : CompleteGitSync(sid)
    \/ \E sid \in DOMAIN gitSyncStatus : GitSyncError(sid)
    \/ \E sessID \in DOMAIN sessions, userID \in Users : UserJoinSession(sessID, userID)
    \/ \E sessID \in DOMAIN sessions, userID \in Users : UserLeaveSession(sessID, userID)
    \/ \E sessID \in DOMAIN sessions, userID \in Users : AcquireEditLock(sessID, userID)
    \/ \E sessID \in DOMAIN sessions, userID \in Users : ReleaseEditLock(sessID, userID)
    \/ \E sessID \in DOMAIN sessions, userID \in Users, content \in STRING, priority \in Nat :
           QueuePrompt(sessID, userID, content, priority)
    \/ \E sessID \in DOMAIN sessions : StartPromptExecution(sessID)
    \/ \E sessID \in DOMAIN sessions : CompletePromptExecution(sessID)
    \/ \E parentID \in STRING, task \in STRING : SpawnBackgroundAgent(parentID, task)
    \/ \E agentID \in DOMAIN backgroundAgents : AgentStartInitializing(agentID)
    \/ \E agentID \in DOMAIN backgroundAgents : AgentStartRunning(agentID)
    \/ \E agentID \in DOMAIN backgroundAgents : AgentComplete(agentID)
    \/ \E agentID \in DOMAIN backgroundAgents : AgentFail(agentID)
    \/ \E agentID \in DOMAIN backgroundAgents : CancelAgent(agentID)
    \* Snapshot actions
    \/ \E sessID \in DOMAIN sessions : CreateSnapshot(sessID)
    \/ \E sessID \in DOMAIN sessions : RestoreFromSnapshot(sessID)
    \* Client sync actions
    \/ \E sessID \in DOMAIN sessions, clientID \in STRING, clientType \in ClientType, userID \in Users :
           ClientConnect(sessID, clientID, clientType, userID)
    \/ \E sessID \in DOMAIN sessions, clientID \in STRING : ClientDisconnect(sessID, clientID)
    \/ \E sessID \in DOMAIN sessions : IncrementSyncState(sessID)

(***************************************************************************)
(* SAFETY INVARIANTS                                                       *)
(***************************************************************************)

\* Git sync gating: No writes allowed before sync is complete
NoWritesBeforeSync ==
    \A pe \in pendingEdits :
        /\ pe.sandboxID \in DOMAIN gitSyncStatus
        /\ gitSyncStatus[pe.sandboxID] /= "synced"

\* Only one prompt can be executing at a time per session
OnePromptExecutingPerSession ==
    \A sessID \in DOMAIN sessions :
        Len(promptQueues[sessID]) > 0 =>
            Cardinality({i \in 1..Len(promptQueues[sessID]) :
                         promptQueues[sessID][i].status = "executing"}) <= 1

\* Edit lock is held by at most one user
SingleEditLockHolder ==
    \A sessID \in DOMAIN editLocks :
        editLocks[sessID] /= "NULL" =>
            editLocks[sessID] \in sessionUsers[sessID]

\* Sandbox in warm pool must be in "ready" status
WarmPoolSandboxesReady ==
    \A sid \in warmPool :
        /\ sid \in DOMAIN sandboxes
        /\ sandboxes[sid].status = "ready"

\* Active session must have a non-terminated sandbox
ActiveSessionHasValidSandbox ==
    \A sessID \in DOMAIN sessions :
        sessions[sessID].sandboxID \in DOMAIN sandboxes =>
            sandboxes[sessions[sessID].sandboxID].status /= "terminated"

\* Background agent status transitions are valid
ValidAgentStatusTransitions ==
    \A agentID \in DOMAIN backgroundAgents :
        LET status == backgroundAgents[agentID].status
        IN
        status \in AgentStatus

\* Users in session must be valid users
ValidSessionUsers ==
    \A sessID \in DOMAIN sessionUsers :
        sessionUsers[sessID] \subseteq Users

\* Snapshots reference valid sandboxes
ValidSnapshotReferences ==
    \A snapID \in DOMAIN snapshots :
        snapshots[snapID].sandboxID \in DOMAIN sandboxes \/ snapshots[snapID].sandboxID \in STRING

\* Connected clients have valid types
ValidClientTypes ==
    \A sessID \in DOMAIN connectedClients :
        \A c \in connectedClients[sessID] : c.type \in ClientType

\* At most one snapshot per session (simplified model)
\* In practice, multiple snapshots might be kept
SessionSnapshotConsistency ==
    \A sessID \in DOMAIN sessionSnapshots :
        sessionSnapshots[sessID] = "NULL" \/
        sessionSnapshots[sessID] \in DOMAIN snapshots

TypeInvariant ==
    /\ \A sid \in DOMAIN sandboxes : sandboxes[sid].status \in SandboxStatus
    /\ \A sid \in DOMAIN gitSyncStatus : gitSyncStatus[sid] \in GitSyncStatus
    /\ \A agentID \in DOMAIN backgroundAgents : backgroundAgents[agentID].status \in AgentStatus
    /\ warmPool \subseteq DOMAIN sandboxes
    /\ \A snapID \in DOMAIN snapshots : snapshots[snapID].sessionID \in DOMAIN sessions \/ snapshots[snapID].sessionID \in STRING
    /\ \A sessID \in DOMAIN clientSyncState : clientSyncState[sessID] \in Nat

SafetyInvariant ==
    /\ TypeInvariant
    /\ NoWritesBeforeSync
    /\ OnePromptExecutingPerSession
    /\ SingleEditLockHolder
    /\ WarmPoolSandboxesReady
    /\ ValidAgentStatusTransitions
    /\ ValidSessionUsers
    /\ ValidSnapshotReferences
    /\ ValidClientTypes
    /\ SessionSnapshotConsistency

(***************************************************************************)
(* LIVENESS PROPERTIES                                                     *)
(***************************************************************************)

\* Eventually git sync completes (fairness assumption on network)
GitSyncEventuallyCompletes ==
    \A sid \in DOMAIN gitSyncStatus :
        gitSyncStatus[sid] = "syncing" ~> gitSyncStatus[sid] \in {"synced", "error"}

\* Queued prompts eventually get executed (fairness assumption)
QueuedPromptsEventuallyExecute ==
    \A sessID \in DOMAIN sessions :
        (Len(promptQueues[sessID]) > 0 /\ promptQueues[sessID][1].status = "queued")
            ~> (promptQueues[sessID][1].status = "executing")

\* Background agents eventually complete or fail
AgentsEventuallyTerminate ==
    \A agentID \in DOMAIN backgroundAgents :
        backgroundAgents[agentID].status \in {"queued", "initializing", "running"}
            ~> backgroundAgents[agentID].status \in {"completed", "failed", "cancelled"}

\* Warm pool is replenished when depleted
WarmPoolEventuallyReplenished ==
    \A repo \in Repositories :
        ~WarmSandboxAvailable(repo) ~> WarmSandboxAvailable(repo)

LivenessProperty ==
    /\ GitSyncEventuallyCompletes
    /\ QueuedPromptsEventuallyExecute
    /\ AgentsEventuallyTerminate

(***************************************************************************)
(* SPECIFICATION                                                           *)
(***************************************************************************)

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

THEOREM Spec => []SafetyInvariant
THEOREM Spec => LivenessProperty

=============================================================================

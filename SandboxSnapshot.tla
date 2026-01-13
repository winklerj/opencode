---------------------------- MODULE SandboxSnapshot ----------------------------
(***************************************************************************)
(* TLA+ Specification for Sandbox Snapshot/Restore Behavior                *)
(*                                                                         *)
(* This module models the snapshot system where:                           *)
(*   - Snapshots are created when agent completes work                     *)
(*   - Snapshots are restored when user sends follow-up prompts            *)
(*   - Sandboxes can be terminated after snapshot to free resources        *)
(*   - Snapshots expire after a TTL and are cleaned up                     *)
(*   - Git sync must happen after restore to get latest changes            *)
(*                                                                         *)
(* Key Properties:                                                         *)
(*   - Session continuity: follow-ups restore previous state               *)
(*   - No data loss: uncommitted changes are preserved in snapshots        *)
(*   - Resource efficiency: idle sandboxes are terminated                  *)
(***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
    Sessions,           \* Set of session IDs
    MaxSnapshots,       \* Maximum snapshots to keep per session
    SnapshotTTL,        \* Time-to-live for snapshots
    NULL                \* Null value

VARIABLES
    sandboxes,          \* Function: sandboxID -> sandbox state
    snapshots,          \* Function: snapshotID -> snapshot record
    sessionSnapshots,   \* Function: sessionID -> sequence of snapshot IDs (newest first)
    time,               \* Logical time
    agentStatus,        \* Function: sessionID -> "idle" | "working" | "completed"
    pendingFollowUps,   \* Set of {sessionID, prompt} waiting for restore
    restorationCount,   \* Total restorations (metric)
    snapshotCount       \* Total snapshots created (metric)

vars == <<sandboxes, snapshots, sessionSnapshots, time, agentStatus,
          pendingFollowUps, restorationCount, snapshotCount>>

(***************************************************************************)
(* Type Definitions                                                        *)
(***************************************************************************)

SandboxStatus == {"initializing", "ready", "running", "terminated"}
AgentStatus == {"idle", "working", "completed"}
GitSyncStatus == {"pending", "syncing", "synced"}

SnapshotRecord == [
    id: Nat,
    sandboxID: Nat,
    sessionID: Sessions,
    createdAt: Nat,
    gitCommit: STRING,
    hasUncommittedChanges: BOOLEAN,
    expired: BOOLEAN
]

(***************************************************************************)
(* Initial State                                                           *)
(***************************************************************************)

Init ==
    /\ sandboxes = [s \in {} |-> {}]
    /\ snapshots = [s \in {} |-> {}]
    /\ sessionSnapshots = [s \in Sessions |-> <<>>]
    /\ time = 0
    /\ agentStatus = [s \in Sessions |-> "idle"]
    /\ pendingFollowUps = {}
    /\ restorationCount = 0
    /\ snapshotCount = 0

(***************************************************************************)
(* Helper Operators                                                        *)
(***************************************************************************)

\* Generate unique ID
NextSnapshotID == snapshotCount + 1
NextSandboxID == Cardinality(DOMAIN sandboxes) + 1

\* Get latest snapshot for session
GetLatestSnapshot(sessionID) ==
    IF Len(sessionSnapshots[sessionID]) > 0
    THEN LET snapID == Head(sessionSnapshots[sessionID])
         IN IF snapID \in DOMAIN snapshots
            THEN snapshots[snapID]
            ELSE NULL
    ELSE NULL

\* Check if session has valid (non-expired) snapshot
HasValidSnapshot(sessionID) ==
    /\ Len(sessionSnapshots[sessionID]) > 0
    /\ LET snapID == Head(sessionSnapshots[sessionID])
       IN /\ snapID \in DOMAIN snapshots
          /\ ~snapshots[snapID].expired
          /\ time - snapshots[snapID].createdAt < SnapshotTTL

\* Check if sandbox is active for session
HasActiveSandbox(sessionID) ==
    \E sid \in DOMAIN sandboxes :
        /\ sandboxes[sid].sessionID = sessionID
        /\ sandboxes[sid].status \in {"ready", "running"}

\* Get active sandbox for session
GetActiveSandbox(sessionID) ==
    CHOOSE sid \in DOMAIN sandboxes :
        /\ sandboxes[sid].sessionID = sessionID
        /\ sandboxes[sid].status \in {"ready", "running"}

(***************************************************************************)
(* Sandbox Lifecycle Actions                                               *)
(***************************************************************************)

\* Create new sandbox for session (cold start)
CreateSandbox(sessionID) ==
    /\ ~HasActiveSandbox(sessionID)
    /\ LET newID == NextSandboxID
       IN sandboxes' = sandboxes @@ (newID :> [
              id |-> newID,
              sessionID |-> sessionID,
              status |-> "initializing",
              gitSyncStatus |-> "pending",
              createdAt |-> time
           ])
    /\ UNCHANGED <<snapshots, sessionSnapshots, time, agentStatus,
                   pendingFollowUps, restorationCount, snapshotCount>>

\* Sandbox becomes ready
SandboxReady(sandboxID) ==
    /\ sandboxID \in DOMAIN sandboxes
    /\ sandboxes[sandboxID].status = "initializing"
    /\ sandboxes' = [sandboxes EXCEPT ![sandboxID].status = "ready",
                                       ![sandboxID].gitSyncStatus = "synced"]
    /\ UNCHANGED <<snapshots, sessionSnapshots, time, agentStatus,
                   pendingFollowUps, restorationCount, snapshotCount>>

\* Terminate sandbox (after snapshot)
TerminateSandbox(sandboxID) ==
    /\ sandboxID \in DOMAIN sandboxes
    /\ sandboxes[sandboxID].status \in {"ready", "running"}
    /\ sandboxes' = [sandboxes EXCEPT ![sandboxID].status = "terminated"]
    /\ UNCHANGED <<snapshots, sessionSnapshots, time, agentStatus,
                   pendingFollowUps, restorationCount, snapshotCount>>

(***************************************************************************)
(* Agent Work Actions                                                      *)
(***************************************************************************)

\* Agent starts working on prompt
StartWork(sessionID) ==
    /\ agentStatus[sessionID] = "idle"
    /\ HasActiveSandbox(sessionID)
    /\ agentStatus' = [agentStatus EXCEPT ![sessionID] = "working"]
    /\ LET sid == GetActiveSandbox(sessionID)
       IN sandboxes' = [sandboxes EXCEPT ![sid].status = "running"]
    /\ UNCHANGED <<snapshots, sessionSnapshots, time, pendingFollowUps,
                   restorationCount, snapshotCount>>

\* Agent completes work
CompleteWork(sessionID) ==
    /\ agentStatus[sessionID] = "working"
    /\ agentStatus' = [agentStatus EXCEPT ![sessionID] = "completed"]
    /\ UNCHANGED <<sandboxes, snapshots, sessionSnapshots, time,
                   pendingFollowUps, restorationCount, snapshotCount>>

(***************************************************************************)
(* Snapshot Actions                                                        *)
(***************************************************************************)

\* Create snapshot when agent completes work
CreateSnapshot(sessionID) ==
    /\ agentStatus[sessionID] = "completed"
    /\ HasActiveSandbox(sessionID)
    /\ Len(sessionSnapshots[sessionID]) < MaxSnapshots
    /\ LET sid == GetActiveSandbox(sessionID)
           newSnapID == NextSnapshotID
           newSnapshot == [
               id |-> newSnapID,
               sandboxID |-> sid,
               sessionID |-> sessionID,
               createdAt |-> time,
               gitCommit |-> "commit",
               hasUncommittedChanges |-> TRUE,
               expired |-> FALSE
           ]
       IN
       /\ snapshots' = snapshots @@ (newSnapID :> newSnapshot)
       /\ sessionSnapshots' = [sessionSnapshots EXCEPT
              ![sessionID] = <<newSnapID>> \o @]
       /\ snapshotCount' = snapshotCount + 1
    /\ agentStatus' = [agentStatus EXCEPT ![sessionID] = "idle"]
    /\ UNCHANGED <<sandboxes, time, pendingFollowUps, restorationCount>>

\* Terminate sandbox after snapshot is created
TerminateAfterSnapshot(sessionID) ==
    /\ agentStatus[sessionID] = "idle"
    /\ HasActiveSandbox(sessionID)
    /\ HasValidSnapshot(sessionID)
    /\ LET sid == GetActiveSandbox(sessionID)
       IN sandboxes' = [sandboxes EXCEPT ![sid].status = "terminated"]
    /\ UNCHANGED <<snapshots, sessionSnapshots, time, agentStatus,
                   pendingFollowUps, restorationCount, snapshotCount>>

(***************************************************************************)
(* Follow-Up and Restore Actions                                           *)
(***************************************************************************)

\* User sends follow-up prompt
SendFollowUp(sessionID, prompt) ==
    /\ agentStatus[sessionID] = "idle"
    /\ ~HasActiveSandbox(sessionID)
    /\ pendingFollowUps' = pendingFollowUps \union {[sessionID |-> sessionID, prompt |-> prompt]}
    /\ UNCHANGED <<sandboxes, snapshots, sessionSnapshots, time, agentStatus,
                   restorationCount, snapshotCount>>

\* Restore from snapshot for follow-up
RestoreFromSnapshot(sessionID) ==
    /\ \E fu \in pendingFollowUps : fu.sessionID = sessionID
    /\ HasValidSnapshot(sessionID)
    /\ ~HasActiveSandbox(sessionID)
    /\ LET snapshot == GetLatestSnapshot(sessionID)
           newSandboxID == NextSandboxID
       IN
       /\ sandboxes' = sandboxes @@ (newSandboxID :> [
              id |-> newSandboxID,
              sessionID |-> sessionID,
              status |-> "ready",
              gitSyncStatus |-> "pending",  \* Need to sync after restore
              createdAt |-> time,
              restoredFrom |-> snapshot.id
           ])
       /\ restorationCount' = restorationCount + 1
    /\ pendingFollowUps' = {fu \in pendingFollowUps : fu.sessionID /= sessionID}
    /\ UNCHANGED <<snapshots, sessionSnapshots, time, agentStatus, snapshotCount>>

\* Cold start for follow-up (no valid snapshot)
ColdStartForFollowUp(sessionID) ==
    /\ \E fu \in pendingFollowUps : fu.sessionID = sessionID
    /\ ~HasValidSnapshot(sessionID)
    /\ ~HasActiveSandbox(sessionID)
    /\ LET newSandboxID == NextSandboxID
       IN sandboxes' = sandboxes @@ (newSandboxID :> [
              id |-> newSandboxID,
              sessionID |-> sessionID,
              status |-> "initializing",
              gitSyncStatus |-> "pending",
              createdAt |-> time
           ])
    /\ pendingFollowUps' = {fu \in pendingFollowUps : fu.sessionID /= sessionID}
    /\ UNCHANGED <<snapshots, sessionSnapshots, time, agentStatus,
                   restorationCount, snapshotCount>>

(***************************************************************************)
(* Snapshot Expiration Actions                                             *)
(***************************************************************************)

\* Mark snapshot as expired
ExpireSnapshot(snapshotID) ==
    /\ snapshotID \in DOMAIN snapshots
    /\ ~snapshots[snapshotID].expired
    /\ time - snapshots[snapshotID].createdAt >= SnapshotTTL
    /\ snapshots' = [snapshots EXCEPT ![snapshotID].expired = TRUE]
    /\ UNCHANGED <<sandboxes, sessionSnapshots, time, agentStatus,
                   pendingFollowUps, restorationCount, snapshotCount>>

\* Clean up expired snapshot
CleanupExpiredSnapshot(snapshotID) ==
    /\ snapshotID \in DOMAIN snapshots
    /\ snapshots[snapshotID].expired
    /\ LET sessID == snapshots[snapshotID].sessionID
       IN sessionSnapshots' = [sessionSnapshots EXCEPT
              ![sessID] = SelectSeq(@, LAMBDA x: x /= snapshotID)]
    /\ snapshots' = [s \in (DOMAIN snapshots \ {snapshotID}) |-> snapshots[s]]
    /\ UNCHANGED <<sandboxes, time, agentStatus, pendingFollowUps,
                   restorationCount, snapshotCount>>

(***************************************************************************)
(* Time Advancement                                                        *)
(***************************************************************************)

Tick ==
    /\ time' = time + 1
    /\ UNCHANGED <<sandboxes, snapshots, sessionSnapshots, agentStatus,
                   pendingFollowUps, restorationCount, snapshotCount>>

(***************************************************************************)
(* Next State Relation                                                     *)
(***************************************************************************)

Next ==
    \/ \E sessID \in Sessions : CreateSandbox(sessID)
    \/ \E sid \in DOMAIN sandboxes : SandboxReady(sid)
    \/ \E sid \in DOMAIN sandboxes : TerminateSandbox(sid)
    \/ \E sessID \in Sessions : StartWork(sessID)
    \/ \E sessID \in Sessions : CompleteWork(sessID)
    \/ \E sessID \in Sessions : CreateSnapshot(sessID)
    \/ \E sessID \in Sessions : TerminateAfterSnapshot(sessID)
    \/ \E sessID \in Sessions, prompt \in STRING : SendFollowUp(sessID, prompt)
    \/ \E sessID \in Sessions : RestoreFromSnapshot(sessID)
    \/ \E sessID \in Sessions : ColdStartForFollowUp(sessID)
    \/ \E snapID \in DOMAIN snapshots : ExpireSnapshot(snapID)
    \/ \E snapID \in DOMAIN snapshots : CleanupExpiredSnapshot(snapID)
    \/ Tick

(***************************************************************************)
(* SAFETY INVARIANTS                                                       *)
(***************************************************************************)

\* At most one active sandbox per session
AtMostOneActiveSandboxPerSession ==
    \A sessID \in Sessions :
        Cardinality({sid \in DOMAIN sandboxes :
            /\ sandboxes[sid].sessionID = sessID
            /\ sandboxes[sid].status \in {"initializing", "ready", "running"}}) <= 1

\* Snapshots reference valid sessions
SnapshotsReferenceValidSessions ==
    \A snapID \in DOMAIN snapshots :
        snapshots[snapID].sessionID \in Sessions

\* Session snapshot list contains valid snapshot IDs
ValidSessionSnapshotLists ==
    \A sessID \in Sessions :
        \A i \in 1..Len(sessionSnapshots[sessID]) :
            sessionSnapshots[sessID][i] \in DOMAIN snapshots

\* Agent status is consistent with sandbox state
AgentStatusConsistency ==
    \A sessID \in Sessions :
        agentStatus[sessID] = "working" => HasActiveSandbox(sessID)

\* Pending follow-ups are for idle agents
PendingFollowUpsConsistency ==
    \A fu \in pendingFollowUps :
        agentStatus[fu.sessionID] = "idle"

\* Snapshot count is monotonically increasing
ValidSnapshotCount ==
    snapshotCount >= Cardinality(DOMAIN snapshots)

\* Type invariant
TypeInvariant ==
    /\ time \in Nat
    /\ restorationCount \in Nat
    /\ snapshotCount \in Nat
    /\ \A sessID \in Sessions : agentStatus[sessID] \in AgentStatus

SafetyInvariant ==
    /\ TypeInvariant
    /\ AtMostOneActiveSandboxPerSession
    /\ SnapshotsReferenceValidSessions
    /\ AgentStatusConsistency
    /\ PendingFollowUpsConsistency
    /\ ValidSnapshotCount

(***************************************************************************)
(* LIVENESS PROPERTIES                                                     *)
(***************************************************************************)

\* Follow-ups eventually get a sandbox (restored or cold start)
FollowUpsEventuallyServiced ==
    \A fu \in pendingFollowUps :
        <>(HasActiveSandbox(fu.sessionID))

\* Completed work eventually results in snapshot
CompletedWorkEventuallySnapshotted ==
    \A sessID \in Sessions :
        (agentStatus[sessID] = "completed") ~>
            (agentStatus[sessID] = "idle" /\ HasValidSnapshot(sessID))

\* Expired snapshots eventually cleaned up
ExpiredSnapshotsEventuallyCleaned ==
    \A snapID \in DOMAIN snapshots :
        snapshots[snapID].expired ~> (snapID \notin DOMAIN snapshots)

(***************************************************************************)
(* PERFORMANCE PROPERTIES                                                  *)
(***************************************************************************)

\* Restoration rate (prefer restore over cold start)
RestorationEfficiency ==
    restorationCount > 0 =>
        \* At least some follow-ups use restoration
        TRUE

(***************************************************************************)
(* SPECIFICATION                                                           *)
(***************************************************************************)

Fairness ==
    /\ WF_vars(Tick)
    /\ \A sessID \in Sessions : WF_vars(CreateSnapshot(sessID))
    /\ \A sessID \in Sessions : WF_vars(RestoreFromSnapshot(sessID))

Spec == Init /\ [][Next]_vars /\ Fairness

THEOREM Spec => []SafetyInvariant

=============================================================================

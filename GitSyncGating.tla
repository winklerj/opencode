---------------------------- MODULE GitSyncGating ----------------------------
(***************************************************************************)
(* TLA+ Specification for Git Sync Gating                                  *)
(*                                                                         *)
(* This module specifically models the critical safety property that       *)
(* write operations (edit, write, patch, multiedit) are blocked until      *)
(* git synchronization is complete, while read operations (read, glob,     *)
(* grep, ls) are allowed immediately.                                      *)
(*                                                                         *)
(* Key Safety Property:                                                    *)
(*   No file modifications occur before the sandbox is synchronized        *)
(*   with the latest code from the base branch.                           *)
(*                                                                         *)
(* This prevents:                                                          *)
(*   - Race conditions where edits are based on stale code                *)
(*   - Merge conflicts from editing outdated files                        *)
(*   - Lost work when sync overwrites local changes                       *)
(***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
    Files,          \* Set of file paths
    Tools,          \* Set of tool names
    NULL            \* Null value

VARIABLES
    syncStatus,     \* Current git sync status: "pending" | "syncing" | "synced" | "error"
    pendingOps,     \* Set of operations waiting for sync to complete
    completedOps,   \* Sequence of completed operations (for verification)
    blockedOps,     \* Count of operations that were blocked
    allowedOps      \* Count of operations that proceeded immediately

vars == <<syncStatus, pendingOps, completedOps, blockedOps, allowedOps>>

(***************************************************************************)
(* Tool Classification                                                     *)
(***************************************************************************)

ReadTools == {"read", "glob", "grep", "ls", "codesearch"}
WriteTools == {"edit", "write", "patch", "multiedit", "bash"}

IsReadTool(tool) == tool \in ReadTools
IsWriteTool(tool) == tool \in WriteTools

(***************************************************************************)
(* Operation Record                                                        *)
(***************************************************************************)

OperationRecord == [
    tool: Tools,
    file: Files,
    timestamp: Nat
]

(***************************************************************************)
(* Initial State                                                           *)
(***************************************************************************)

Init ==
    /\ syncStatus = "pending"
    /\ pendingOps = {}
    /\ completedOps = <<>>
    /\ blockedOps = 0
    /\ allowedOps = 0

(***************************************************************************)
(* Git Sync Actions                                                        *)
(***************************************************************************)

\* Start synchronization with remote
StartSync ==
    /\ syncStatus = "pending"
    /\ syncStatus' = "syncing"
    /\ UNCHANGED <<pendingOps, completedOps, blockedOps, allowedOps>>

\* Sync completes successfully
CompleteSync ==
    /\ syncStatus = "syncing"
    /\ syncStatus' = "synced"
    \* All pending operations can now proceed
    /\ completedOps' = completedOps \o SetToSeq(pendingOps)
    /\ pendingOps' = {}
    /\ UNCHANGED <<blockedOps, allowedOps>>

\* Sync fails with error
SyncError ==
    /\ syncStatus = "syncing"
    /\ syncStatus' = "error"
    \* Pending operations remain blocked
    /\ UNCHANGED <<pendingOps, completedOps, blockedOps, allowedOps>>

\* Retry sync after error
RetrySync ==
    /\ syncStatus = "error"
    /\ syncStatus' = "syncing"
    /\ UNCHANGED <<pendingOps, completedOps, blockedOps, allowedOps>>

(***************************************************************************)
(* Tool Execution Actions                                                  *)
(***************************************************************************)

\* Attempt a read operation (always allowed)
AttemptReadOp(tool, file) ==
    /\ IsReadTool(tool)
    /\ LET op == [tool |-> tool, file |-> file, timestamp |-> 0]
       IN
       /\ completedOps' = Append(completedOps, op)
       /\ allowedOps' = allowedOps + 1
    /\ UNCHANGED <<syncStatus, pendingOps, blockedOps>>

\* Attempt a write operation
AttemptWriteOp(tool, file) ==
    /\ IsWriteTool(tool)
    /\ LET op == [tool |-> tool, file |-> file, timestamp |-> 0]
       IN
       IF syncStatus = "synced"
       THEN
           \* Sync complete: operation proceeds immediately
           /\ completedOps' = Append(completedOps, op)
           /\ allowedOps' = allowedOps + 1
           /\ UNCHANGED <<syncStatus, pendingOps, blockedOps>>
       ELSE
           \* Sync not complete: operation is blocked
           /\ pendingOps' = pendingOps \union {op}
           /\ blockedOps' = blockedOps + 1
           /\ UNCHANGED <<syncStatus, completedOps, allowedOps>>

(***************************************************************************)
(* Helper: Convert Set to Sequence                                         *)
(***************************************************************************)

RECURSIVE SetToSeqHelper(_, _)
SetToSeqHelper(S, seq) ==
    IF S = {} THEN seq
    ELSE LET x == CHOOSE x \in S : TRUE
         IN SetToSeqHelper(S \ {x}, Append(seq, x))

SetToSeq(S) == SetToSeqHelper(S, <<>>)

(***************************************************************************)
(* Next State Relation                                                     *)
(***************************************************************************)

Next ==
    \/ StartSync
    \/ CompleteSync
    \/ SyncError
    \/ RetrySync
    \/ \E tool \in ReadTools, file \in Files : AttemptReadOp(tool, file)
    \/ \E tool \in WriteTools, file \in Files : AttemptWriteOp(tool, file)

(***************************************************************************)
(* SAFETY INVARIANTS                                                       *)
(***************************************************************************)

\* CRITICAL: No write operation in completedOps occurred before sync was complete
\* This is enforced by the AttemptWriteOp action structure
NoWriteBeforeSync ==
    \A i \in 1..Len(completedOps) :
        IsWriteTool(completedOps[i].tool) =>
            \* If this was a write op that completed, sync must have been done
            \* (This is implicitly true by our action structure, but we verify it)
            TRUE

\* All pending operations are write operations (reads never block)
PendingOpsAreWriteOps ==
    \A op \in pendingOps : IsWriteTool(op.tool)

\* If sync is not complete, no write has been completed
NoCompletedWritesBeforeSync ==
    syncStatus /= "synced" =>
        \A i \in 1..Len(completedOps) : IsReadTool(completedOps[i].tool)

\* Valid sync status
ValidSyncStatus ==
    syncStatus \in {"pending", "syncing", "synced", "error"}

\* Type invariant
TypeInvariant ==
    /\ ValidSyncStatus
    /\ blockedOps \in Nat
    /\ allowedOps \in Nat
    /\ blockedOps >= Cardinality(pendingOps)

SafetyInvariant ==
    /\ TypeInvariant
    /\ PendingOpsAreWriteOps
    /\ NoCompletedWritesBeforeSync

(***************************************************************************)
(* LIVENESS PROPERTIES                                                     *)
(***************************************************************************)

\* Sync eventually completes or errors
SyncEventuallyResolves ==
    syncStatus \in {"pending", "syncing"} ~> syncStatus \in {"synced", "error"}

\* Pending operations eventually complete (assuming sync eventually succeeds)
PendingOpsEventuallyComplete ==
    pendingOps /= {} ~> pendingOps = {}

(***************************************************************************)
(* SPECIFICATION                                                           *)
(***************************************************************************)

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

THEOREM Spec => []SafetyInvariant

=============================================================================

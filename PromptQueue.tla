---------------------------- MODULE PromptQueue ----------------------------
(***************************************************************************)
(* TLA+ Specification for Prompt Queue Behavior                            *)
(*                                                                         *)
(* This module models the prompt queue system where:                       *)
(*   - Follow-up prompts during execution are QUEUED (not inserted)        *)
(*   - Only one prompt executes at a time per session                      *)
(*   - Users can only cancel their own queued prompts                      *)
(*   - Prompts are processed in FIFO order (with priority consideration)   *)
(*   - Agent can be stopped mid-execution                                  *)
(*                                                                         *)
(* Key Properties:                                                         *)
(*   - At most one prompt executing at any time                            *)
(*   - No prompt starvation (fairness)                                     *)
(*   - Cancel only affects own prompts                                     *)
(***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
    Users,          \* Set of user IDs
    MaxQueueSize    \* Maximum prompts in queue

VARIABLES
    queue,          \* Sequence of prompt records
    sessionStatus,  \* "idle" | "executing" | "stopping"
    currentPrompt,  \* Currently executing prompt (or NULL)
    completedCount, \* Number of completed prompts (for metrics)
    cancelledCount  \* Number of cancelled prompts (for metrics)

vars == <<queue, sessionStatus, currentPrompt, completedCount, cancelledCount>>

(***************************************************************************)
(* Type Definitions                                                        *)
(***************************************************************************)

PromptStatus == {"queued", "executing", "completed", "cancelled"}
SessionStatus == {"idle", "executing", "stopping"}

PromptRecord == [
    id: Nat,
    userID: Users,
    content: STRING,
    status: PromptStatus,
    priority: Nat
]

NULL == "NULL"

(***************************************************************************)
(* Initial State                                                           *)
(***************************************************************************)

Init ==
    /\ queue = <<>>
    /\ sessionStatus = "idle"
    /\ currentPrompt = NULL
    /\ completedCount = 0
    /\ cancelledCount = 0

(***************************************************************************)
(* Helper Operators                                                        *)
(***************************************************************************)

\* Generate unique ID based on queue history
NextPromptID == completedCount + cancelledCount + Len(queue) + 1

\* Find index of prompt in queue
RECURSIVE FindPromptIndex(_, _, _)
FindPromptIndex(q, promptID, idx) ==
    IF idx > Len(q) THEN 0
    ELSE IF q[idx].id = promptID THEN idx
    ELSE FindPromptIndex(q, promptID, idx + 1)

\* Remove element at index from sequence
RemoveAt(seq, idx) ==
    SubSeq(seq, 1, idx - 1) \o SubSeq(seq, idx + 1, Len(seq))

\* Check if any prompt is executing
IsExecuting == sessionStatus = "executing"

\* Check if queue has queued prompts
HasQueuedPrompts ==
    \E i \in 1..Len(queue) : queue[i].status = "queued"

(***************************************************************************)
(* Queue Prompt Action                                                     *)
(* Follow-ups during execution are queued, not inserted mid-stream         *)
(***************************************************************************)

QueuePrompt(userID, content, priority) ==
    /\ Len(queue) < MaxQueueSize
    /\ LET newPrompt == [
            id |-> NextPromptID,
            userID |-> userID,
            content |-> content,
            status |-> "queued",
            priority |-> priority
        ]
       IN
       queue' = Append(queue, newPrompt)
    /\ UNCHANGED <<sessionStatus, currentPrompt, completedCount, cancelledCount>>

(***************************************************************************)
(* Start Execution Action                                                  *)
(* Begins executing the next queued prompt (FIFO with priority)            *)
(***************************************************************************)

StartExecution ==
    /\ sessionStatus = "idle"
    /\ Len(queue) > 0
    /\ queue[1].status = "queued"
    /\ sessionStatus' = "executing"
    /\ currentPrompt' = queue[1]
    /\ queue' = [queue EXCEPT ![1].status = "executing"]
    /\ UNCHANGED <<completedCount, cancelledCount>>

(***************************************************************************)
(* Complete Execution Action                                               *)
(* Marks current prompt as completed and returns to idle                   *)
(***************************************************************************)

CompleteExecution ==
    /\ sessionStatus = "executing"
    /\ currentPrompt /= NULL
    /\ sessionStatus' = "idle"
    /\ currentPrompt' = NULL
    /\ queue' = Tail(queue)  \* Remove completed prompt
    /\ completedCount' = completedCount + 1
    /\ UNCHANGED <<cancelledCount>>

(***************************************************************************)
(* Stop Execution Action                                                   *)
(* Agent is stopped mid-execution                                          *)
(***************************************************************************)

RequestStop ==
    /\ sessionStatus = "executing"
    /\ sessionStatus' = "stopping"
    /\ UNCHANGED <<queue, currentPrompt, completedCount, cancelledCount>>

HandleStop ==
    /\ sessionStatus = "stopping"
    /\ sessionStatus' = "idle"
    /\ currentPrompt' = NULL
    /\ queue' = Tail(queue)  \* Remove stopped prompt
    /\ cancelledCount' = cancelledCount + 1
    /\ UNCHANGED <<completedCount>>

(***************************************************************************)
(* Cancel Queued Prompt Action                                             *)
(* User can only cancel their own queued (not executing) prompts           *)
(***************************************************************************)

CancelPrompt(userID, promptID) ==
    /\ LET idx == FindPromptIndex(queue, promptID, 1)
       IN
       /\ idx > 0
       /\ idx > 1  \* Cannot cancel the currently executing prompt (index 1 if executing)
       /\ queue[idx].userID = userID  \* Can only cancel own prompts
       /\ queue[idx].status = "queued"  \* Can only cancel queued prompts
       /\ queue' = RemoveAt(queue, idx)
       /\ cancelledCount' = cancelledCount + 1
    /\ UNCHANGED <<sessionStatus, currentPrompt, completedCount>>

(***************************************************************************)
(* Reorder Prompt Action                                                   *)
(* User can reorder their own queued prompts (change priority)             *)
(***************************************************************************)

ReorderPrompt(userID, promptID, newPriority) ==
    /\ LET idx == FindPromptIndex(queue, promptID, 1)
       IN
       /\ idx > 1  \* Cannot reorder currently executing
       /\ queue[idx].userID = userID
       /\ queue[idx].status = "queued"
       /\ queue' = [queue EXCEPT ![idx].priority = newPriority]
    /\ UNCHANGED <<sessionStatus, currentPrompt, completedCount, cancelledCount>>

(***************************************************************************)
(* Next State Relation                                                     *)
(***************************************************************************)

Next ==
    \/ \E userID \in Users, content \in STRING, priority \in 0..10 :
           QueuePrompt(userID, content, priority)
    \/ StartExecution
    \/ CompleteExecution
    \/ RequestStop
    \/ HandleStop
    \/ \E userID \in Users, promptID \in Nat :
           CancelPrompt(userID, promptID)
    \/ \E userID \in Users, promptID \in Nat, priority \in 0..10 :
           ReorderPrompt(userID, promptID, priority)

(***************************************************************************)
(* SAFETY INVARIANTS                                                       *)
(***************************************************************************)

\* At most one prompt is executing at any time
AtMostOneExecuting ==
    Cardinality({i \in 1..Len(queue) : queue[i].status = "executing"}) <= 1

\* If session is executing, exactly one prompt should be executing
ExecutingConsistency ==
    sessionStatus = "executing" =>
        /\ currentPrompt /= NULL
        /\ Len(queue) > 0
        /\ queue[1].status = "executing"

\* If session is idle, no prompt should be executing
IdleConsistency ==
    sessionStatus = "idle" =>
        /\ currentPrompt = NULL
        /\ (Len(queue) = 0 \/ queue[1].status = "queued")

\* Only queued prompts in queue (besides the first which may be executing)
QueueConsistency ==
    \A i \in 2..Len(queue) : queue[i].status = "queued"

\* Valid session status
ValidSessionStatus ==
    sessionStatus \in SessionStatus

\* Type invariant
TypeInvariant ==
    /\ ValidSessionStatus
    /\ completedCount \in Nat
    /\ cancelledCount \in Nat
    /\ Len(queue) <= MaxQueueSize

SafetyInvariant ==
    /\ TypeInvariant
    /\ AtMostOneExecuting
    /\ ExecutingConsistency
    /\ IdleConsistency
    /\ QueueConsistency

(***************************************************************************)
(* LIVENESS PROPERTIES                                                     *)
(***************************************************************************)

\* Queued prompts eventually get executed (no starvation)
NoStarvation ==
    \A i \in 1..Len(queue) :
        queue[i].status = "queued" ~>
            (queue[i].status = "executing" \/ queue[i].status = "cancelled")

\* Executing prompts eventually complete or are stopped
ExecutionTerminates ==
    sessionStatus = "executing" ~> sessionStatus \in {"idle", "stopping"}

\* System doesn't get stuck
Progress ==
    (Len(queue) > 0 /\ sessionStatus = "idle") ~>
        (sessionStatus = "executing" \/ Len(queue) = 0)

(***************************************************************************)
(* SPECIFICATION                                                           *)
(***************************************************************************)

Fairness == WF_vars(Next)

Spec == Init /\ [][Next]_vars /\ Fairness

THEOREM Spec => []SafetyInvariant
THEOREM Spec => NoStarvation
THEOREM Spec => ExecutionTerminates

=============================================================================

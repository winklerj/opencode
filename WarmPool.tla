------------------------------ MODULE WarmPool ------------------------------
(***************************************************************************)
(* TLA+ Specification for Warm Pool Management                             *)
(*                                                                         *)
(* This module models the warm sandbox pool system where:                  *)
(*   - Pre-warmed sandboxes are maintained per repository                  *)
(*   - Sandboxes are claimed when user starts typing (not on send)         *)
(*   - Pool is replenished as sandboxes are claimed                        *)
(*   - Sandboxes expire after TTL and are recycled                        *)
(*   - New image builds invalidate existing warm sandboxes                 *)
(*                                                                         *)
(* Key Properties:                                                         *)
(*   - Fast session start (sandbox ready before user finishes typing)      *)
(*   - No resource waste (expired sandboxes are cleaned up)                *)
(*   - Pool stays populated for high-volume repos                          *)
(***************************************************************************)

EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
    Repositories,       \* Set of repository names
    MaxPoolSize,        \* Maximum sandboxes per repository
    TTL,               \* Time-to-live for warm sandboxes
    ImageBuildInterval  \* Interval between image rebuilds (30 min)

VARIABLES
    pool,              \* Function: repo -> set of sandbox records
    images,            \* Function: repo -> current image version
    time,              \* Current logical time
    claimedSandboxes,  \* Set of sandboxes currently in use
    totalClaims,       \* Total sandboxes claimed (metric)
    poolHits,          \* Claims that got a warm sandbox
    poolMisses         \* Claims that required cold start

vars == <<pool, images, time, claimedSandboxes, totalClaims, poolHits, poolMisses>>

(***************************************************************************)
(* Type Definitions                                                        *)
(***************************************************************************)

SandboxStatus == {"warming", "ready", "claimed", "expired"}

SandboxRecord == [
    id: Nat,
    repo: Repositories,
    imageVersion: Nat,
    status: SandboxStatus,
    createdAt: Nat,
    claimedAt: Nat
]

(***************************************************************************)
(* Initial State                                                           *)
(***************************************************************************)

Init ==
    /\ pool = [r \in Repositories |-> {}]
    /\ images = [r \in Repositories |-> 1]
    /\ time = 0
    /\ claimedSandboxes = {}
    /\ totalClaims = 0
    /\ poolHits = 0
    /\ poolMisses = 0

(***************************************************************************)
(* Helper Operators                                                        *)
(***************************************************************************)

\* Generate unique sandbox ID
NextSandboxID ==
    LET allSandboxes == UNION {pool[r] : r \in Repositories} \union claimedSandboxes
    IN Cardinality(allSandboxes) + 1

\* Get ready sandboxes for a repository with current image
ReadySandboxes(repo) ==
    {s \in pool[repo] :
        /\ s.status = "ready"
        /\ s.imageVersion = images[repo]
        /\ time - s.createdAt < TTL}

\* Check if warm sandbox available for repo
WarmAvailable(repo) ==
    ReadySandboxes(repo) /= {}

\* Get any ready sandbox from pool
GetWarmSandbox(repo) ==
    CHOOSE s \in ReadySandboxes(repo) : TRUE

\* Count sandboxes warming or ready for repo
PoolCount(repo) ==
    Cardinality({s \in pool[repo] :
        s.status \in {"warming", "ready"} /\ s.imageVersion = images[repo]})

\* Check if sandbox is expired
IsExpired(sandbox) ==
    time - sandbox.createdAt >= TTL

\* Check if sandbox has outdated image
IsOutdated(sandbox) ==
    sandbox.imageVersion < images[sandbox.repo]

(***************************************************************************)
(* User Typing Trigger                                                     *)
(* Claim sandbox as soon as user starts typing (not on send)               *)
(***************************************************************************)

UserStartsTyping(repo) ==
    IF WarmAvailable(repo)
    THEN
        \* Warm sandbox available - instant claim
        LET sandbox == GetWarmSandbox(repo)
            claimed == [sandbox EXCEPT !.status = "claimed", !.claimedAt = time]
        IN
        /\ pool' = [pool EXCEPT ![repo] = @ \ {sandbox}]
        /\ claimedSandboxes' = claimedSandboxes \union {claimed}
        /\ poolHits' = poolHits + 1
        /\ totalClaims' = totalClaims + 1
        /\ UNCHANGED <<images, time, poolMisses>>
    ELSE
        \* Cold start required
        /\ poolMisses' = poolMisses + 1
        /\ totalClaims' = totalClaims + 1
        /\ UNCHANGED <<pool, images, time, claimedSandboxes, poolHits>>

(***************************************************************************)
(* Pool Replenishment                                                      *)
(* Add new sandbox to pool when below target size                          *)
(***************************************************************************)

StartWarmingSandbox(repo) ==
    /\ PoolCount(repo) < MaxPoolSize
    /\ LET newSandbox == [
            id |-> NextSandboxID,
            repo |-> repo,
            imageVersion |-> images[repo],
            status |-> "warming",
            createdAt |-> time,
            claimedAt |-> 0
        ]
       IN
       pool' = [pool EXCEPT ![repo] = @ \union {newSandbox}]
    /\ UNCHANGED <<images, time, claimedSandboxes, totalClaims, poolHits, poolMisses>>

\* Sandbox finishes warming and becomes ready
SandboxBecomesReady(repo, sandboxID) ==
    /\ \E s \in pool[repo] :
        /\ s.id = sandboxID
        /\ s.status = "warming"
        /\ LET ready == [s EXCEPT !.status = "ready"]
           IN pool' = [pool EXCEPT ![repo] = (@ \ {s}) \union {ready}]
    /\ UNCHANGED <<images, time, claimedSandboxes, totalClaims, poolHits, poolMisses>>

(***************************************************************************)
(* Image Build                                                             *)
(* New images are built every 30 minutes, invalidating old sandboxes       *)
(***************************************************************************)

BuildNewImage(repo) ==
    /\ images' = [images EXCEPT ![repo] = @ + 1]
    \* Old sandboxes marked for cleanup (will be removed by ExpireSandbox)
    /\ UNCHANGED <<pool, time, claimedSandboxes, totalClaims, poolHits, poolMisses>>

(***************************************************************************)
(* Sandbox Expiration                                                      *)
(* Remove sandboxes past TTL or with outdated images                       *)
(***************************************************************************)

ExpireSandbox(repo, sandboxID) ==
    /\ \E s \in pool[repo] :
        /\ s.id = sandboxID
        /\ (IsExpired(s) \/ IsOutdated(s))
        /\ pool' = [pool EXCEPT ![repo] = @ \ {s}]
    /\ UNCHANGED <<images, time, claimedSandboxes, totalClaims, poolHits, poolMisses>>

(***************************************************************************)
(* Session End                                                             *)
(* Sandbox returned to pool or terminated                                  *)
(***************************************************************************)

ReturnSandboxToPool(sandboxID) ==
    /\ \E s \in claimedSandboxes :
        /\ s.id = sandboxID
        /\ ~IsExpired(s)
        /\ ~IsOutdated(s)
        /\ LET returned == [s EXCEPT !.status = "ready"]
           IN
           /\ pool' = [pool EXCEPT ![s.repo] = @ \union {returned}]
           /\ claimedSandboxes' = claimedSandboxes \ {s}
    /\ UNCHANGED <<images, time, totalClaims, poolHits, poolMisses>>

TerminateSandbox(sandboxID) ==
    /\ \E s \in claimedSandboxes :
        /\ s.id = sandboxID
        /\ claimedSandboxes' = claimedSandboxes \ {s}
    /\ UNCHANGED <<pool, images, time, totalClaims, poolHits, poolMisses>>

(***************************************************************************)
(* Time Advancement                                                        *)
(***************************************************************************)

Tick ==
    /\ time' = time + 1
    /\ UNCHANGED <<pool, images, claimedSandboxes, totalClaims, poolHits, poolMisses>>

(***************************************************************************)
(* Next State Relation                                                     *)
(***************************************************************************)

Next ==
    \/ \E repo \in Repositories : UserStartsTyping(repo)
    \/ \E repo \in Repositories : StartWarmingSandbox(repo)
    \/ \E repo \in Repositories, sid \in Nat : SandboxBecomesReady(repo, sid)
    \/ \E repo \in Repositories : BuildNewImage(repo)
    \/ \E repo \in Repositories, sid \in Nat : ExpireSandbox(repo, sid)
    \/ \E sid \in Nat : ReturnSandboxToPool(sid)
    \/ \E sid \in Nat : TerminateSandbox(sid)
    \/ Tick

(***************************************************************************)
(* SAFETY INVARIANTS                                                       *)
(***************************************************************************)

\* Pool size never exceeds maximum
PoolSizeLimit ==
    \A repo \in Repositories : Cardinality(pool[repo]) <= MaxPoolSize

\* No duplicate sandbox IDs
NoDuplicateIDs ==
    LET allSandboxes == UNION {pool[r] : r \in Repositories} \union claimedSandboxes
        ids == {s.id : s \in allSandboxes}
    IN Cardinality(ids) = Cardinality(allSandboxes)

\* Claimed sandboxes are not in pool
ClaimedNotInPool ==
    \A s \in claimedSandboxes :
        s \notin pool[s.repo]

\* Only valid statuses
ValidStatuses ==
    /\ \A repo \in Repositories :
        \A s \in pool[repo] : s.status \in {"warming", "ready"}
    /\ \A s \in claimedSandboxes : s.status = "claimed"

\* Image versions are monotonically increasing
ValidImageVersions ==
    \A repo \in Repositories : images[repo] >= 1

\* Metrics consistency
MetricsConsistency ==
    /\ totalClaims = poolHits + poolMisses
    /\ poolHits >= 0
    /\ poolMisses >= 0

TypeInvariant ==
    /\ time \in Nat
    /\ totalClaims \in Nat
    /\ poolHits \in Nat
    /\ poolMisses \in Nat

SafetyInvariant ==
    /\ TypeInvariant
    /\ PoolSizeLimit
    /\ NoDuplicateIDs
    /\ ClaimedNotInPool
    /\ ValidStatuses
    /\ ValidImageVersions
    /\ MetricsConsistency

(***************************************************************************)
(* LIVENESS PROPERTIES                                                     *)
(***************************************************************************)

\* Pool eventually has ready sandboxes for each repo (if replenishment enabled)
PoolEventuallyReady ==
    \A repo \in Repositories :
        PoolCount(repo) < MaxPoolSize ~>
            (PoolCount(repo) >= 1 \/ WarmAvailable(repo))

\* Expired sandboxes are eventually removed
ExpiredEventuallyRemoved ==
    \A repo \in Repositories :
        \A s \in pool[repo] :
            IsExpired(s) ~> s \notin pool[repo]

\* Outdated sandboxes are eventually removed
OutdatedEventuallyRemoved ==
    \A repo \in Repositories :
        \A s \in pool[repo] :
            IsOutdated(s) ~> s \notin pool[repo]

(***************************************************************************)
(* PERFORMANCE METRICS                                                     *)
(***************************************************************************)

\* Pool hit rate (ideally high)
PoolHitRate ==
    IF totalClaims > 0
    THEN poolHits * 100 \div totalClaims
    ELSE 100

\* Target: Pool hit rate should be > 80% in steady state
HighPoolHitRate ==
    totalClaims >= 10 => PoolHitRate >= 80

(***************************************************************************)
(* SPECIFICATION                                                           *)
(***************************************************************************)

Fairness ==
    /\ WF_vars(Tick)
    /\ \A repo \in Repositories : WF_vars(StartWarmingSandbox(repo))

Spec == Init /\ [][Next]_vars /\ Fairness

THEOREM Spec => []SafetyInvariant

=============================================================================

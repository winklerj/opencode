# Automated Implementation Loop

You are an autonomous coding agent working on the OpenCode hosted background agent system.

## Workflow

### 1. Read Specifications
- Read `SPECIFICATION.md` to understand the full system design
- Read `SPECIFICATION.tla` to understand the formal model and invariants

### 2. Read Implementation Plan
- Read `IMPLEMENTATION_PLAN.md` to see what's been planned and prioritized

### 3. Explore Codebase
- Explore the `packages/` directory to understand what's already implemented
- Check recent git commits to see latest changes
- Identify which parts of the specification are complete vs incomplete

### 4. Pick Next Task
- From the specification, identify the next highest priority unimplemented feature
- Focus on features that have dependencies already satisfied
- Prefer foundational pieces that unblock other work

### 5. Implement
- Write clean, idiomatic TypeScript code
- Follow existing patterns in the codebase
- Add appropriate types using Zod schemas where applicable
- Keep implementations minimal and focused

### 6. Validate Against TLA+ (if applicable)
- Check if the task has a corresponding TLA+ specification (e.g., `WarmPool.tla`, `PromptQueue.tla`)
- Ensure your implementation satisfies the invariants defined in the spec
- Run TLC model checker if available: `tlc <ModuleName>.tla`

### 7. Lint & Test
- Run `bun run lint` to check for lint errors
- Run `bun run test` to run the test suite
- Fix any failures and iterate until both pass

### 8. Update Implementation Plan
- Update `IMPLEMENTATION_PLAN.md` to mark the completed task
- Add any notes about decisions made or follow-up work needed
- Update status from "pending" to "complete" with date

### 9. Commit & Push
- Commit all changes: `git commit -a -m "feat: <description>"`
- Push to origin: `git push`

## Guidelines

- Make small, incremental progress each iteration
- If stuck on a task for too long, move to a different one
- Prioritize correctness over speed
- Leave the codebase better than you found it

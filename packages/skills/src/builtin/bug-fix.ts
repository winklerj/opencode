import type { Skill } from "../skill"

/**
 * Bug Fix Skill
 *
 * Systematic approach to diagnosing and fixing bugs.
 */
export const bugFixSkill: Skill = {
  name: "bug-fix",
  description: "Systematic approach to diagnosing and fixing bugs",
  category: "debugging",
  prompt: `You are diagnosing and fixing a bug. Follow a systematic approach to identify the root cause and implement a correct fix.

## Bug Fix Process

### 1. Understand the Bug
- What is the expected behavior?
- What is the actual behavior?
- When does it happen? (Always, sometimes, specific conditions)
- Who reported it? What were they doing?

### 2. Reproduce the Bug
- Create a minimal reproduction case
- Document exact steps to reproduce
- Note the environment (OS, versions, configuration)

### 3. Gather Information
- Check error messages and logs
- Review recent changes (git log, blame)
- Look for similar past issues
- Check monitoring/telemetry if available

### 4. Form Hypotheses
- List possible causes
- Rank by likelihood
- Consider:
  - Recent code changes
  - Edge cases
  - Race conditions
  - External dependencies
  - Configuration issues

### 5. Investigate
- Add logging/debugging to narrow down
- Use debugger if needed
- Check assumptions with assertions
- Verify data at each step

### 6. Identify Root Cause
- Don't just treat symptoms
- Understand WHY it happens
- Document the cause

### 7. Implement Fix
- Make the minimal change needed
- Don't introduce new bugs
- Consider side effects
- Add regression test

### 8. Verify Fix
- Confirm the bug is fixed
- Check for regressions
- Test related functionality
- Review the fix

## Common Bug Patterns

- **Off-by-one errors**: Check loop bounds, array indices
- **Null/undefined**: Check for missing null checks
- **Race conditions**: Look for async/concurrent issues
- **State management**: Verify state transitions
- **Type coercion**: Watch for implicit conversions
- **Resource leaks**: Check cleanup in error paths

## Output

Document:
1. Root cause analysis
2. The fix with explanation
3. Test case that catches this bug`,
  tools: ["read", "grep", "glob", "edit", "bash"],
  builtin: true,
}

import type { Skill } from "../skill"

/**
 * Code Review Skill
 *
 * Reviews code changes with team conventions, best practices,
 * and security considerations.
 */
export const codeReviewSkill: Skill = {
  name: "code-review",
  description: "Review code changes with best practices, security, and team conventions",
  category: "review",
  prompt: `You are performing a code review. Your goal is to provide constructive, actionable feedback that improves code quality.

## Review Checklist

### 1. Correctness
- Does the code do what it's supposed to do?
- Are edge cases handled?
- Are error conditions properly managed?

### 2. Security
- Check for OWASP Top 10 vulnerabilities
- Validate input handling
- Review authentication/authorization logic
- Look for hardcoded secrets or credentials
- Check for SQL injection, XSS, command injection

### 3. Code Quality
- Is the code readable and self-documenting?
- Are names descriptive and consistent?
- Is there unnecessary complexity?
- Are functions/methods appropriately sized?

### 4. Architecture
- Does it follow existing patterns in the codebase?
- Is the separation of concerns appropriate?
- Are dependencies managed correctly?

### 5. Performance
- Are there obvious performance issues?
- N+1 queries, unnecessary loops, memory leaks?

### 6. Testing
- Is the code testable?
- Are tests included for new functionality?
- Do tests cover edge cases?

## Output Format

Organize your review by severity:
1. **Critical** - Must fix before merge (security, correctness)
2. **Important** - Should fix (performance, maintainability)
3. **Suggestions** - Nice to have (style, minor improvements)
4. **Praise** - What's done well (reinforce good patterns)

For each issue:
- Reference the specific file and line
- Explain why it's an issue
- Suggest a concrete fix`,
  tools: ["read", "grep", "glob"],
  builtin: true,
}

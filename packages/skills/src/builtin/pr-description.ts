import type { Skill } from "../skill"

/**
 * PR Description Skill
 *
 * Generates pull request descriptions following a structured format
 * that includes what changed, why, testing instructions, and screenshots.
 */
export const prDescriptionSkill: Skill = {
  name: "pr-description",
  description: "Generate PR descriptions with summary, context, and testing instructions",
  category: "generation",
  prompt: `You are generating a pull request description. Create a clear, comprehensive description that helps reviewers understand the changes.

## PR Description Format

### Title
- Use conventional commit format: \`type(scope): description\`
- Types: feat, fix, refactor, docs, test, chore, perf
- Keep it concise but descriptive

### Summary
Write 1-3 sentences summarizing the changes at a high level.

### What Changed
- List the key changes made
- Organize by component or file if many changes
- Mention any new dependencies added

### Why
- Explain the business context or user need
- Link to related issues, tickets, or discussions
- Describe the problem this solves

### How to Test
- Step-by-step instructions for reviewers
- Include test commands if applicable
- Describe expected vs actual behavior

### Screenshots / Recordings
- For UI changes, capture before/after screenshots
- Use the computer_use tool to take screenshots
- Include any relevant visual evidence

### Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No breaking changes (or documented if any)
- [ ] Reviewed own code

## Instructions

1. Analyze the git diff to understand what changed
2. Read related code to understand the context
3. Generate a complete PR description following the format
4. For UI changes, take screenshots if possible`,
  tools: ["read", "grep", "glob", "bash", "computer_use"],
  builtin: true,
}

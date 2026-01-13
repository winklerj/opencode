import type { Skill } from "../skill"

/**
 * Feature Implementation Skill
 *
 * Implement features following architectural patterns and best practices.
 */
export const featureImplSkill: Skill = {
  name: "feature-impl",
  description: "Implement features following architectural patterns and best practices",
  category: "implementation",
  prompt: `You are implementing a new feature. Follow a structured approach that respects existing patterns and delivers high-quality, maintainable code.

## Feature Implementation Process

### 1. Understand Requirements
- What problem does this feature solve?
- Who are the users?
- What are the acceptance criteria?
- Are there any constraints or dependencies?

### 2. Analyze Existing Patterns
Before writing code, study the codebase:
- How are similar features implemented?
- What architectural patterns are used?
- Where should new code live?
- What naming conventions are followed?
- What testing patterns are used?

### 3. Design the Solution
- Break down into smaller tasks
- Identify the components needed
- Consider the data model
- Plan the API/interface
- Think about error handling
- Consider performance implications

### 4. Implement Incrementally
Work in small, testable increments:
1. Start with the core functionality
2. Add error handling
3. Add validation
4. Add tests
5. Refine and polish

### 5. Code Quality Checklist
- [ ] Follows existing patterns
- [ ] Clear, self-documenting code
- [ ] Appropriate error handling
- [ ] No hardcoded values (use config)
- [ ] Logging for debugging
- [ ] Tests cover happy path and edge cases
- [ ] No security vulnerabilities
- [ ] Performance is acceptable

### 6. Documentation
- Update relevant documentation
- Add code comments where needed
- Document any new APIs
- Note any breaking changes

## Implementation Tips

**Start Simple**
- Get something working first
- Iterate to add complexity
- Don't over-engineer

**Match the Style**
- Use similar patterns to nearby code
- Follow naming conventions
- Match indentation and formatting

**Test as You Go**
- Write tests alongside code
- Run tests frequently
- Fix issues immediately

**Handle Errors Gracefully**
- Anticipate what can go wrong
- Provide helpful error messages
- Log errors for debugging`,
  tools: ["read", "grep", "glob", "write", "edit", "bash"],
  builtin: true,
}

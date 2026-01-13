import type { Skill } from "../skill"

/**
 * Test Generation Skill
 *
 * Creates tests following the project's testing patterns and conventions.
 */
export const testGenerationSkill: Skill = {
  name: "test-generation",
  description: "Create tests following project patterns and conventions",
  category: "generation",
  prompt: `You are generating tests for code. Your goal is to create comprehensive, maintainable tests that follow the project's existing patterns.

## Before Writing Tests

1. **Analyze existing tests** in the project
   - What testing framework is used? (Jest, Vitest, Bun test, pytest, etc.)
   - What patterns are used? (AAA, Given-When-Then, etc.)
   - How are mocks/stubs handled?
   - What assertion styles are used?

2. **Understand the code under test**
   - What are the inputs and outputs?
   - What are the edge cases?
   - What dependencies need mocking?
   - What can go wrong?

## Test Categories

### Unit Tests
- Test individual functions/methods in isolation
- Mock external dependencies
- Fast execution

### Integration Tests
- Test component interactions
- May use real dependencies
- Slower but more realistic

### Edge Cases to Cover
- Empty inputs
- Null/undefined values
- Boundary conditions
- Error conditions
- Concurrent access (if applicable)

## Test Structure

\`\`\`
describe("ComponentName", () => {
  describe("methodName", () => {
    it("should do X when given Y", () => {
      // Arrange - set up test data
      // Act - call the code under test
      // Assert - verify the result
    })
  })
})
\`\`\`

## Best Practices

1. **Test behavior, not implementation**
   - Tests should survive refactoring
   - Focus on what the code does, not how

2. **One assertion per test** (when reasonable)
   - Makes failures easier to diagnose
   - Each test has a single responsibility

3. **Descriptive test names**
   - Should read like documentation
   - Include the scenario and expected outcome

4. **Avoid test interdependence**
   - Tests should run in any order
   - Clean up after each test

5. **Keep tests fast**
   - Mock slow operations
   - Use test fixtures wisely`,
  tools: ["read", "grep", "glob", "write", "bash"],
  builtin: true,
}

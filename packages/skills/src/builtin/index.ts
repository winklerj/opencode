import type { Skill } from "../skill"
import { codeReviewSkill } from "./code-review"
import { prDescriptionSkill } from "./pr-description"
import { testGenerationSkill } from "./test-generation"
import { bugFixSkill } from "./bug-fix"
import { featureImplSkill } from "./feature-impl"

/**
 * All built-in skills provided by the skills package.
 *
 * These skills encode common development workflows and best practices:
 * - code-review: Review code changes
 * - pr-description: Generate PR descriptions
 * - test-generation: Create tests
 * - bug-fix: Debug and fix issues
 * - feature-impl: Implement features
 */
export const builtinSkills: Skill[] = [
  codeReviewSkill,
  prDescriptionSkill,
  testGenerationSkill,
  bugFixSkill,
  featureImplSkill,
]

export { codeReviewSkill, prDescriptionSkill, testGenerationSkill, bugFixSkill, featureImplSkill }

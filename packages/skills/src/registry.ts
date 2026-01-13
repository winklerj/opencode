import { type Skill } from "./skill"

/**
 * SkillsRegistry manages the collection of available skills.
 *
 * It provides:
 * - Registration of built-in and custom skills
 * - Lookup by name or category
 * - Listing of all available skills
 *
 * Skills are added via register() and retrieved via get() or list().
 */
export class SkillsRegistry {
  private skills: Map<string, Skill> = new Map()

  /**
   * Register a skill in the registry.
   * If a skill with the same name exists, it will be overwritten.
   */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill)
  }

  /**
   * Register multiple skills at once.
   */
  registerAll(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill)
    }
  }

  /**
   * Get a skill by name.
   * Returns undefined if not found.
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  /**
   * Check if a skill exists in the registry.
   */
  has(name: string): boolean {
    return this.skills.has(name)
  }

  /**
   * Remove a skill from the registry.
   * Returns true if the skill was found and removed.
   */
  unregister(name: string): boolean {
    return this.skills.delete(name)
  }

  /**
   * List all registered skills.
   */
  list(): Skill[] {
    return Array.from(this.skills.values())
  }

  /**
   * List skills by category.
   */
  listByCategory(category: Skill["category"]): Skill[] {
    return this.list().filter((skill) => skill.category === category)
  }

  /**
   * List only built-in skills.
   */
  listBuiltin(): Skill[] {
    return this.list().filter((skill) => skill.builtin)
  }

  /**
   * List only custom (non-built-in) skills.
   */
  listCustom(): Skill[] {
    return this.list().filter((skill) => !skill.builtin)
  }

  /**
   * Get the count of registered skills.
   */
  count(): number {
    return this.skills.size
  }

  /**
   * Clear all registered skills.
   */
  clear(): void {
    this.skills.clear()
  }
}

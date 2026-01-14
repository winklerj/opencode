import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { ConfigMarkdown } from "../config/markdown"
import { PermissionNext } from "../permission/next"
import { Plugin } from "../plugin"

const parameters = z.object({
  name: z.string().describe("The skill identifier from available_skills (e.g., 'code-review' or 'category/helper')"),
})

export const SkillTool = Tool.define("skill", async (ctx) => {
  const skills = await Skill.all()

  // Filter skills by agent permissions if agent provided
  const agent = ctx?.agent
  const accessibleSkills = agent
    ? skills.filter((skill) => {
        const rule = PermissionNext.evaluate("skill", skill.name, agent.permission)
        return rule.action !== "deny"
      })
    : skills

  const description =
    accessibleSkills.length === 0
      ? "Load a skill to get detailed instructions for a specific task. No skills are currently available."
      : [
          "Load a skill to get detailed instructions for a specific task.",
          "Skills provide specialized knowledge and step-by-step guidance.",
          "Use this when a task matches an available skill's description.",
          "<available_skills>",
          ...accessibleSkills.flatMap((skill) => [
            `  <skill>`,
            `    <name>${skill.name}</name>`,
            `    <description>${skill.description}</description>`,
            `  </skill>`,
          ]),
          "</available_skills>",
        ].join(" ")

  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const skill = await Skill.get(params.name)

      if (!skill) {
        const available = await Skill.all().then((x) => Object.keys(x).join(", "))
        throw new Error(`Skill "${params.name}" not found. Available skills: ${available || "none"}`)
      }

      await ctx.ask({
        permission: "skill",
        patterns: [params.name],
        always: [params.name],
        metadata: {},
      })

      // Trigger skill.invoke.before hook
      const beforeHookOutput = await Plugin.trigger(
        "skill.invoke.before",
        {
          skillName: params.name,
          sessionID: ctx.sessionID,
          context: undefined,
        },
        {
          modifiedPrompt: undefined,
          skip: false,
        },
      )

      // Load and parse skill content
      const parsed = await ConfigMarkdown.parse(skill.location)
      const dir = path.dirname(skill.location)

      // If plugin requests to skip, return early
      if (beforeHookOutput.skip) {
        return {
          title: `Skill "${params.name}" skipped by plugin`,
          output: "Skill execution was skipped by a plugin hook.",
          metadata: {
            name: params.name,
            dir,
          },
        }
      }

      // Use modified prompt if provided by plugin
      const content = beforeHookOutput.modifiedPrompt ?? parsed.content.trim()

      // Format output similar to plugin pattern
      const output = [`## Skill: ${skill.name}`, "", `**Base directory**: ${dir}`, "", content].join("\n")

      // Trigger skill.invoke.after hook
      await Plugin.trigger(
        "skill.invoke.after",
        {
          skillName: params.name,
          sessionID: ctx.sessionID,
          result: output,
        },
        {},
      )

      return {
        title: `Loaded skill: ${skill.name}`,
        output,
        metadata: {
          name: skill.name,
          dir,
        },
      }
    },
  }
})

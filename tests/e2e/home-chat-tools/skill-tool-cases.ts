import { expect } from '@stablyai/playwright-test'
import { expectError, expectOk, seedFile, workDir } from './tool-case-support'
import type { Target, ToolCases, ToolEnv } from './tool-case-types'

const SKILL_BODY = [
  '# Deploy',
  '',
  'Run `scripts/run me.sh`, then check "$HOME" was left alone — zażółć 🦭.'
].join('\n')
const SKILL_MD = `---\nname: seal-e2e-deploy\ndescription: Deploy the service safely (zażółć 🦭)\n---\n\n${SKILL_BODY}\n`
const AGENT_BODY = 'Review the diff for mistakes before anything ships.'
const AGENT_MD = `---\nname: seal-e2e-reviewer\ndescription: Reviews a change before it ships\n---\n\n${AGENT_BODY}\n`
const PROMPT_MD = 'Ship it: run the checks, then tag the release.\n'
const INSTRUCTIONS = 'Always be careful.\n'
const PROJECT_SKILL_MD =
  '---\nname: seal-e2e-project-skill\ndescription: Only this project has it\n---\n\nProject steps.\n'

type Seeded = { skillDir: string; project: string }

function seed(target: Target): Seeded {
  const skillDir = `${target.home}/.claude/skills/seal-e2e-deploy`
  const project = `${workDir(target)}/skill project`
  seedFile(target, `${skillDir}/SKILL.md`, SKILL_MD)
  seedFile(target, `${skillDir}/scripts/run me.sh`, '#!/bin/sh\necho deployed\n')
  seedFile(target, `${target.home}/.claude/agents/seal-e2e-reviewer.md`, AGENT_MD)
  seedFile(target, `${target.home}/.codex/prompts/seal-e2e-ship.md`, PROMPT_MD)
  seedFile(target, `${target.home}/.codex/AGENTS.md`, INSTRUCTIONS)
  seedFile(target, `${project}/.claude/skills/in-project/SKILL.md`, PROJECT_SKILL_MD)
  seedFile(target, `${project}/AGENTS.md`, 'Project rules.\n')
  return { skillDir, project }
}

async function listSkills(env: ToolEnv, target: Target): Promise<void> {
  const { skillDir, project } = seed(target)
  const { outcomes } = await env.call([
    { name: 'list_skills', args: { machine: target.machine } },
    { name: 'list_skills', args: { machine: target.machine, project_path: project } }
  ])
  const home = expectOk(outcomes[0])
  expect(home.startsWith(`On ${target.label}:\n`)).toBe(true)
  expect(home).toContain(
    `- seal-e2e-deploy: Deploy the service safely (zażółć 🦭)\n  ${skillDir}/SKILL.md`
  )
  expect(home).toContain(
    `- seal-e2e-reviewer: Reviews a change before it ships\n  ${target.home}/.claude/agents/seal-e2e-reviewer.md`
  )
  expect(home).toContain(`\n  ${target.home}/.codex/prompts/seal-e2e-ship.md`)
  expect(home).toContain(`- ${target.home}/.codex/AGENTS.md (19 bytes)`)
  expect(home).not.toContain('seal-e2e-project-skill')

  const withProject = expectOk(outcomes[1])
  expect(withProject).toContain(
    `- seal-e2e-project-skill: Only this project has it\n  ${project}/.claude/skills/in-project/SKILL.md`
  )
  expect(withProject).toContain(`- ${project}/AGENTS.md (15 bytes)`)
}

async function loadSkill(env: ToolEnv, target: Target): Promise<void> {
  const { skillDir } = seed(target)
  // On this computer the model leaves the machine out, as the tool's description tells it to.
  const where = target.key === 'local' ? {} : { machine: target.machine }
  const { outcomes } = await env.call([
    { name: 'load_skill', args: { name: 'seal-e2e-deploy', ...where } },
    { name: 'load_skill', args: { name: 'seal-e2e-reviewer', ...where } },
    { name: 'load_skill', args: { name: 'seal-e2e-missing', ...where } }
  ])
  const skill = expectOk(outcomes[0])
  expect(skill.startsWith('Skill "seal-e2e-deploy" from ')).toBe(true)
  expect(skill).toContain(SKILL_BODY)
  expect(skill).toContain(
    `Files in the skill folder (read them with read_file on machine "${target.id}"):\n- ${skillDir}/scripts/run me.sh`
  )
  const agent = expectOk(outcomes[1])
  expect(agent.startsWith('Skill "seal-e2e-reviewer" from ')).toBe(true)
  expect(agent).toContain(AGENT_BODY)
  expect(expectError(outcomes[2])).toContain('No skill named "seal-e2e-missing"')
}

export const SKILL_TOOL_CASES: ToolCases = {
  list_skills: { scope: 'each-machine', run: listSkills },
  load_skill: { scope: 'each-machine', run: loadSkill }
}

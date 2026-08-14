'use server'

import { revalidatePath } from 'next/cache'
import { serializeSkill } from '@/server/skills/frontmatter'
import { resolveSkillFile, scopeRoots } from '@/server/skills/paths'
import { readSkill } from '@/server/skills/scan'
import { getTemplate } from '@/server/skills/templates'
import type { SkillFrontmatter } from '@/server/skills/types'
import { validateFrontmatter } from '@/server/skills/validate'
import { skillExists, trashSkill, writeSkill } from '@/server/skills/write'

/**
 * Server actions are the ONLY path the browser has to the filesystem. Each one
 * re-validates its input, resolves paths through the safety layer, and is the
 * place where "writable scope" is enforced. Third-party installers are never
 * executed here — the Install center only ever surfaces copyable commands.
 */

export type Writable = 'project' | 'personal'

export interface ActionResult {
  ok: boolean
  error?: string
  message?: string
  path?: string
}

function writableRoot(projectDir: string, scope: Writable) {
  const root = scopeRoots(projectDir).find((r) => r.scope === scope)
  if (!root) throw new Error(`Unknown writable scope: ${scope}`)
  return root
}

export interface CreateSkillInput {
  scope: Writable
  frontmatter: SkillFrontmatter
  body: string
  overwrite: boolean
}

/** Creates or replaces a skill from structured frontmatter + body. */
export async function createSkillAction(input: CreateSkillInput): Promise<ActionResult> {
  const projectDir = process.cwd()
  const slug = typeof input.frontmatter.name === 'string' ? input.frontmatter.name : ''
  const { status, issues } = validateFrontmatter(input.frontmatter, slug)
  if (status === 'invalid') {
    return {
      ok: false,
      error: issues
        .filter((i) => i.level === 'error')
        .map((i) => i.message)
        .join(' '),
    }
  }
  try {
    const root = writableRoot(projectDir, input.scope)
    const contents = serializeSkill(input.frontmatter, input.body)
    const res = await writeSkill(root, slug, contents, input.overwrite)
    revalidatePath('/studio')
    return {
      ok: true,
      path: res.path,
      message: res.created ? 'Skill created.' : 'Skill overwritten.',
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Write failed.' }
  }
}

/** Saves raw SKILL.md content over an existing writable skill. */
export async function saveSkillAction(input: {
  scope: Writable
  slug: string
  raw: string
}): Promise<ActionResult> {
  const projectDir = process.cwd()
  try {
    const root = writableRoot(projectDir, input.scope)
    if (!(await skillExists(root.root, input.slug))) {
      return { ok: false, error: 'Skill no longer exists on disk.' }
    }
    const res = await writeSkill(root, input.slug, input.raw, true)
    revalidatePath('/studio')
    return { ok: true, path: res.path, message: 'Saved.' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Save failed.' }
  }
}

/** Recoverable delete: moves the skill directory into the scope's .trash. */
export async function deleteSkillAction(input: {
  scope: Writable
  slug: string
}): Promise<ActionResult> {
  const projectDir = process.cwd()
  try {
    const root = writableRoot(projectDir, input.scope)
    const dest = await trashSkill(root.root, input.slug)
    revalidatePath('/studio')
    return { ok: true, path: dest, message: 'Moved to .trash (recoverable).' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Delete failed.' }
  }
}

/** Duplicates an existing skill into a new slug in the same or another scope. */
export async function duplicateSkillAction(input: {
  fromScope: Writable
  fromSlug: string
  toScope: Writable
  newName: string
  overwrite: boolean
}): Promise<ActionResult> {
  const projectDir = process.cwd()
  try {
    const fromRoot = writableRoot(projectDir, input.fromScope)
    const source = await readSkill(
      resolveSkillFile(fromRoot.root, input.fromSlug),
      input.fromScope,
      fromRoot.root,
      false,
    )
    const fm: SkillFrontmatter = { ...source.frontmatter, name: input.newName }
    return await createSkillAction({
      scope: input.toScope,
      frontmatter: fm,
      body: source.body,
      overwrite: input.overwrite,
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Duplicate failed.' }
  }
}

/** Installs a curated template into a writable scope. */
export async function installTemplateAction(input: {
  templateSlug: string
  scope: Writable
  overwrite: boolean
}): Promise<ActionResult> {
  const template = getTemplate(input.templateSlug)
  if (!template) return { ok: false, error: 'Unknown template.' }
  return await createSkillAction({
    scope: input.scope,
    frontmatter: template.frontmatter,
    body: template.body,
    overwrite: input.overwrite,
  })
}

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveSkillDir, resolveSkillFile, type ScopeRoot } from './paths'

/**
 * Safe, atomic filesystem writes for the studio.
 *
 * - Writes go to a temp file in the same directory, then rename (atomic on the
 *   same volume) so a crash never leaves a half-written SKILL.md.
 * - Every path is resolved through `resolveSkillDir`, so a write cannot escape
 *   the chosen scope root.
 * - Deletes are recoverable: the skill directory is moved into a `.trash` folder
 *   under the scope root rather than removed.
 */

export class WriteError extends Error {}

async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.SKILL.md.${process.pid}.${Date.now()}.tmp`)
  await fs.writeFile(tmp, contents, 'utf8')
  try {
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

export interface WriteResult {
  path: string
  created: boolean
}

/** Whether a skill already exists at `slug` under `root`. */
export async function skillExists(root: string, slug: string): Promise<boolean> {
  try {
    await fs.access(resolveSkillFile(root, slug))
    return true
  } catch {
    return false
  }
}

/**
 * Writes SKILL.md for `slug` under `root`. Refuses to overwrite unless
 * `overwrite` is explicitly true (the UI gates this behind a confirmation).
 */
export async function writeSkill(
  root: ScopeRoot | string,
  slug: string,
  contents: string,
  overwrite: boolean,
): Promise<WriteResult> {
  const rootPath = typeof root === 'string' ? root : root.root
  if (typeof root !== 'string' && !root.writable) {
    throw new WriteError(`Scope "${root.scope}" is read-only.`)
  }
  const file = resolveSkillFile(rootPath, slug) // throws on traversal
  const existed = await skillExists(rootPath, slug)
  if (existed && !overwrite) {
    throw new WriteError(`Skill "${slug}" already exists. Confirm overwrite to replace it.`)
  }
  await writeFileAtomic(file, contents)
  return { path: file, created: !existed }
}

/** Moves a skill directory into `<root>/.trash/<slug>-<timestamp>`. Recoverable. */
export async function trashSkill(root: string, slug: string): Promise<string> {
  const dir = resolveSkillDir(root, slug) // throws on traversal
  const trashRoot = path.join(path.resolve(root), '.trash')
  await fs.mkdir(trashRoot, { recursive: true })
  const dest = path.join(trashRoot, `${slug}-${Date.now()}`)
  await fs.rename(dir, dest)
  return dest
}

/**
 * Merges a JSON settings object with an update, preserving any keys the studio
 * does not know about. Used when the studio must touch `.claude/settings.json`
 * so unrelated configuration is never dropped. Deep-merges plain objects; other
 * values (arrays, scalars) are replaced by the update.
 */
export function mergeSettingsPreserving(
  existing: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing }
  for (const [key, value] of Object.entries(update)) {
    const prev = out[key]
    if (
      prev &&
      typeof prev === 'object' &&
      !Array.isArray(prev) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = mergeSettingsPreserving(
        prev as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      out[key] = value
    }
  }
  return out
}

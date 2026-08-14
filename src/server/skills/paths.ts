import { homedir } from 'node:os'
import path from 'node:path'
import { isValidSlug } from './slug'
import type { SkillScope } from './types'

export { isValidSlug, slugify } from './slug'

/**
 * Scope-root resolution and path safety for the Skills Studio.
 *
 * Every write in the studio is confined to a scope root by `resolveSkillDir`,
 * which rejects traversal (`..`), absolute paths, and separators inside a slug.
 * This is the single choke point that keeps a malicious or fat-fingered name
 * from escaping `.claude/skills`.
 */

export interface ScopeRoot {
  scope: SkillScope
  root: string
  /** Studio may create/edit skills here. Plugin/bundled are read-only. */
  writable: boolean
  label: string
}

/**
 * Resolves the roots the studio scans. `projectDir` is the repo root; the
 * personal root is `~/.claude/skills`. Plugin roots are every
 * `<plugin>/skills` directory found under `~/.claude/plugins`.
 */
export function scopeRoots(projectDir: string): ScopeRoot[] {
  const home = homedir()
  return [
    {
      scope: 'project',
      root: path.join(projectDir, '.claude', 'skills'),
      writable: true,
      label: 'Project (.claude/skills)',
    },
    {
      scope: 'personal',
      root: path.join(home, '.claude', 'skills'),
      writable: true,
      label: 'Personal (~/.claude/skills)',
    },
  ]
}

/** Root under which installed plugins live (their skills are read-only here). */
export function pluginsRoot(): string {
  return path.join(homedir(), '.claude', 'plugins')
}

export class PathSafetyError extends Error {}

/**
 * Resolves the directory for `slug` under `root`, guaranteeing the result stays
 * inside `root`. Throws PathSafetyError on any traversal attempt.
 */
export function resolveSkillDir(root: string, slug: string): string {
  if (!isValidSlug(slug)) {
    throw new PathSafetyError(`Unsafe or invalid skill slug: ${JSON.stringify(slug)}`)
  }
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, slug)
  const rel = path.relative(resolvedRoot, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathSafetyError(`Path escapes skill root: ${slug}`)
  }
  // A valid slug has no separators, so this is belt-and-braces.
  if (rel !== slug) {
    throw new PathSafetyError(`Resolved path does not match slug: ${rel}`)
  }
  return target
}

/** The SKILL.md file path for a slug under a root, path-checked. */
export function resolveSkillFile(root: string, slug: string): string {
  return path.join(resolveSkillDir(root, slug), 'SKILL.md')
}

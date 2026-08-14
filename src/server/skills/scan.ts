import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from './frontmatter'
import { pluginsRoot, scopeRoots } from './paths'
import { computePrecedence } from './precedence'
import type { ParsedSkill, SkillScope } from './types'
import { validateFrontmatter } from './validate'

/** chars→tokens: the usual ~4 chars/token rule of thumb. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4))
}

/** Builds a ParsedSkill from a SKILL.md path. Never throws; encodes failure. */
export async function readSkill(
  filePath: string,
  scope: SkillScope,
  root: string,
  readOnly: boolean,
): Promise<ParsedSkill> {
  const slug = path.basename(path.dirname(filePath))
  let raw = ''
  let modifiedAt: string | null = null
  try {
    raw = await fs.readFile(filePath, 'utf8')
    const stat = await fs.stat(filePath)
    modifiedAt = stat.mtime.toISOString()
  } catch {
    return {
      slug,
      scope,
      path: filePath,
      root,
      frontmatter: {},
      body: '',
      raw: '',
      modifiedAt: null,
      estimatedTokens: 0,
      readOnly,
      issues: [{ level: 'error', field: 'file', message: 'SKILL.md could not be read.' }],
      status: 'invalid',
      active: true,
    }
  }

  const { data } = parseFrontmatter(raw)
  const { body } = splitFrontmatter(raw)
  const { issues, status } = validateFrontmatter(data, slug)

  return {
    slug,
    scope,
    path: filePath,
    root,
    frontmatter: data,
    body,
    raw,
    modifiedAt,
    estimatedTokens: estimateTokens(raw),
    readOnly,
    issues,
    status,
    active: true,
  }
}

async function scanRoot(
  root: string,
  scope: SkillScope,
  readOnly: boolean,
): Promise<ParsedSkill[]> {
  let entries: string[] = []
  try {
    const dirents = await fs.readdir(root, { withFileTypes: true })
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return [] // Root does not exist — a normal, non-error condition.
  }
  const skills: ParsedSkill[] = []
  for (const name of entries) {
    const file = path.join(root, name, 'SKILL.md')
    try {
      await fs.access(file)
    } catch {
      continue // Directory without a SKILL.md is not a skill.
    }
    skills.push(await readSkill(file, scope, root, readOnly))
  }
  return skills
}

/** Discovers every plugin `skills/` directory under ~/.claude/plugins. */
async function scanPlugins(): Promise<ParsedSkill[]> {
  const base = pluginsRoot()
  const found: ParsedSkill[] = []
  // Walk a bounded depth: plugins/marketplaces/<mp>/plugins/<plugin>/skills
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6) return
    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const d of dirents) {
      if (!d.isDirectory()) continue
      const full = path.join(dir, d.name)
      if (d.name === 'skills') {
        found.push(...(await scanRoot(full, 'plugin', true)))
      } else {
        await walk(full, depth + 1)
      }
    }
  }
  await walk(base, 0)
  return found
}

export interface SkillInventory {
  skills: ParsedSkill[]
  conflicts: ReturnType<typeof computePrecedence>['conflicts']
  scopes: Array<{ scope: SkillScope; root: string; writable: boolean; label: string }>
}

/** Full inventory across project, personal, and plugin scopes. */
export async function scanAllSkills(projectDir: string): Promise<SkillInventory> {
  const roots = scopeRoots(projectDir)
  const collected: ParsedSkill[] = []
  for (const r of roots) {
    collected.push(...(await scanRoot(r.root, r.scope, !r.writable)))
  }
  collected.push(...(await scanPlugins()))

  const { skills, conflicts } = computePrecedence(collected)
  skills.sort((a, b) => a.slug.localeCompare(b.slug))
  return {
    skills,
    conflicts,
    scopes: roots.map((r) => ({
      scope: r.scope,
      root: r.root,
      writable: r.writable,
      label: r.label,
    })),
  }
}

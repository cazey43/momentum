import type { ParsedSkill, SkillConflict, SkillScope } from './types'

/**
 * Precedence and shadowing across scopes.
 *
 * PRECEDENCE MODEL (the studio's documented assumption): when the same slug is
 * defined in more than one scope, the more specific scope wins in this order:
 *
 *   project > personal > plugin > bundled
 *
 * This mirrors the general "closest scope wins" convention; it is surfaced in
 * the UI as the tool's model so the human can see exactly why one definition is
 * active. Conflicts are never resolved automatically — the studio only reports.
 */
export const PRECEDENCE: readonly SkillScope[] = ['project', 'personal', 'plugin', 'bundled']

function rank(scope: SkillScope): number {
  const i = PRECEDENCE.indexOf(scope)
  return i === -1 ? PRECEDENCE.length : i
}

/**
 * Marks each skill's `active`/`shadowedBy` fields in place-free fashion and
 * returns the list of conflicts. Input is not mutated; a new array is returned.
 */
export function computePrecedence(skills: ParsedSkill[]): {
  skills: ParsedSkill[]
  conflicts: SkillConflict[]
} {
  const bySlug = new Map<string, ParsedSkill[]>()
  for (const s of skills) {
    const list = bySlug.get(s.slug) ?? []
    list.push(s)
    bySlug.set(s.slug, list)
  }

  const result: ParsedSkill[] = []
  const conflicts: SkillConflict[] = []

  for (const [slug, group] of bySlug) {
    const ordered = [...group].sort((a, b) => rank(a.scope) - rank(b.scope))
    const winner = ordered[0]
    ordered.forEach((skill, index) => {
      const active = index === 0
      result.push({
        ...skill,
        active,
        shadowedBy: active ? undefined : winner?.scope,
        status: !active && skill.status === 'valid' ? 'conflict' : skill.status,
      })
    })
    if (ordered.length > 1 && winner) {
      conflicts.push({
        slug,
        definitions: ordered.map((s) => ({ scope: s.scope, path: s.path })),
        winner: winner.scope,
      })
    }
  }

  return { skills: result, conflicts }
}

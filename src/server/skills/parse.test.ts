import { describe, expect, it } from 'vitest'
import { parseFrontmatter, serializeSkill, splitFrontmatter } from './frontmatter'
import { isValidSlug, PathSafetyError, resolveSkillDir, slugify } from './paths'
import { computePrecedence } from './precedence'
import { SKILL_TEMPLATES } from './templates'
import type { ParsedSkill } from './types'
import { validateFrontmatter } from './validate'

const VALID = `---
name: my-skill
description: Use when the user asks to do the thing. Explains when to trigger.
allowed-tools: Read, Grep
disable-model-invocation: true
custom-field: keep me
---

# Body

Hello.
`

describe('frontmatter parsing', () => {
  it('parses scalars, lists, booleans, and preserves unknown fields', () => {
    const { data } = parseFrontmatter(VALID)
    expect(data.name).toBe('my-skill')
    expect(data['allowed-tools']).toEqual(['Read', 'Grep'])
    expect(data['disable-model-invocation']).toBe(true)
    expect(data['custom-field']).toBe('keep me')
  })

  it('returns present:false when there is no frontmatter', () => {
    expect(parseFrontmatter('# just a body').present).toBe(false)
  })

  it('splits the body out from the frontmatter', () => {
    expect(splitFrontmatter(VALID).body.trim()).toBe('# Body\n\nHello.')
  })

  it('round-trips unknown fields through serialize', () => {
    const { data } = parseFrontmatter(VALID)
    const out = serializeSkill(data, '# Body\n\nHello.')
    const reparsed = parseFrontmatter(out).data
    expect(reparsed['custom-field']).toBe('keep me')
    expect(reparsed['allowed-tools']).toEqual(['Read', 'Grep'])
    expect(reparsed['disable-model-invocation']).toBe(true)
  })

  it('quotes values that would otherwise break YAML', () => {
    const out = serializeSkill({ description: 'a: b problem' }, 'body')
    expect(parseFrontmatter(out).data.description).toBe('a: b problem')
  })

  it('parses block-style lists', () => {
    const doc = '---\nallowed-tools:\n  - Read\n  - Bash\n---\nbody'
    expect(parseFrontmatter(doc).data['allowed-tools']).toEqual(['Read', 'Bash'])
  })
})

describe('slugify / isValidSlug', () => {
  it('normalizes names to safe slugs', () => {
    expect(slugify('My Cool Skill')).toBe('my-cool-skill')
    expect(slugify('  weird__name!!  ')).toBe('weird-name')
    expect(slugify('../etc/passwd')).toBe('etcpasswd')
  })

  it('accepts only already-normalized slugs', () => {
    expect(isValidSlug('good-slug')).toBe(true)
    expect(isValidSlug('Bad Slug')).toBe(false)
    expect(isValidSlug('')).toBe(false)
    expect(isValidSlug('a'.repeat(65))).toBe(false)
  })
})

describe('resolveSkillDir path safety', () => {
  const root = '/tmp/skills-root'

  it('resolves a valid slug inside the root', () => {
    // path.resolve prepends a drive letter on Windows, so match the tail.
    expect(resolveSkillDir(root, 'my-skill').replace(/\\/g, '/')).toMatch(
      /\/tmp\/skills-root\/my-skill$/,
    )
  })

  it('rejects traversal, separators, and absolute paths', () => {
    expect(() => resolveSkillDir(root, '../escape')).toThrow(PathSafetyError)
    expect(() => resolveSkillDir(root, 'a/b')).toThrow(PathSafetyError)
    expect(() => resolveSkillDir(root, '..')).toThrow(PathSafetyError)
    expect(() => resolveSkillDir(root, '/etc/passwd')).toThrow(PathSafetyError)
  })
})

describe('validateFrontmatter', () => {
  it('passes a well-formed skill', () => {
    const { status } = validateFrontmatter(
      { name: 'my-skill', description: 'Use when the user asks to do the thing precisely.' },
      'my-skill',
    )
    expect(status).toBe('valid')
  })

  it('errors on a missing description', () => {
    const { status, issues } = validateFrontmatter({ name: 'my-skill' }, 'my-skill')
    expect(status).toBe('invalid')
    expect(issues.some((i) => i.field === 'description' && i.level === 'error')).toBe(true)
  })

  it('warns when name does not match the directory', () => {
    const { issues } = validateFrontmatter(
      { name: 'other', description: 'Use when something precise happens here.' },
      'my-skill',
    )
    expect(issues.some((i) => i.field === 'name' && i.level === 'warning')).toBe(true)
  })

  it('warns on broad tool grants', () => {
    const { issues } = validateFrontmatter(
      {
        name: 's',
        description: 'Use when the user asks. Detailed enough.',
        'allowed-tools': ['Bash'],
      },
      's',
    )
    expect(issues.some((i) => i.field === 'allowed-tools')).toBe(true)
  })

  it('errors when a skill can never be invoked', () => {
    const { status } = validateFrontmatter(
      {
        name: 's',
        description: 'Use when the user asks. Detailed enough.',
        'disable-model-invocation': true,
        'user-invocable': false,
      },
      's',
    )
    expect(status).toBe('invalid')
  })
})

function fakeSkill(slug: string, scope: ParsedSkill['scope']): ParsedSkill {
  return {
    slug,
    scope,
    path: `/${scope}/${slug}/SKILL.md`,
    root: `/${scope}`,
    frontmatter: { name: slug, description: 'x'.repeat(30) },
    body: '',
    raw: '',
    modifiedAt: null,
    estimatedTokens: 1,
    readOnly: scope === 'plugin' || scope === 'bundled',
    issues: [],
    status: 'valid',
    active: true,
  }
}

describe('computePrecedence', () => {
  it('project shadows personal shadows plugin', () => {
    const { skills, conflicts } = computePrecedence([
      fakeSkill('dupe', 'plugin'),
      fakeSkill('dupe', 'project'),
      fakeSkill('dupe', 'personal'),
      fakeSkill('unique', 'personal'),
    ])
    const active = skills.find((s) => s.slug === 'dupe' && s.active)
    expect(active?.scope).toBe('project')
    const shadowed = skills.filter((s) => s.slug === 'dupe' && !s.active)
    expect(shadowed).toHaveLength(2)
    expect(shadowed.every((s) => s.status === 'conflict')).toBe(true)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.winner).toBe('project')
  })

  it('leaves a unique skill active with no conflict', () => {
    const { skills, conflicts } = computePrecedence([fakeSkill('solo', 'personal')])
    expect(skills[0]?.active).toBe(true)
    expect(conflicts).toHaveLength(0)
  })
})

describe('curated templates', () => {
  it('all templates validate cleanly', () => {
    for (const t of SKILL_TEMPLATES) {
      const { status, issues } = validateFrontmatter(t.frontmatter, t.slug)
      expect(status, `${t.slug}: ${JSON.stringify(issues)}`).not.toBe('invalid')
    }
  })

  it('ships the five core skills with non-colliding names', () => {
    const core = SKILL_TEMPLATES.filter((t) => t.category === 'core').map((t) => t.slug)
    expect(core).toEqual([
      'systematic-debugging',
      'socratic-design',
      'tdd-enforcer',
      'commit-guardian',
      'frontend-design',
    ])
  })

  it('makes commit-guardian manual-only', () => {
    const cg = SKILL_TEMPLATES.find((t) => t.slug === 'commit-guardian')
    expect(cg?.frontmatter['disable-model-invocation']).toBe(true)
  })
})

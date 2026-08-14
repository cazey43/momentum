import type { SkillFrontmatter } from './types'

/**
 * A deliberately small YAML-frontmatter reader/writer for SKILL.md files.
 *
 * SKILL.md frontmatter is a flat map of scalars, plus one occasional list
 * (`allowed-tools`). We do NOT pull in a full YAML dependency: the surface is
 * tiny, and a focused parser lets us guarantee the one property that matters
 * most for an editor — unknown keys survive a read/write round-trip verbatim.
 *
 * Supported value shapes:
 *   key: value                       → string
 *   key: "quoted value"              → string (quotes stripped)
 *   key: true | false                → boolean
 *   key: [a, b, c]                   → string[]
 *   key: a, b, c                     → string[] (only for known list fields)
 *   key:                             → block list on following `- ` lines
 *     - a
 *     - b
 */

const BOOLEAN_FIELDS = new Set(['disable-model-invocation', 'user-invocable'])
const LIST_FIELDS = new Set(['allowed-tools'])

export interface SplitDocument {
  /** Raw text between the two `---` fences, or null if there is no frontmatter. */
  frontmatterText: string | null
  body: string
}

/** Splits a document into its frontmatter block and body without parsing YAML. */
export function splitFrontmatter(raw: string): SplitDocument {
  // Normalize newlines for parsing; callers keep the original for raw display.
  const text = raw.replace(/\r\n/g, '\n')
  if (!text.startsWith('---\n') && text !== '---') {
    return { frontmatterText: null, body: raw }
  }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { frontmatterText: null, body: raw }
  const frontmatterText = text.slice(4, end + 1).replace(/\n$/, '')
  // Body starts after the closing fence line.
  const afterFence = text.indexOf('\n', end + 1)
  const body = afterFence === -1 ? '' : text.slice(afterFence + 1)
  return { frontmatterText, body }
}

function stripQuotes(value: string): string {
  const v = value.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1)
  }
  return v
}

function parseScalar(key: string, rawValue: string): string | boolean | string[] {
  const value = rawValue.trim()
  if (BOOLEAN_FIELDS.has(key) && (value === 'true' || value === 'false')) {
    return value === 'true'
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((s) => stripQuotes(s))
      .filter((s) => s.length > 0)
  }
  if (LIST_FIELDS.has(key) && value.includes(',')) {
    return value
      .split(',')
      .map((s) => stripQuotes(s))
      .filter((s) => s.length > 0)
  }
  return stripQuotes(value)
}

export interface ParsedFrontmatter {
  data: SkillFrontmatter
  /** True when a `---` block was present (even if empty). */
  present: boolean
}

/** Parses a frontmatter block into a typed map, preserving unknown keys. */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const { frontmatterText } = splitFrontmatter(raw)
  if (frontmatterText === null) return { data: {}, present: false }

  const data: SkillFrontmatter = {}
  const lines = frontmatterText.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line?.trim() || line.trim().startsWith('#')) continue
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1] as string
    const rest = match[2] ?? ''

    if (rest.trim() === '') {
      // Possible block list on following `- ` lines.
      const items: string[] = []
      let j = i + 1
      while (j < lines.length && /^\s*-\s+/.test(lines[j] ?? '')) {
        items.push(stripQuotes((lines[j] as string).replace(/^\s*-\s+/, '')))
        j++
      }
      if (items.length > 0) {
        data[key] = items
        i = j - 1
      } else {
        data[key] = ''
      }
      continue
    }
    data[key] = parseScalar(key, rest)
  }
  return { data, present: true }
}

function serializeValue(value: string | boolean | string[]): string {
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.join(', ')}]`
  // Quote values containing a colon+space or leading special chars to stay safe.
  if (/:\s/.test(value) || /^[[{&*!|>%@`"'#-]/.test(value)) {
    return JSON.stringify(value)
  }
  return value
}

/**
 * Serializes frontmatter + body back into a SKILL.md string.
 *
 * Field order: known fields first in a stable order, then any preserved
 * unknown fields in insertion order. Trailing newline is normalized.
 */
export function serializeSkill(frontmatter: SkillFrontmatter, body: string): string {
  const KNOWN_ORDER = [
    'name',
    'description',
    'argument-hint',
    'user-invocable',
    'disable-model-invocation',
    'allowed-tools',
    'context',
  ]
  const keys = [
    ...KNOWN_ORDER.filter((k) => frontmatter[k] !== undefined),
    ...Object.keys(frontmatter).filter(
      (k) => !KNOWN_ORDER.includes(k) && frontmatter[k] !== undefined,
    ),
  ]
  const fmLines = keys.map(
    (k) => `${k}: ${serializeValue(frontmatter[k] as string | boolean | string[])}`,
  )
  const trimmedBody = body.replace(/^\n+/, '').replace(/\s+$/, '')
  return `---\n${fmLines.join('\n')}\n---\n\n${trimmedBody}\n`
}

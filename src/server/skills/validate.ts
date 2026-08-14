import { isValidSlug, slugify } from './slug'
import type { SkillFrontmatter, SkillStatus, ValidationIssue } from './types'

/**
 * Skill validation. Errors make a skill Invalid; warnings make it a Warning.
 * The rules encode Claude Code conventions (a precise description drives model
 * invocation) and least-privilege hygiene, without inventing hard requirements
 * the tool cannot actually enforce.
 */

/** Tools that grant broad or destructive power; flagged for a second look. */
const BROAD_TOOLS = new Set(['Bash', 'Write', 'Edit', 'NotebookEdit'])

const TRIGGER_HINT_WORDS = ['use when', 'when the user', 'when asked', 'use this', 'for ']

export function validateFrontmatter(
  fm: SkillFrontmatter,
  slug: string,
): { issues: ValidationIssue[]; status: SkillStatus } {
  const issues: ValidationIssue[] = []

  // name
  const name = typeof fm.name === 'string' ? fm.name : ''
  if (!name) {
    issues.push({ level: 'error', field: 'name', message: 'Missing required field: name.' })
  } else if (!isValidSlug(name)) {
    issues.push({
      level: 'error',
      field: 'name',
      message: `name must be a slug (lowercase, hyphenated). Suggested: ${slugify(name) || 'skill-name'}.`,
    })
  } else if (slug && name !== slug) {
    issues.push({
      level: 'warning',
      field: 'name',
      message: `name "${name}" does not match its directory "${slug}"; the directory name is what Claude Code uses.`,
    })
  }

  // description
  const description = typeof fm.description === 'string' ? fm.description : ''
  if (!description) {
    issues.push({
      level: 'error',
      field: 'description',
      message:
        'Missing required field: description. Claude cannot decide when to invoke this skill without it.',
    })
  } else {
    if (description.length < 25) {
      issues.push({
        level: 'warning',
        field: 'description',
        message: 'description is very short; add when it should (and should not) trigger.',
      })
    }
    if (description.length > 1024) {
      issues.push({
        level: 'warning',
        field: 'description',
        message:
          'description is long; it is prepended to context and inflates the prompt footprint.',
      })
    }
    const lower = description.toLowerCase()
    if (!TRIGGER_HINT_WORDS.some((w) => lower.includes(w))) {
      issues.push({
        level: 'warning',
        field: 'description',
        message:
          'description has no trigger cue (e.g. "Use when…"); model invocation may be unreliable.',
      })
    }
  }

  // allowed-tools (least privilege)
  const tools = Array.isArray(fm['allowed-tools']) ? fm['allowed-tools'] : []
  if (tools.length === 0 && fm['allowed-tools'] !== undefined) {
    issues.push({
      level: 'warning',
      field: 'allowed-tools',
      message: 'allowed-tools is present but empty; omit it to inherit, or list the minimum tools.',
    })
  }
  const broad = tools.filter((t) => BROAD_TOOLS.has(t.trim()))
  if (broad.length > 0) {
    issues.push({
      level: 'warning',
      field: 'allowed-tools',
      message: `Grants broad tools (${broad.join(', ')}). Confirm this skill truly needs write/exec access.`,
    })
  }

  // invocation flags coherence
  if (fm['disable-model-invocation'] === true && fm['user-invocable'] === false) {
    issues.push({
      level: 'error',
      field: 'disable-model-invocation',
      message: 'Skill is neither model- nor user-invocable; it can never run.',
    })
  }

  const hasError = issues.some((i) => i.level === 'error')
  const hasWarning = issues.some((i) => i.level === 'warning')
  return { issues, status: hasError ? 'invalid' : hasWarning ? 'warning' : 'valid' }
}

/**
 * Types for the Claude Code Skills Studio.
 *
 * A "skill" is a directory `<name>/SKILL.md` under a scope root. The studio
 * reads, validates, and writes these files. Everything here is plain data so
 * the parsing/validation/precedence logic stays pure and unit-testable,
 * independent of the filesystem and of React.
 */

/** Where a skill lives. Precedence is defined in `precedence.ts`. */
export type SkillScope = 'project' | 'personal' | 'plugin' | 'bundled'

export const SKILL_SCOPES: readonly SkillScope[] = [
  'project',
  'personal',
  'plugin',
  'bundled',
] as const

/** Frontmatter fields the studio understands. Unknown keys are preserved. */
export interface SkillFrontmatter {
  name?: string
  description?: string
  'argument-hint'?: string
  'disable-model-invocation'?: boolean
  'user-invocable'?: boolean
  'allowed-tools'?: string[]
  context?: string
  /** Any field the studio does not model, kept verbatim on re-serialize. */
  [key: string]: string | boolean | string[] | undefined
}

export type SkillStatus = 'valid' | 'warning' | 'conflict' | 'invalid'

export interface ValidationIssue {
  level: 'error' | 'warning'
  field: string
  message: string
}

/** A skill as read from disk, with derived metadata for the dashboard. */
export interface ParsedSkill {
  /** Directory name (the canonical slug used in the invocation command). */
  slug: string
  scope: SkillScope
  /** Absolute path to the SKILL.md file. */
  path: string
  /** Root the skill was discovered under. */
  root: string
  frontmatter: SkillFrontmatter
  /** Markdown body after the frontmatter block. */
  body: string
  /** Full raw file contents. */
  raw: string
  /** ISO timestamp of last modification, or null if unknown. */
  modifiedAt: string | null
  /** Rough prompt footprint estimate, in tokens (chars / 4). */
  estimatedTokens: number
  /** Read-only scopes (bundled/plugin) cannot be edited by the studio. */
  readOnly: boolean
  issues: ValidationIssue[]
  status: SkillStatus
  /** Slug of the skill that shadows this one, if any (set by precedence). */
  shadowedBy?: string
  /** True when this definition is the active one for its slug. */
  active: boolean
}

export interface SkillConflict {
  slug: string
  /** All definitions of this slug, in precedence order (winner first). */
  definitions: Array<{ scope: SkillScope; path: string }>
  winner: SkillScope
}

/** A curated, installable skill template. */
export interface SkillTemplate {
  slug: string
  title: string
  category: 'core' | 'optional'
  summary: string
  useCases: string[]
  frontmatter: SkillFrontmatter
  body: string
}

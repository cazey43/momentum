import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serializeSkill } from './frontmatter'
import { readSkill } from './scan'
import { mergeSettingsPreserving, skillExists, trashSkill, WriteError, writeSkill } from './write'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'skills-test-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const CONTENT = serializeSkill(
  { name: 'demo', description: 'Use when the user asks for the demo behavior precisely.' },
  '# Demo\n\nBody.',
)

describe('writeSkill', () => {
  it('creates a new skill atomically and reports created:true', async () => {
    const res = await writeSkill(root, 'demo', CONTENT, false)
    expect(res.created).toBe(true)
    expect(await skillExists(root, 'demo')).toBe(true)
    const onDisk = await fs.readFile(path.join(root, 'demo', 'SKILL.md'), 'utf8')
    expect(onDisk).toBe(CONTENT)
  })

  it('refuses to overwrite unless explicitly allowed', async () => {
    await writeSkill(root, 'demo', CONTENT, false)
    await expect(writeSkill(root, 'demo', CONTENT, false)).rejects.toBeInstanceOf(WriteError)
    const res = await writeSkill(root, 'demo', CONTENT, true)
    expect(res.created).toBe(false)
  })

  it('leaves no temp files behind after a write', async () => {
    await writeSkill(root, 'demo', CONTENT, false)
    const entries = await fs.readdir(path.join(root, 'demo'))
    expect(entries.filter((e) => e.includes('.tmp'))).toHaveLength(0)
    expect(entries).toContain('SKILL.md')
  })

  it('rejects a traversal slug before touching disk', async () => {
    await expect(writeSkill(root, '../evil', CONTENT, false)).rejects.toThrow()
    await expect(writeSkill(root, 'a/b', CONTENT, false)).rejects.toThrow()
  })
})

describe('trashSkill', () => {
  it('moves the skill into .trash rather than deleting it', async () => {
    await writeSkill(root, 'demo', CONTENT, false)
    const dest = await trashSkill(root, 'demo')
    expect(await skillExists(root, 'demo')).toBe(false)
    const trashed = await fs.readFile(path.join(dest, 'SKILL.md'), 'utf8')
    expect(trashed).toBe(CONTENT) // recoverable
  })
})

describe('readSkill', () => {
  it('reads, parses, and validates a skill on disk', async () => {
    await writeSkill(root, 'demo', CONTENT, false)
    const skill = await readSkill(path.join(root, 'demo', 'SKILL.md'), 'project', root, false)
    expect(skill.slug).toBe('demo')
    expect(skill.frontmatter.name).toBe('demo')
    expect(skill.status).toBe('valid')
    expect(skill.estimatedTokens).toBeGreaterThan(0)
    expect(skill.modifiedAt).not.toBeNull()
  })

  it('marks an unreadable/missing file invalid instead of throwing', async () => {
    const skill = await readSkill(path.join(root, 'ghost', 'SKILL.md'), 'project', root, false)
    expect(skill.status).toBe('invalid')
  })
})

describe('mergeSettingsPreserving', () => {
  it('deep-merges while keeping unknown keys', () => {
    const existing = {
      permissions: { allow: ['a'] },
      hooks: { Stop: [1] },
      unknownTopLevel: { keep: true },
    }
    const merged = mergeSettingsPreserving(existing, { permissions: { deny: ['b'] } })
    expect(merged.unknownTopLevel).toEqual({ keep: true })
    expect(merged.hooks).toEqual({ Stop: [1] })
    expect(merged.permissions).toEqual({ allow: ['a'], deny: ['b'] })
  })

  it('replaces arrays and scalars rather than concatenating', () => {
    const merged = mergeSettingsPreserving({ list: [1, 2], n: 1 }, { list: [3], n: 2 })
    expect(merged.list).toEqual([3])
    expect(merged.n).toBe(2)
  })
})

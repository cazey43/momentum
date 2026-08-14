'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseFrontmatter, serializeSkill } from '@/server/skills/frontmatter'
import { slugify } from '@/server/skills/slug'
import type {
  ParsedSkill,
  SkillConflict,
  SkillFrontmatter,
  SkillScope,
  SkillTemplate,
} from '@/server/skills/types'
import { validateFrontmatter } from '@/server/skills/validate'
import {
  createSkillAction,
  deleteSkillAction,
  duplicateSkillAction,
  installTemplateAction,
  saveSkillAction,
  type Writable,
} from './actions'

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function invocationCommand(slug: string): string {
  return `/${slug}`
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* clipboard may be unavailable; the value is still visible on screen */
  }
}

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const SCOPE_LABEL: Record<SkillScope, string> = {
  project: 'Project',
  personal: 'Personal',
  plugin: 'Plugin',
  bundled: 'Bundled',
}

const STATUS_STYLE: Record<string, string> = {
  valid: 'bg-done-soft text-done',
  warning: 'bg-accent-soft text-accent',
  conflict: 'bg-waiting-soft text-waiting',
  invalid: 'bg-urgent-soft text-urgent',
}

const CARD = 'rounded-card border border-line bg-surface'
const BTN = 'rounded-md px-3 py-1.5 text-sm font-medium transition-colors'
const BTN_PRIMARY = cx(BTN, 'bg-accent text-on-accent hover:bg-accent-hover')
const BTN_GHOST = cx(
  BTN,
  'border border-line text-ink-muted hover:bg-surface-sunken hover:text-ink',
)
const FIELD = 'w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink'
const MONO = 'font-mono text-xs'

type View = 'dashboard' | 'templates' | 'create' | 'conflicts' | 'install' | 'commands'

interface Props {
  skills: ParsedSkill[]
  conflicts: SkillConflict[]
  scopes: Array<{ scope: SkillScope; root: string; writable: boolean; label: string }>
  templates: SkillTemplate[]
  precedence: SkillScope[]
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function StudioApp({ skills, conflicts, scopes, templates, precedence }: Props) {
  const router = useRouter()
  const [view, setView] = useState<View>('dashboard')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Identity is the file path: it is unique even when two plugins define a
  // skill with the same slug (which scope:slug would collide on).
  const selected = useMemo(
    () => skills.find((s) => s.path === selectedKey) ?? null,
    [skills, selectedKey],
  )

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  const refresh = useCallback(() => router.refresh(), [router])

  // Command palette (Ctrl/Cmd-K)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
      if (e.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function go(v: View) {
    setEditing(false)
    setView(v)
  }

  return (
    <div className="mx-auto max-w-[100rem]">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Skills Studio</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Create, inspect, and organize Claude Code skills on this machine.{' '}
            <button type="button" onClick={() => setPaletteOpen(true)} className="underline">
              ⌘K
            </button>
          </p>
        </div>
        <button type="button" className={BTN_PRIMARY} onClick={() => go('create')}>
          New skill
        </button>
      </header>

      <div className="grid gap-5 lg:grid-cols-[12rem_minmax(0,1fr)_20rem]">
        {/* Region 1: navigation */}
        <nav
          aria-label="Studio sections"
          className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible"
        >
          {(
            [
              ['dashboard', 'Dashboard'],
              ['templates', 'Templates'],
              ['create', 'Create'],
              ['conflicts', `Conflicts${conflicts.length ? ` (${conflicts.length})` : ''}`],
              ['install', 'Install'],
              ['commands', 'Commands'],
            ] as Array<[View, string]>
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => go(v)}
              aria-current={view === v ? 'page' : undefined}
              className={cx(
                'shrink-0 rounded-md px-3 py-2 text-left text-sm transition-colors',
                view === v
                  ? 'bg-accent-soft font-medium text-ink'
                  : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Region 2: workspace. @container so inner grids respond to THIS
            column's width, not the viewport (the 3-region layout makes them
            very different). */}
        <div className="@container min-w-0">
          {editing && selected ? (
            <SkillEditor
              key={selectedKey}
              skill={selected}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false)
                notify('ok', 'Saved.')
                refresh()
              }}
              notify={notify}
            />
          ) : view === 'dashboard' ? (
            <Dashboard skills={skills} selectedKey={selectedKey} onSelect={setSelectedKey} />
          ) : view === 'templates' ? (
            <TemplateGallery
              templates={templates}
              installedSlugs={new Set(skills.map((s) => s.slug))}
              onInstalled={() => {
                notify('ok', 'Template installed.')
                refresh()
              }}
              onCustomize={() => setView('create')}
              notify={notify}
            />
          ) : view === 'create' ? (
            <CreateWizard
              existing={skills}
              onCreated={() => {
                notify('ok', 'Skill created.')
                setView('dashboard')
                refresh()
              }}
              notify={notify}
            />
          ) : view === 'conflicts' ? (
            <ConflictInspector conflicts={conflicts} precedence={precedence} />
          ) : view === 'install' ? (
            <InstallCenter notify={notify} />
          ) : (
            <CommandCenter skills={skills} scopes={scopes} />
          )}
        </div>

        {/* Region 3: contextual inspector */}
        <aside className="min-w-0">
          <Inspector
            skill={selected}
            onEdit={() => setEditing(true)}
            onDeleted={() => {
              setSelectedKey(null)
              notify('ok', 'Moved to .trash (recoverable).')
              refresh()
            }}
            onDuplicated={() => {
              notify('ok', 'Duplicated.')
              refresh()
            }}
            notify={notify}
          />
        </aside>
      </div>

      {toast ? (
        <div
          role="status"
          className={cx(
            'fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md px-4 py-2 text-sm shadow-lg',
            toast.kind === 'ok' ? 'bg-done-soft text-done' : 'bg-urgent-soft text-urgent',
          )}
        >
          {toast.text}
        </div>
      ) : null}

      {paletteOpen ? (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNavigate={(v) => {
            go(v)
            setPaletteOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function useFavorites() {
  const [favs, setFavs] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const raw = localStorage.getItem('studio.favorites')
      if (raw) setFavs(new Set(JSON.parse(raw) as string[]))
    } catch {
      /* ignore */
    }
  }, [])
  const toggle = useCallback((slug: string) => {
    setFavs((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      try {
        localStorage.setItem('studio.favorites', JSON.stringify([...next]))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])
  return { favs, toggle }
}

function Dashboard({
  skills,
  selectedKey,
  onSelect,
}: {
  skills: ParsedSkill[]
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const [query, setQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState<'all' | SkillScope>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ParsedSkill['status']>('all')
  const [sort, setSort] = useState<'name' | 'modified' | 'footprint'>('name')
  const [grid, setGrid] = useState(true)
  const [favOnly, setFavOnly] = useState(false)
  const { favs, toggle } = useFavorites()

  const filtered = useMemo(() => {
    let list = skills.filter((s) => {
      if (scopeFilter !== 'all' && s.scope !== scopeFilter) return false
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (favOnly && !favs.has(s.slug)) return false
      if (query) {
        const hay = `${s.slug} ${s.frontmatter.description ?? ''}`.toLowerCase()
        if (!hay.includes(query.toLowerCase())) return false
      }
      return true
    })
    list = [...list].sort((a, b) => {
      if (sort === 'name') return a.slug.localeCompare(b.slug)
      if (sort === 'footprint') return b.estimatedTokens - a.estimatedTokens
      return (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '')
    })
    return list
  }, [skills, scopeFilter, statusFilter, favOnly, favs, query, sort])

  const groups = useMemo(() => {
    const order: SkillScope[] = ['project', 'personal', 'plugin', 'bundled']
    return order
      .map((scope) => ({ scope, items: filtered.filter((s) => s.scope === scope) }))
      .filter((g) => g.items.length > 0)
  }, [filtered])

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search skills…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={cx(FIELD, 'max-w-xs')}
          aria-label="Search skills"
        />
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as 'all' | SkillScope)}
          className={cx(FIELD, 'w-auto')}
          aria-label="Filter by scope"
        >
          <option value="all">All scopes</option>
          <option value="project">Project</option>
          <option value="personal">Personal</option>
          <option value="plugin">Plugin</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | ParsedSkill['status'])}
          className={cx(FIELD, 'w-auto')}
          aria-label="Filter by status"
        >
          <option value="all">Any status</option>
          <option value="valid">Valid</option>
          <option value="warning">Warning</option>
          <option value="conflict">Conflict</option>
          <option value="invalid">Invalid</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as 'name' | 'modified' | 'footprint')}
          className={cx(FIELD, 'w-auto')}
          aria-label="Sort"
        >
          <option value="name">Sort: name</option>
          <option value="modified">Sort: modified</option>
          <option value="footprint">Sort: footprint</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />{' '}
          Favorites
        </label>
        <button type="button" className={BTN_GHOST} onClick={() => setGrid((g) => !g)}>
          {grid ? 'Compact' : 'Grid'}
        </button>
      </div>

      {skills.length === 0 ? (
        <EmptyState
          title="No skills found yet"
          body="Nothing is installed in the project or personal scopes. Create one, or install a curated template."
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" body="No skills match the current filters." />
      ) : (
        groups.map((group) => (
          <div key={group.scope} className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {SCOPE_LABEL[group.scope]} · {group.items.length}
            </h2>
            <div className={grid ? 'grid gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3' : 'space-y-2'}>
              {group.items.map((s) => {
                const k = s.path
                const isFav = favs.has(s.slug)
                return (
                  <div
                    key={k}
                    className={cx(
                      CARD,
                      'relative transition-[border-color,box-shadow] motion-reduce:transition-none hover:border-line-strong',
                      selectedKey === k && 'border-accent ring-1 ring-accent',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(k)}
                      aria-current={selectedKey === k ? 'true' : undefined}
                      aria-label={`Select ${s.slug}`}
                      className="block w-full rounded-card p-4 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span className="block truncate font-medium text-ink">{s.slug}</span>
                      <span className="mt-1 line-clamp-2 block text-xs text-ink-muted">
                        {s.frontmatter.description || (
                          <span className="italic">No description</span>
                        )}
                      </span>
                      <span className="mt-3 flex flex-wrap items-center gap-2">
                        <span
                          className={cx(
                            'rounded-full px-2 py-0.5 text-[0.7rem] font-medium',
                            STATUS_STYLE[s.status],
                          )}
                        >
                          {s.active ? s.status : `${s.status} · shadowed`}
                        </span>
                        <code
                          className={cx(
                            MONO,
                            'rounded bg-surface-sunken px-1.5 py-0.5 text-ink-muted',
                          )}
                        >
                          {invocationCommand(s.slug)}
                        </code>
                        <span className="text-[0.7rem] text-ink-faint">
                          ~{s.estimatedTokens} tok
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(s.slug)}
                      aria-pressed={isFav}
                      aria-label={isFav ? `Unfavorite ${s.slug}` : `Favorite ${s.slug}`}
                      className="absolute top-3 right-3 rounded p-1 text-sm text-ink-faint hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {isFav ? '★' : '☆'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function Inspector({
  skill,
  onEdit,
  onDeleted,
  onDuplicated,
  notify,
}: {
  skill: ParsedSkill | null
  onEdit: () => void
  onDeleted: () => void
  onDuplicated: () => void
  notify: (k: 'ok' | 'err', t: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dupName, setDupName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setConfirmDelete(false)
    setDupName('')
  }, [])

  if (!skill) {
    return (
      <div className={cx(CARD, 'p-4 text-sm text-ink-muted')}>
        <p className="font-medium text-ink">Inspector</p>
        <p className="mt-1">Select a skill to see its details, validation, and actions.</p>
      </div>
    )
  }

  const writable = skill.scope === 'project' || skill.scope === 'personal'

  return (
    <div className={cx(CARD, 'p-4')}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate font-semibold text-ink">{skill.slug}</h2>
        <span
          className={cx(
            'rounded-full px-2 py-0.5 text-[0.7rem] font-medium',
            STATUS_STYLE[skill.status],
          )}
        >
          {skill.status}
        </span>
      </div>
      <dl className="mt-3 space-y-2 text-xs">
        <Row label="Scope" value={SCOPE_LABEL[skill.scope]} />
        <Row label="Invocation" value={invocationCommand(skill.slug)} mono />
        <Row label="Path" value={skill.path} mono />
        <Row
          label="Modified"
          value={skill.modifiedAt ? new Date(skill.modifiedAt).toLocaleString() : 'unknown'}
        />
        <Row label="Footprint" value={`~${skill.estimatedTokens} tokens`} />
        <Row
          label="Active"
          value={skill.active ? 'yes' : `no — shadowed by ${skill.shadowedBy ?? '?'}`}
        />
      </dl>

      {skill.issues.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold text-ink">Validation</p>
          <ul className="mt-1 space-y-1">
            {skill.issues.map((i) => (
              <li
                key={`${i.field}-${i.message}`}
                className={cx(
                  'rounded px-2 py-1 text-[0.72rem]',
                  i.level === 'error' ? 'bg-urgent-soft text-urgent' : 'bg-accent-soft text-accent',
                )}
              >
                <span className="font-medium">{i.field}:</span> {i.message}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 rounded bg-done-soft px-2 py-1 text-[0.72rem] text-done">
          No validation issues.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {writable ? (
          <button type="button" className={BTN_PRIMARY} onClick={onEdit}>
            Edit
          </button>
        ) : (
          <span className="text-xs text-ink-faint">Read-only scope — inspect only.</span>
        )}
        <button
          type="button"
          className={BTN_GHOST}
          onClick={() => download(`${skill.slug}.SKILL.md`, skill.raw)}
        >
          Export
        </button>
        <button type="button" className={BTN_GHOST} onClick={() => copy(skill.raw)}>
          Copy
        </button>
      </div>

      {writable ? (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs font-semibold text-ink">Duplicate</p>
          <div className="mt-2 flex gap-2">
            <input
              value={dupName}
              onChange={(e) => setDupName(e.target.value)}
              placeholder="new-skill-name"
              className={cx(FIELD, MONO)}
            />
            <button
              type="button"
              className={BTN_GHOST}
              disabled={busy || !slugify(dupName)}
              onClick={async () => {
                setBusy(true)
                const res = await duplicateSkillAction({
                  fromScope: skill.scope as Writable,
                  fromSlug: skill.slug,
                  toScope: skill.scope as Writable,
                  newName: slugify(dupName),
                  overwrite: false,
                })
                setBusy(false)
                if (res.ok) onDuplicated()
                else notify('err', res.error ?? 'Failed.')
              }}
            >
              Duplicate
            </button>
          </div>

          <div className="mt-4">
            {confirmDelete ? (
              <div className="rounded-md bg-urgent-soft p-3">
                <p className="text-xs text-urgent">
                  Move <strong>{skill.slug}</strong> to <code>.trash</code>? Recoverable from disk.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className={cx(BTN, 'bg-urgent text-on-urgent')}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      const res = await deleteSkillAction({
                        scope: skill.scope as Writable,
                        slug: skill.slug,
                      })
                      setBusy(false)
                      if (res.ok) onDeleted()
                      else notify('err', res.error ?? 'Failed.')
                    }}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    className={BTN_GHOST}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={cx(BTN, 'text-urgent hover:bg-urgent-soft')}
                onClick={() => setConfirmDelete(true)}
              >
                Delete…
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-ink-faint">{label}</dt>
      <dd className={cx('min-w-0 break-words text-ink-muted', mono && MONO)}>{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skill editor (raw SKILL.md)
// ---------------------------------------------------------------------------

function SkillEditor({
  skill,
  onClose,
  onSaved,
  notify,
}: {
  skill: ParsedSkill
  onClose: () => void
  onSaved: () => void
  notify: (k: 'ok' | 'err', t: string) => void
}) {
  const [text, setText] = useState(skill.raw)
  const [busy, setBusy] = useState(false)
  const dirty = text !== skill.raw

  const validation = useMemo(() => {
    const { data } = parseFrontmatter(text)
    return validateFrontmatter(data, skill.slug)
  }, [text, skill.slug])

  const save = useCallback(async () => {
    setBusy(true)
    const res = await saveSkillAction({
      scope: skill.scope as Writable,
      slug: skill.slug,
      raw: text,
    })
    setBusy(false)
    if (res.ok) onSaved()
    else notify('err', res.error ?? 'Save failed.')
  }, [skill, text, onSaved, notify])

  // Ctrl/Cmd-S to save; warn on unload while dirty.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty && !busy) save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, busy, save])

  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  return (
    <section className={cx(CARD, 'p-4')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">
          Editing <code className={MONO}>{skill.slug}</code>
          {dirty ? <span className="ml-2 text-xs text-accent">● unsaved</span> : null}
        </h2>
        <div className="flex gap-2">
          <button type="button" className={BTN_PRIMARY} disabled={!dirty || busy} onClick={save}>
            {busy ? 'Saving…' : 'Save (⌘S)'}
          </button>
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() => {
              if (!dirty || confirm('Discard unsaved changes?')) onClose()
            }}
          >
            Close
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className={cx(
            'h-[28rem] w-full resize-y rounded-md border border-line bg-surface-sunken p-3',
            MONO,
            'text-ink',
          )}
          aria-label="SKILL.md source"
        />
        <div className="space-y-3">
          <ValidationPanel status={validation.status} issues={validation.issues} />
          <DiffPanel original={skill.raw} current={text} />
        </div>
      </div>
    </section>
  )
}

function ValidationPanel({
  status,
  issues,
}: {
  status: string
  issues: Array<{ level: string; field: string; message: string }>
}) {
  return (
    <div className={cx(CARD, 'p-3')}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink">Validation</p>
        <span
          className={cx('rounded-full px-2 py-0.5 text-[0.7rem] font-medium', STATUS_STYLE[status])}
        >
          {status}
        </span>
      </div>
      {issues.length === 0 ? (
        <p className="mt-2 text-[0.72rem] text-done">Frontmatter looks good.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {issues.map((i) => (
            <li
              key={`${i.field}-${i.message}`}
              className={cx(
                'rounded px-2 py-1 text-[0.72rem]',
                i.level === 'error' ? 'bg-urgent-soft text-urgent' : 'bg-accent-soft text-accent',
              )}
            >
              <span className="font-medium">{i.field}:</span> {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DiffPanel({ original, current }: { original: string; current: string }) {
  const changed = original !== current
  const lines = useMemo(() => {
    const o = original.split('\n')
    const c = current.split('\n')
    const max = Math.max(o.length, c.length)
    const rows: Array<{ kind: 'same' | 'add' | 'del'; text: string; id: number }> = []
    for (let i = 0; i < max; i++) {
      if (o[i] === c[i]) {
        if (o[i] !== undefined) rows.push({ kind: 'same', text: o[i] as string, id: rows.length })
      } else {
        if (o[i] !== undefined) rows.push({ kind: 'del', text: o[i] as string, id: rows.length })
        if (c[i] !== undefined) rows.push({ kind: 'add', text: c[i] as string, id: rows.length })
      }
    }
    return rows
  }, [original, current])

  return (
    <div className={cx(CARD, 'p-3')}>
      <p className="text-xs font-semibold text-ink">Diff vs saved</p>
      {!changed ? (
        <p className="mt-2 text-[0.72rem] text-ink-faint">No changes.</p>
      ) : (
        <pre className={cx('mt-2 max-h-48 overflow-auto rounded bg-surface-sunken p-2', MONO)}>
          {lines.map((l) => (
            <div
              key={l.id}
              className={cx(
                l.kind === 'add' && 'bg-done-soft text-done',
                l.kind === 'del' && 'bg-urgent-soft text-urgent line-through',
                l.kind === 'same' && 'text-ink-faint',
              )}
            >
              {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}
              {l.text || ' '}
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create wizard
// ---------------------------------------------------------------------------

function CreateWizard({
  existing,
  onCreated,
  notify,
}: {
  existing: ParsedSkill[]
  onCreated: () => void
  notify: (k: 'ok' | 'err', t: string) => void
}) {
  const [mode, setMode] = useState<'guided' | 'expert'>('guided')
  const [scope, setScope] = useState<Writable>('project')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [argHint, setArgHint] = useState('')
  const [tools, setTools] = useState('')
  const [manualOnly, setManualOnly] = useState(false)
  const [body, setBody] = useState('# New skill\n\nDescribe the workflow here.\n')
  const [busy, setBusy] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)

  const slug = slugify(name)
  const frontmatter: SkillFrontmatter = useMemo(() => {
    const fm: SkillFrontmatter = { name: slug, description }
    if (argHint.trim()) fm['argument-hint'] = argHint.trim()
    const toolList = tools
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (toolList.length) fm['allowed-tools'] = toolList
    if (manualOnly) fm['disable-model-invocation'] = true
    return fm
  }, [slug, description, argHint, tools, manualOnly])

  const preview = useMemo(() => serializeSkill(frontmatter, body), [frontmatter, body])
  const validation = useMemo(() => validateFrontmatter(frontmatter, slug), [frontmatter, slug])
  const collision = existing.find((s) => s.slug === slug && s.scope === scope)
  const shadow = existing.find((s) => s.slug === slug && s.scope !== scope)
  const destPath = `${scope === 'project' ? '.claude/skills' : '~/.claude/skills'}/${slug || '<name>'}/SKILL.md`

  async function submit() {
    if (!slug) return notify('err', 'Enter a name.')
    if (validation.status === 'invalid') return notify('err', 'Fix validation errors first.')
    if (collision && !confirmOverwrite) return setConfirmOverwrite(true)
    setBusy(true)
    const res = await createSkillAction({ scope, frontmatter, body, overwrite: Boolean(collision) })
    setBusy(false)
    if (res.ok) onCreated()
    else notify('err', res.error ?? 'Failed.')
  }

  return (
    <section className={cx(CARD, 'p-4')}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-ink">Create a skill</h2>
        <div className="flex gap-1 rounded-md border border-line p-0.5 text-sm">
          {(['guided', 'expert'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cx(
                'rounded px-3 py-1',
                mode === m ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted',
              )}
            >
              {m === 'guided' ? 'Guided' : 'Expert'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Labeled label="Name" hint={slug ? `slug: ${slug}` : 'lowercase, hyphenated'}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD}
              placeholder="my-skill"
            />
          </Labeled>
          <Labeled label="Description" hint="When it should and should not trigger">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={cx(FIELD, 'h-20 resize-y')}
              placeholder="Use when the user asks to…"
            />
          </Labeled>
          <Labeled label="Scope">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Writable)}
              className={FIELD}
            >
              <option value="project">Project (.claude/skills) — default</option>
              <option value="personal">Personal (~/.claude/skills) — explicit</option>
            </select>
          </Labeled>

          {mode === 'expert' ? (
            <>
              <Labeled label="argument-hint">
                <input
                  value={argHint}
                  onChange={(e) => setArgHint(e.target.value)}
                  className={FIELD}
                  placeholder="[file]"
                />
              </Labeled>
              <Labeled label="allowed-tools" hint="comma separated; least privilege">
                <input
                  value={tools}
                  onChange={(e) => setTools(e.target.value)}
                  className={cx(FIELD, MONO)}
                  placeholder="Read, Grep, Glob"
                />
              </Labeled>
            </>
          ) : null}

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={manualOnly}
              onChange={(e) => setManualOnly(e.target.checked)}
            />
            Manual invocation only (disable-model-invocation)
          </label>

          <Labeled
            label={
              mode === 'expert' ? 'Body (Markdown)' : 'Workflow / guardrails / output (Markdown)'
            }
          >
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
              className={cx(FIELD, MONO, 'h-40 resize-y')}
            />
          </Labeled>
        </div>

        <div className="space-y-3">
          <div className={cx(CARD, 'p-3')}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-ink">Live SKILL.md</p>
              <button type="button" className={BTN_GHOST} onClick={() => copy(preview)}>
                Copy
              </button>
            </div>
            <pre
              className={cx(
                'mt-2 max-h-56 overflow-auto rounded bg-surface-sunken p-2',
                MONO,
                'text-ink',
              )}
            >
              {preview}
            </pre>
          </div>
          <ValidationPanel status={validation.status} issues={validation.issues} />
          <div className={cx(CARD, 'p-3 text-xs')}>
            <p className="font-semibold text-ink">Destination</p>
            <code className={cx(MONO, 'mt-1 block break-all text-ink-muted')}>{destPath}</code>
            {collision ? (
              <p className="mt-2 text-urgent">
                A skill named “{slug}” already exists in this scope — saving overwrites it.
              </p>
            ) : null}
            {shadow ? (
              <p className="mt-2 text-waiting">
                Note: “{slug}” also exists in {shadow.scope} scope; precedence will apply.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={busy || !slug} onClick={submit}>
          {confirmOverwrite ? 'Confirm overwrite' : 'Create skill'}
        </button>
        {confirmOverwrite ? (
          <button type="button" className={BTN_GHOST} onClick={() => setConfirmOverwrite(false)}>
            Cancel
          </button>
        ) : null}
        <span className="text-xs text-ink-faint">
          Or start from a template in the Templates tab.
        </span>
      </div>
    </section>
  )
}

function Labeled({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the form control is passed in as children and nested inside this label, which is a valid association.
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink">{label}</span>
        {hint ? <span className="text-[0.7rem] text-ink-faint">{hint}</span> : null}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Template gallery
// ---------------------------------------------------------------------------

function TemplateGallery({
  templates,
  installedSlugs,
  onInstalled,
  onCustomize,
  notify,
}: {
  templates: SkillTemplate[]
  installedSlugs: Set<string>
  onInstalled: () => void
  onCustomize: () => void
  notify: (k: 'ok' | 'err', t: string) => void
}) {
  const [scope, setScope] = useState<Writable>('project')
  const [busy, setBusy] = useState<string | null>(null)
  const core = templates.filter((t) => t.category === 'core')
  const optional = templates.filter((t) => t.category === 'optional')

  async function install(t: SkillTemplate) {
    const overwrite = installedSlugs.has(t.slug)
      ? confirm(`“${t.slug}” already exists. Overwrite it?`)
      : false
    if (installedSlugs.has(t.slug) && !overwrite) return
    setBusy(t.slug)
    const res = await installTemplateAction({ templateSlug: t.slug, scope, overwrite })
    setBusy(null)
    if (res.ok) onInstalled()
    else notify('err', res.error ?? 'Install failed.')
  }

  function card(t: SkillTemplate) {
    const tools = Array.isArray(t.frontmatter['allowed-tools'])
      ? t.frontmatter['allowed-tools']
      : []
    const manual = t.frontmatter['disable-model-invocation'] === true
    return (
      <div key={t.slug} className={cx(CARD, 'flex flex-col p-4')}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium text-ink">{t.title}</h3>
          {installedSlugs.has(t.slug) ? (
            <span className="rounded-full bg-done-soft px-2 py-0.5 text-[0.7rem] text-done">
              installed
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-ink-muted">{t.summary}</p>
        <p className="mt-2 text-[0.72rem] text-ink-faint">Use for: {t.useCases.join(' · ')}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <code className={cx(MONO, 'rounded bg-surface-sunken px-1.5 py-0.5 text-ink-muted')}>
            {invocationCommand(t.slug)}
          </code>
          <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[0.7rem] text-ink-muted">
            {manual ? 'manual only' : 'auto + manual'}
          </span>
          {tools.map((tool) => (
            <span
              key={tool}
              className="rounded bg-surface-sunken px-1.5 py-0.5 text-[0.7rem] text-ink-muted"
            >
              {tool}
            </span>
          ))}
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-ink-muted">Workflow preview</summary>
          <pre
            className={cx(
              'mt-1 max-h-40 overflow-auto rounded bg-surface-sunken p-2',
              MONO,
              'text-ink-muted',
            )}
          >
            {t.body.slice(0, 600)}
          </pre>
        </details>
        <div className="mt-auto flex gap-2 pt-3">
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy === t.slug}
            onClick={() => install(t)}
          >
            {busy === t.slug ? 'Installing…' : 'Install'}
          </button>
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() => {
              copy(serializeSkill(t.frontmatter, t.body))
              onCustomize()
            }}
          >
            Customize
          </button>
        </div>
      </div>
    )
  }

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-ink-muted">Install to</span>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Writable)}
          className={cx(FIELD, 'w-auto')}
        >
          <option value="project">Project</option>
          <option value="personal">Personal</option>
        </select>
      </div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Core</h2>
      <div className="grid gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">{core.map(card)}</div>
      <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Optional
      </h2>
      <div className="grid gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">{optional.map(card)}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Conflict inspector
// ---------------------------------------------------------------------------

function ConflictInspector({
  conflicts,
  precedence,
}: {
  conflicts: SkillConflict[]
  precedence: SkillScope[]
}) {
  return (
    <section>
      <div className={cx(CARD, 'mb-4 p-4 text-sm')}>
        <p className="font-semibold text-ink">Precedence model</p>
        <p className="mt-1 text-ink-muted">
          When one slug is defined in several scopes, the winner is the most specific scope:{' '}
          <code className={MONO}>{precedence.join(' > ')}</code>. The studio only reports — it never
          resolves a conflict for you.
        </p>
      </div>
      {conflicts.length === 0 ? (
        <EmptyState title="No conflicts" body="Every skill name is unique across scopes." />
      ) : (
        <div className="space-y-3">
          {conflicts.map((c) => (
            <div key={c.slug} className={cx(CARD, 'p-4')}>
              <div className="flex items-center justify-between">
                <code className={cx(MONO, 'font-medium text-ink')}>{c.slug}</code>
                <span className="rounded-full bg-waiting-soft px-2 py-0.5 text-[0.7rem] text-waiting">
                  {c.definitions.length} definitions
                </span>
              </div>
              <ol className="mt-2 space-y-1">
                {c.definitions.map((d, i) => (
                  <li key={d.path} className="flex items-center gap-2 text-xs">
                    <span
                      className={cx(
                        'rounded px-1.5 py-0.5 font-medium',
                        i === 0 ? 'bg-done-soft text-done' : 'bg-surface-sunken text-ink-faint',
                      )}
                    >
                      {i === 0 ? 'ACTIVE' : 'shadowed'}
                    </span>
                    <span className="text-ink-muted">{SCOPE_LABEL[d.scope]}</span>
                    <code className={cx(MONO, 'truncate text-ink-faint')}>{d.path}</code>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-[0.72rem] text-ink-faint">
                Resolve safely by renaming one definition, or removing the one you do not want.
                Nothing is changed automatically.
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Install center (transparent, approval-gated; never auto-executes)
// ---------------------------------------------------------------------------

function InstallCenter({ notify }: { notify: (k: 'ok' | 'err', t: string) => void }) {
  const pathways: Array<{
    title: string
    trust: 'trusted' | 'review' | 'caution'
    body: string
    command?: string
  }> = [
    {
      title: 'Manual creation',
      trust: 'trusted',
      body: 'Author a skill in the Create tab. Writes only inside your chosen scope root.',
    },
    {
      title: 'Import a local skill directory',
      trust: 'review',
      body: 'Copy an existing skill folder into your project scope, then reload. Review its SKILL.md first.',
      command:
        'cp -r <path-to-skill> .claude/skills/ && echo "review .claude/skills/<skill>/SKILL.md"',
    },
    {
      title: 'Claude Code /plugin marketplace',
      trust: 'review',
      body: 'Browse and install plugins (which may bundle skills) from inside Claude Code.',
      command: '/plugin',
    },
    {
      title: 'claude plugin CLI',
      trust: 'review',
      body: 'Install a plugin from a marketplace by name.',
      command: 'claude plugin install <plugin>@<marketplace>',
    },
    {
      title: 'Third-party: npx skills add',
      trust: 'caution',
      body: 'Runs code from a remote repository. Verify the owner/repo and read the source before running. The studio will never run this for you.',
      command: 'npx skills add <owner>/<repo>',
    },
  ]

  const TRUST_STYLE = {
    trusted: 'bg-done-soft text-done',
    review: 'bg-accent-soft text-accent',
    caution: 'bg-urgent-soft text-urgent',
  } as const

  return (
    <section className="space-y-4">
      <div className={cx(CARD, 'p-4')}>
        <h2 className="font-semibold text-ink">Skill Creator (Anthropic)</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Official skill for authoring skills. Install it, then Claude Code will register its
          command — detect the actual command from <code className={MONO}>/help</code> rather than
          assuming a name.
        </p>
        <CommandLine
          command="/plugin install skill-creator@claude-plugins-official"
          onCopy={() => notify('ok', 'Command copied.')}
        />
      </div>

      <div className={cx(CARD, 'border-urgent/40 bg-urgent-soft/40 p-4')}>
        <p className="text-sm font-semibold text-urgent">
          Before running any third-party installer
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-muted">
          <li>Confirm the source and publisher (owner/repo), and a version or commit.</li>
          <li>Review the files, hooks, MCP/LSP servers, scripts, and tool permissions it adds.</li>
          <li>Read the exact command below — the studio only copies it; it never executes it.</li>
        </ul>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {pathways.map((p) => (
          <div key={p.title} className={cx(CARD, 'flex flex-col p-4')}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium text-ink">{p.title}</h3>
              <span
                className={cx(
                  'rounded-full px-2 py-0.5 text-[0.7rem] font-medium',
                  TRUST_STYLE[p.trust],
                )}
              >
                {p.trust}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-muted">{p.body}</p>
            {p.command ? (
              <CommandLine command={p.command} onCopy={() => notify('ok', 'Command copied.')} />
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function CommandLine({ command, onCopy }: { command: string; onCopy?: () => void }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <code
        className={cx(
          MONO,
          'min-w-0 flex-1 overflow-x-auto rounded bg-surface-sunken px-2 py-1.5 text-ink',
        )}
      >
        {command}
      </code>
      <button
        type="button"
        className={BTN_GHOST}
        onClick={() => {
          copy(command)
          onCopy?.()
        }}
      >
        Copy
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Command center
// ---------------------------------------------------------------------------

function CommandCenter({ skills, scopes }: { skills: ParsedSkill[]; scopes: Props['scopes'] }) {
  const commands: Array<{ label: string; command: string }> = [
    { label: 'Open the plugin marketplace', command: '/plugin' },
    {
      label: 'Install the Skill Creator',
      command: '/plugin install skill-creator@claude-plugins-official',
    },
    { label: 'List Claude Code help / commands', command: '/help' },
    {
      label: 'Project skills directory',
      command: scopes.find((s) => s.scope === 'project')?.root ?? '.claude/skills',
    },
    {
      label: 'Personal skills directory',
      command: scopes.find((s) => s.scope === 'personal')?.root ?? '~/.claude/skills',
    },
  ]
  return (
    <section className="space-y-4">
      <div className={cx(CARD, 'p-4')}>
        <h2 className="font-semibold text-ink">Common commands</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Copyable. The studio never runs these for you.
        </p>
        <div className="mt-3 space-y-2">
          {commands.map((c) => (
            <div key={c.label}>
              <p className="text-xs text-ink-muted">{c.label}</p>
              <CommandLine command={c.command} />
            </div>
          ))}
        </div>
      </div>
      <div className={cx(CARD, 'p-4')}>
        <h2 className="font-semibold text-ink">Invoke a skill</h2>
        {skills.filter((s) => s.active).length === 0 ? (
          <p className="mt-2 text-xs text-ink-faint">No active skills yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {skills
              .filter((s) => s.active)
              .map((s) => (
                <CommandLine key={s.path} command={invocationCommand(s.slug)} />
              ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Command palette + shared bits
// ---------------------------------------------------------------------------

function CommandPalette({
  onClose,
  onNavigate,
}: {
  onClose: () => void
  onNavigate: (v: View) => void
}) {
  const items: Array<[View, string]> = [
    ['dashboard', 'Go to Dashboard'],
    ['templates', 'Go to Templates'],
    ['create', 'Create a new skill'],
    ['conflicts', 'Inspect conflicts'],
    ['install', 'Installation center'],
    ['commands', 'Command center'],
  ]
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const filtered = items.filter(([, label]) => label.toLowerCase().includes(q.toLowerCase()))
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className={cx(CARD, 'relative w-full max-w-md p-2 shadow-xl')}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a command…"
          className={cx(FIELD, 'mb-2')}
          aria-label="Command palette input"
        />
        <ul>
          {filtered.map(([v, label]) => (
            <li key={v}>
              <button
                type="button"
                className="w-full rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface-sunken"
                onClick={() => onNavigate(v)}
              >
                {label}
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-faint">No matches</li>
          ) : null}
        </ul>
      </div>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className={cx(CARD, 'p-8 text-center')}>
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{body}</p>
    </div>
  )
}

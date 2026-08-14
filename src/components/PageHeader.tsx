interface PageHeaderProps {
  title: string
  blurb?: string
  children?: React.ReactNode
}

export function PageHeader({ title, blurb, children }: PageHeaderProps) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {blurb ? <p className="mt-1 text-ink-muted">{blurb}</p> : null}
      {children}
    </header>
  )
}

/**
 * Empty states are a product surface, not an error. Each one says plainly what
 * is absent and what the user could do, rather than showing a spinner forever
 * or inventing placeholder rows.
 */
export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface/50 p-6 text-center">
      <p className="text-sm text-ink-muted">{message}</p>
      {hint ? <p className="mt-1 text-sm text-ink-faint">{hint}</p> : null}
    </div>
  )
}

export function Section({
  title,
  count,
  tone = 'normal',
  children,
}: {
  title: string
  count: number
  tone?: 'normal' | 'urgent'
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <section className="mb-8">
      <h2
        className={`mb-3 text-sm font-semibold tracking-wide uppercase ${
          tone === 'urgent' ? 'text-urgent' : 'text-ink-muted'
        }`}
      >
        {title} <span className="font-normal text-ink-faint">({count})</span>
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

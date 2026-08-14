/**
 * Route-level loading skeleton. Shown while the server component scans the
 * filesystem for skills (project, personal, and plugin scopes). Mirrors the
 * three-region Studio layout so the transition to real content is calm.
 */
const NAV_KEYS = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']
const CARD_KEYS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']

export default function StudioLoading() {
  const shimmer = 'animate-pulse motion-reduce:animate-none rounded bg-surface-sunken'
  return (
    <div className="mx-auto max-w-[100rem]" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading skills…</span>
      <header className="mb-6">
        <div className={`${shimmer} h-6 w-40`} />
        <div className={`${shimmer} mt-2 h-4 w-72`} />
      </header>
      <div className="grid gap-5 lg:grid-cols-[12rem_minmax(0,1fr)_20rem]">
        <div className="hidden space-y-2 lg:block">
          {NAV_KEYS.map((key) => (
            <div key={key} className={`${shimmer} h-8 w-full`} />
          ))}
        </div>
        <div>
          <div className="mb-4 flex gap-2">
            <div className={`${shimmer} h-9 w-48`} />
            <div className={`${shimmer} h-9 w-28`} />
            <div className={`${shimmer} h-9 w-28`} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {CARD_KEYS.map((key) => (
              <div key={key} className="rounded-card border border-line bg-surface p-4">
                <div className={`${shimmer} h-4 w-32`} />
                <div className={`${shimmer} mt-2 h-3 w-full`} />
                <div className={`${shimmer} mt-1 h-3 w-3/4`} />
                <div className={`${shimmer} mt-3 h-5 w-40`} />
              </div>
            ))}
          </div>
        </div>
        <div className="hidden lg:block">
          <div className="rounded-card border border-line bg-surface p-4">
            <div className={`${shimmer} h-5 w-24`} />
            <div className={`${shimmer} mt-3 h-3 w-full`} />
            <div className={`${shimmer} mt-1 h-3 w-2/3`} />
          </div>
        </div>
      </div>
    </div>
  )
}

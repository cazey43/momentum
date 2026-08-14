'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { APP_NAME } from '@/config/branding'
import { NAV_AREAS } from '@/config/navigation'

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-2 md:h-dvh md:w-56 md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:px-3 md:py-5"
    >
      <div className="mb-0 hidden px-2 pb-4 md:block">
        <span className="text-base font-semibold tracking-tight text-ink">{APP_NAME}</span>
      </div>

      {NAV_AREAS.map((area) => {
        const active = isActive(pathname, area.href)
        return (
          <Link
            key={area.href}
            href={area.href}
            aria-current={active ? 'page' : undefined}
            title={area.blurb}
            className={[
              'shrink-0 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-accent-soft font-medium text-ink'
                : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
            ].join(' ')}
          >
            {area.label}
          </Link>
        )
      })}

      {/* Developer tools live below the eight primary areas so the product's
          nav spec (and its test) stays exactly eight items. */}
      <div className="hidden md:mt-auto md:block md:pt-4">
        <span className="px-3 text-[0.65rem] font-semibold uppercase tracking-wide text-ink-faint">
          Developer
        </span>
      </div>
      <Link
        href="/studio"
        aria-current={isActive(pathname, '/studio') ? 'page' : undefined}
        title="Create and manage Claude Code skills"
        className={[
          'shrink-0 rounded-md px-3 py-2 text-sm transition-colors',
          isActive(pathname, '/studio')
            ? 'bg-accent-soft font-medium text-ink'
            : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        ].join(' ')}
      >
        Skills Studio
      </Link>
    </nav>
  )
}

/**
 * The eight primary areas from the spec. Order matters: this is also the
 * reading order for screen readers and the tab order.
 */
export interface NavArea {
  href: string
  label: string
  /** Shown as the page heading and in the document title. */
  title: string
  /** One line explaining what lives here, used in empty states and tooltips. */
  blurb: string
}

export const NAV_AREAS: readonly NavArea[] = [
  {
    href: '/',
    label: 'Today',
    title: 'Today',
    blurb: 'What needs you now, and nothing that does not.',
  },
  {
    href: '/review',
    label: 'Review',
    title: 'Inbox & Review',
    blurb: 'Suggestions waiting on your judgment before anything happens.',
  },
  {
    href: '/tasks',
    label: 'Tasks',
    title: 'Tasks',
    blurb: 'Everything you have committed to, in one place.',
  },
  {
    href: '/waiting',
    label: 'Waiting For',
    title: 'Waiting For',
    blurb: 'People and answers you are waiting on.',
  },
  {
    href: '/loose-ends',
    label: 'Loose Ends',
    title: 'Loose Ends',
    blurb: 'Things that may have slipped. Each one shows its evidence.',
  },
  {
    href: '/drafts',
    label: 'Drafts',
    title: 'Drafts',
    blurb: 'Replies prepared for you. Nothing sends without your approval.',
  },
  {
    href: '/talk',
    label: 'Talk',
    title: 'Talk',
    blurb: 'Type or speak. Push-to-talk by default.',
  },
  {
    href: '/settings',
    label: 'Settings',
    title: 'Settings & Integrations',
    blurb: 'Reminders, quiet hours, connected accounts, privacy, and your data.',
  },
] as const

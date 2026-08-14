/**
 * Single source of truth for the product name.
 *
 * The spec asks for the name to be easy to change. Nothing else in the
 * codebase should hardcode "Momentum" — import from here instead.
 */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'Momentum'

export const APP_TAGLINE = 'Notices what matters, helps you act, then gets out of the way.'

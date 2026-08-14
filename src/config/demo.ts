/**
 * Demo mode identity.
 *
 * Demo data is never mixed silently with real data: every seeded row carries
 * `isDemo: true`, and the UI labels it. The spec is explicit that fake
 * functionality is worse than an empty state.
 */
export const DEMO_USER_ID = 'user_demo'
export const DEMO_USER_NAME = 'Casey'

export function isDemoMode(): boolean {
  return process.env.MOMENTUM_DEMO_MODE !== 'false'
}

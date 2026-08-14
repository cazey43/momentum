'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import type { ReminderLevel } from '@/core/domain/vocabulary'
import { REMINDER_LEVELS } from '@/core/domain/vocabulary'
import { systemClock } from '@/core/time/clock'
import { getDb } from '@/db/client'
import { auditEvents, userPreferences } from '@/db/schema'
import { disconnectAccount } from '@/server/integrations/disconnect'
import { runDailyBriefing, runNudgeRound } from '@/server/jobs'
import { getSession } from '@/server/session'

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/

function clampInt(value: FormDataEntryValue | null, min: number, max: number, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

/**
 * Saves reminder preferences.
 *
 * Every field is validated server-side rather than trusted from the form. The
 * browser is not the authority on what a valid quiet-hours window is.
 */
export async function saveReminderSettings(formData: FormData): Promise<void> {
  const { userId } = await getSession()
  const db = await getDb()

  const quietStart = String(formData.get('quietHoursStart') ?? '')
  const quietEnd = String(formData.get('quietHoursEnd') ?? '')
  const briefingTime = String(formData.get('briefingTime') ?? '')
  const intensity = String(formData.get('reminderIntensity') ?? '')

  const updates: Record<string, unknown> = {
    dailyNudgeBudget: clampInt(formData.get('dailyNudgeBudget'), 0, 10, 2),
    maxQuotesPerDay: clampInt(formData.get('maxQuotesPerDay'), 0, 3, 1),
    quotesEnabled: formData.get('quotesEnabled') === 'on',
    weekendBriefings: formData.get('weekendBriefings') === 'on',
    weekendReminders: formData.get('weekendReminders') === 'on',
    proactiveRemindersPaused: formData.get('proactiveRemindersPaused') === 'on',
    voiceEnabled: formData.get('voiceEnabled') === 'on',
    handsFreeEnabled: formData.get('handsFreeEnabled') === 'on',
    storeAudio: formData.get('storeAudio') === 'on',
    updatedAt: systemClock.now(),
  }

  if (HHMM.test(quietStart)) updates.quietHoursStart = quietStart
  if (HHMM.test(quietEnd)) updates.quietHoursEnd = quietEnd
  if (HHMM.test(briefingTime)) updates.briefingTime = briefingTime
  if ((REMINDER_LEVELS as readonly string[]).includes(intensity)) {
    updates.reminderIntensity = intensity as ReminderLevel
  }

  await db.update(userPreferences).set(updates).where(eq(userPreferences.userId, userId))

  await db.insert(auditEvents).values({
    id: `audit_prefs_${Date.now().toString(36)}`,
    userId,
    action: 'preferences_updated',
    resourceType: 'user_preferences',
    resourceId: userId,
    actor: 'user',
  })

  revalidatePath('/settings')
  revalidatePath('/')
}

/** The global kill switch, given its own action so it is one click. */
export async function toggleProactivePause(formData: FormData): Promise<void> {
  const { userId } = await getSession()
  const db = await getDb()
  const paused = formData.get('paused') === 'true'

  await db
    .update(userPreferences)
    .set({ proactiveRemindersPaused: paused, updatedAt: systemClock.now() })
    .where(eq(userPreferences.userId, userId))

  revalidatePath('/settings')
  revalidatePath('/')
}

/**
 * Disconnects an account and destroys its stored credentials.
 *
 * The account id comes from the form, so it is re-checked against the session
 * user inside `disconnectAccount` before anything is touched.
 */
export async function disconnectAccountAction(formData: FormData): Promise<void> {
  const accountId = String(formData.get('accountId') ?? '')
  if (!accountId) return

  const { userId } = await getSession()
  await disconnectAccount(userId, accountId, systemClock.now())

  revalidatePath('/settings')
  revalidatePath('/drafts')
  revalidatePath('/')
}

export async function runNudgeRoundNow(): Promise<void> {
  const { userId } = await getSession()
  await runNudgeRound(userId)
  revalidatePath('/settings')
}

export async function runBriefingNow(): Promise<void> {
  const { userId } = await getSession()
  await runDailyBriefing(userId)
  revalidatePath('/settings')
  revalidatePath('/')
}

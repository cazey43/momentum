'use client'

import { useVoiceMood } from './VoiceMood'

/**
 * A slow, drifting aurora behind every page.
 *
 * Purely decorative: aria-hidden and non-interactive, painted underneath all
 * content. It reads the shared voice mood and shifts colour and energy — warm
 * while listening, blue while thinking, green while speaking — so the /talk page
 * visibly comes alive as Momentum hears and answers you. On every other page it
 * rests in its calm idle palette.
 *
 * The motion is all CSS (see globals.css), which means the app's global
 * reduced-motion rule freezes it into a still wash for anyone who asks the OS
 * for less movement.
 */
export function AmbientBackground() {
  const { mood } = useVoiceMood()

  return (
    <div className="ambient" data-mood={mood} aria-hidden="true">
      <div className="ambient__orb ambient__orb--1" />
      <div className="ambient__orb ambient__orb--2" />
      <div className="ambient__orb ambient__orb--3" />
    </div>
  )
}

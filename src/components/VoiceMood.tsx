'use client'

import { createContext, useContext, useMemo, useState } from 'react'

/**
 * A tiny shared signal for the current voice "mood".
 *
 * The ambient background lives in the root layout, while the thing that knows
 * whether Momentum is listening or speaking is the voice control deep inside the
 * /talk page. This context is the thread between them — nothing more. Anywhere
 * without a provider gets a harmless no-op, so the voice control is still usable
 * on its own.
 */

export type VoiceMood = 'idle' | 'listening' | 'thinking' | 'speaking'

interface VoiceMoodContextValue {
  mood: VoiceMood
  setMood: (mood: VoiceMood) => void
}

const VoiceMoodContext = createContext<VoiceMoodContextValue>({
  mood: 'idle',
  setMood: () => {},
})

export function VoiceMoodProvider({ children }: { children: React.ReactNode }) {
  const [mood, setMood] = useState<VoiceMood>('idle')
  const value = useMemo(() => ({ mood, setMood }), [mood])
  return <VoiceMoodContext.Provider value={value}>{children}</VoiceMoodContext.Provider>
}

export function useVoiceMood(): VoiceMoodContextValue {
  return useContext(VoiceMoodContext)
}

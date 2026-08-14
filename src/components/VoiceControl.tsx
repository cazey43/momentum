'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type SpeechAvailability,
  selectSpeechToText,
  selectTextToSpeech,
} from '@/adapters/speech/select'
import { useVoiceMood, type VoiceMood } from '@/components/VoiceMood'
import type { SpeechToTextProvider, TextToSpeechProvider, VoiceState } from '@/core/ports/speech'

interface VoiceControlProps {
  /** Called with the final transcript when the user finishes speaking. */
  onFinalTranscript: (text: string) => void
  /** Interim text, so the caller can show it in the composer. */
  onInterimTranscript?: (text: string) => void
  /** Text the assistant just said, offered for reading aloud. */
  speakText?: string | null
  /** Which hosted voice providers the server has configured. */
  speech?: SpeechAvailability
}

const NO_HOSTED_SPEECH: SpeechAvailability = { hostedStt: false, hostedTts: false }

const STATE_COPY: Record<VoiceState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  muted: 'Muted',
  error: 'Problem',
}

const STATE_CLASS: Record<VoiceState, string> = {
  idle: 'bg-surface-sunken text-ink-muted',
  listening: 'bg-urgent-soft text-urgent',
  thinking: 'bg-waiting-soft text-waiting',
  speaking: 'bg-done-soft text-done',
  muted: 'bg-surface-sunken text-ink-faint',
  error: 'bg-urgent-soft text-urgent',
}

/**
 * Voice mode.
 *
 * Design decisions worth stating:
 *
 * - **Push-to-talk is tap-to-start / tap-to-stop**, not press-and-hold.
 *   Sustaining a press is an accessibility barrier for motor impairments, and
 *   press-and-hold cannot be operated by switch devices. Listening still only
 *   ever begins from an explicit user action, which is the property that
 *   matters.
 * - **Hands-free is opt-in and separate.** It is off until the user turns it
 *   on, and turning it on does not start listening.
 * - **The listening state is unmistakable**: a coloured badge, a pulsing dot,
 *   and an `aria-live` announcement, so it is obvious in every modality.
 * - **No audio is stored.** Only text transcripts reach the caller.
 */
export function VoiceControl({
  onFinalTranscript,
  onInterimTranscript,
  speakText,
  speech = NO_HOSTED_SPEECH,
}: VoiceControlProps) {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [handsFree, setHandsFree] = useState(false)
  const [available, setAvailable] = useState<{ stt: boolean; tts: boolean } | null>(null)

  // Pick hosted (Deepgram / ElevenLabs) or browser adapters once, from the
  // server-provided flags. Both satisfy the same port, so nothing below cares.
  const sttRef = useRef<SpeechToTextProvider | null>(null)
  const ttsRef = useRef<TextToSpeechProvider | null>(null)
  if (sttRef.current === null) sttRef.current = selectSpeechToText(speech)
  if (ttsRef.current === null) ttsRef.current = selectTextToSpeech(speech)
  const stt = sttRef.current
  const tts = ttsRef.current
  const stopRef = useRef<(() => void) | null>(null)
  const finalRef = useRef('')

  // Capability detection has to happen after mount: on the server there is no
  // window, and rendering a mic button that cannot work would be fake UI.
  useEffect(() => {
    setAvailable({
      stt: stt.isAvailable(),
      tts: tts.isAvailable(),
    })
  }, [stt, tts])

  // Feed the voice state to the ambient background, so it warms while listening,
  // cools while thinking, and settles while speaking. Reset to idle on the way
  // out so leaving /talk does not strand the background in a lit state.
  const { setMood } = useVoiceMood()
  useEffect(() => {
    const moodByState: Record<VoiceState, VoiceMood> = {
      idle: 'idle',
      muted: 'idle',
      error: 'idle',
      listening: 'listening',
      thinking: 'thinking',
      speaking: 'speaking',
    }
    setMood(moodByState[state])
  }, [state, setMood])
  useEffect(() => () => setMood('idle'), [setMood])

  const stopListening = useCallback(() => {
    stopRef.current?.()
    stopRef.current = null
    setState('idle')
  }, [])

  const startListening = useCallback(async () => {
    setError(null)
    setTranscript('')
    finalRef.current = ''
    setState('listening')

    stopRef.current = await stt.start({
      onTranscript: (chunk) => {
        if (chunk.isFinal) {
          finalRef.current = `${finalRef.current} ${chunk.text}`.trim()
          setTranscript(finalRef.current)
        } else {
          setTranscript(`${finalRef.current} ${chunk.text}`.trim())
          onInterimTranscript?.(`${finalRef.current} ${chunk.text}`.trim())
        }
      },
      onError: (message) => {
        setError(message)
        setState('error')
        stopRef.current = null
      },
      onEnd: () => {
        stopRef.current = null
        const text = finalRef.current.trim()
        if (text) {
          setState('thinking')
          onFinalTranscript(text)
        } else {
          setState('idle')
        }
        // Hands-free re-arms only if the user explicitly enabled it.
        if (handsFree && text) {
          window.setTimeout(() => {
            void startListening()
          }, 600)
        }
      },
    })
  }, [handsFree, onFinalTranscript, onInterimTranscript, stt])

  const speak = useCallback(() => {
    if (!speakText) return
    tts.speak(speakText, {
      onStart: () => setState('speaking'),
      onEnd: () => setState('idle'),
      onError: (message) => {
        setError(message)
        setState('error')
      },
    })
  }, [speakText, tts])

  const stopSpeaking = useCallback(() => {
    tts.stop()
    setState('idle')
  }, [tts])

  // Stop everything if the component goes away mid-utterance.
  useEffect(() => {
    return () => {
      stopRef.current?.()
      tts.stop()
    }
  }, [tts])

  if (available === null) {
    return <div className="h-9" aria-hidden="true" />
  }

  if (!available.stt && !available.tts) {
    return (
      <p className="text-sm text-ink-muted">
        This browser does not support speech, so Momentum is text-only here. Everything still works
        by typing.
      </p>
    )
  }

  const isListening = state === 'listening'
  const isSpeaking = state === 'speaking'

  return (
    <div className="rounded-card border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${STATE_CLASS[state]}`}
        >
          {isListening ? (
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-urgent" />
          ) : null}
          {STATE_COPY[state]}
        </span>

        {/* The state is announced, not just coloured. */}
        <span aria-live="polite" className="sr-only-focusable">
          Voice status: {STATE_COPY[state]}
          {error ? `. ${error}` : ''}
        </span>

        {available.stt ? (
          <button
            type="button"
            onClick={isListening ? stopListening : () => void startListening()}
            aria-pressed={isListening}
            className={
              isListening
                ? 'rounded-md bg-urgent px-3 py-1.5 text-sm font-medium text-on-urgent'
                : 'rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-sunken'
            }
          >
            {isListening ? 'Stop listening' : 'Hold to talk'}
          </button>
        ) : (
          <span className="text-xs text-ink-faint">Speech input unavailable in this browser.</span>
        )}

        {available.tts && speakText ? (
          <button
            type="button"
            onClick={isSpeaking ? stopSpeaking : speak}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-sunken"
          >
            {isSpeaking ? 'Stop speaking' : 'Read it aloud'}
          </button>
        ) : null}

        {available.stt ? (
          <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={handsFree}
              onChange={(event) => {
                setHandsFree(event.target.checked)
                // Turning it on must not begin listening. That still takes a
                // deliberate press.
                if (!event.target.checked) stopListening()
              }}
            />
            Hands-free
          </label>
        ) : null}
      </div>

      {handsFree ? (
        <p className="mt-2 text-xs text-ink-muted">
          Hands-free will re-open the microphone after each reply until you turn it off.
        </p>
      ) : null}

      {transcript ? (
        <p className="mt-2 border-l-2 border-line pl-2 text-sm text-ink-muted italic">
          {transcript}
        </p>
      ) : null}

      {error ? <p className="mt-2 text-sm text-urgent">{error}</p> : null}

      <p className="mt-2 text-xs text-ink-faint">
        Audio is never saved. Only the text transcript is kept, as part of the conversation.
        {stt.id === 'deepgram' || tts.id === 'elevenlabs'
          ? ` Speech is processed by ${[
              stt.id === 'deepgram' ? 'Deepgram' : null,
              tts.id === 'elevenlabs' ? 'ElevenLabs' : null,
            ]
              .filter(Boolean)
              .join(' and ')} and is not stored there.`
          : ''}
      </p>
    </div>
  )
}

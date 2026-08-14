'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserSpeechToText, BrowserTextToSpeech } from '@/adapters/speech/browser'
import type { VoiceState } from '@/core/ports/speech'

interface VoiceControlProps {
  /** Called with the final transcript when the user finishes speaking. */
  onFinalTranscript: (text: string) => void
  /** Interim text, so the caller can show it in the composer. */
  onInterimTranscript?: (text: string) => void
  /** Text the assistant just said, offered for reading aloud. */
  speakText?: string | null
}

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
}: VoiceControlProps) {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [handsFree, setHandsFree] = useState(false)
  const [available, setAvailable] = useState<{ stt: boolean; tts: boolean } | null>(null)

  const sttRef = useRef(new BrowserSpeechToText())
  const ttsRef = useRef(new BrowserTextToSpeech())
  const stopRef = useRef<(() => void) | null>(null)
  const finalRef = useRef('')

  // Capability detection has to happen after mount: on the server there is no
  // window, and rendering a mic button that cannot work would be fake UI.
  useEffect(() => {
    setAvailable({
      stt: sttRef.current.isAvailable(),
      tts: ttsRef.current.isAvailable(),
    })
  }, [])

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

    stopRef.current = await sttRef.current.start({
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
  }, [handsFree, onFinalTranscript, onInterimTranscript])

  const speak = useCallback(() => {
    if (!speakText) return
    ttsRef.current.speak(speakText, {
      onStart: () => setState('speaking'),
      onEnd: () => setState('idle'),
      onError: (message) => {
        setError(message)
        setState('error')
      },
    })
  }, [speakText])

  const stopSpeaking = useCallback(() => {
    ttsRef.current.stop()
    setState('idle')
  }, [])

  // Stop everything if the component goes away mid-utterance.
  useEffect(() => {
    return () => {
      stopRef.current?.()
      ttsRef.current.stop()
    }
  }, [])

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
      </p>
    </div>
  )
}

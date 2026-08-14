'use client'

import { useRef, useState } from 'react'
import { VoiceControl } from '@/components/VoiceControl'

interface TalkComposerProps {
  /** Server action, passed down from the server component. */
  action: (formData: FormData) => Promise<void>
  conversationId: string | null
  /** The assistant's most recent reply, offered for reading aloud. */
  lastReply: string | null
}

/**
 * The message composer, shared by typing and speaking.
 *
 * Voice and text converge on one input and one submit path, so a spoken turn
 * and a typed turn are handled identically downstream. The transcript lands in
 * the visible text box before submission, which means the user always sees what
 * is about to be sent and can correct it — speech recognition is wrong often
 * enough that sending a transcript unseen would be a mistake.
 */
export function TalkComposer({ action, conversationId, lastReply }: TalkComposerProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [value, setValue] = useState('')

  return (
    <div className="mt-6 space-y-3">
      <VoiceControl
        speakText={lastReply}
        onInterimTranscript={(text) => setValue(text)}
        onFinalTranscript={(text) => {
          setValue(text)
          // Deliberately not auto-submitted: the user reviews the transcript
          // and presses Send. Auto-sending a misheard sentence is worse than
          // one extra keystroke.
          formRef.current?.querySelector<HTMLInputElement>('input[name="message"]')?.focus()
        }}
      />

      <form ref={formRef} action={action} className="flex gap-2">
        {conversationId ? (
          <input type="hidden" name="conversationId" value={conversationId} />
        ) : null}

        <label htmlFor="message" className="sr-only-focusable">
          Message Momentum
        </label>
        <input
          id="message"
          name="message"
          type="text"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="What needs my attention today?"
          className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Send
        </button>
      </form>
    </div>
  )
}

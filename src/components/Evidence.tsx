import type { ConfidenceLevel } from '@/core/domain/vocabulary'

export interface EvidenceSource {
  id: string
  title: string | null
  author: string | null
  occurredAt: Date | null
  excerpt: string | null
  externalUrl: string | null
}

interface EvidenceProps {
  confidence: ConfidenceLevel | null
  /** The plain-language explanation. Required — never optional. */
  reason: string | null
  sources: EvidenceSource[]
}

const CONFIDENCE_COPY: Record<ConfidenceLevel, string> = {
  high: 'Fairly confident',
  medium: 'Possible',
  low: 'Uncertain',
}

const CONFIDENCE_CLASS: Record<ConfidenceLevel, string> = {
  high: 'bg-done-soft text-done',
  medium: 'bg-waiting-soft text-waiting',
  low: 'bg-surface-sunken text-ink-muted',
}

function formatDate(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

/**
 * Renders an AI-derived claim together with its evidence.
 *
 * This is the *only* component that displays an inference, and it structurally
 * cannot display one bare: `reason` and `sources` are required props, and when
 * either is missing it renders an explicit warning rather than quietly showing
 * the claim as though it were established. That is what makes "never present
 * an inference as a fact" a property of the code rather than a good intention.
 */
export function Evidence({ confidence, reason, sources }: EvidenceProps) {
  const missingEvidence = !reason || sources.length === 0

  return (
    <div className="mt-3 rounded-md border border-line bg-surface-sunken/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${
            confidence ? CONFIDENCE_CLASS[confidence] : 'bg-urgent-soft text-urgent'
          }`}
        >
          {confidence ? CONFIDENCE_COPY[confidence] : 'Confidence not recorded'}
        </span>
        <span className="text-xs text-ink-faint">Momentum suggested this</span>
      </div>

      {reason ? (
        <p className="mt-2 text-sm text-ink-muted">{reason}</p>
      ) : (
        <p className="mt-2 text-sm text-urgent">
          No reason was recorded for this suggestion, so it should not be trusted.
        </p>
      )}

      {sources.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {sources.map((source) => (
            <li key={source.id} className="text-xs text-ink-faint">
              <span className="font-medium text-ink-muted">{source.title ?? 'Source'}</span>
              {source.author ? ` · ${source.author}` : ''}
              {source.occurredAt ? ` · ${formatDate(source.occurredAt)}` : ''}
              {source.excerpt ? (
                <span className="mt-0.5 block border-l-2 border-line pl-2 italic">
                  “{source.excerpt}”
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-urgent">
          The source for this suggestion is missing. Treat it as unverified.
        </p>
      )}

      {missingEvidence ? null : (
        <p className="mt-2 text-xs text-ink-faint">
          This is Momentum&rsquo;s reading of the source above, not a confirmed fact.
        </p>
      )}
    </div>
  )
}

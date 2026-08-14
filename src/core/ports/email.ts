/**
 * Email provider port.
 *
 * Note what is missing from the read surface: there is no `deleteMessage`,
 * `archiveMessage`, `markRead`, or `unsubscribe`. The spec forbids modifying
 * mail without explicit approval, and the cheapest way to guarantee that is to
 * never build the capability. An adapter cannot perform an action its
 * interface does not name.
 *
 * `sendReply` is separated onto its own optional interface for the same
 * reason: a provider configured with read-only scopes does not implement it,
 * so "can this account send?" is answerable by a type check rather than by
 * auditing scope strings at runtime.
 */

export interface EmailAddress {
  name: string | null
  address: string
}

export interface EmailThreadSummaryData {
  externalThreadId: string
  subject: string | null
  participants: string[]
  lastMessageAt: Date | null
  lastMessageFromMe: boolean
  unread: boolean
  category: 'primary' | 'newsletter' | 'receipt' | 'notification' | 'other'
}

export interface EmailMessageData {
  externalId: string
  externalThreadId: string
  from: EmailAddress
  to: EmailAddress[]
  subject: string | null
  receivedAt: Date
  /** Plain-text body. Adapters strip HTML before it reaches the domain. */
  bodyText: string
  fromMe: boolean
  webUrl: string | null
}

export interface ListThreadsOptions {
  /** Only threads with activity at or after this instant. */
  since?: Date
  limit?: number
}

export interface EmailProvider {
  readonly id: string
  isConnected(): Promise<boolean>
  /** Scopes actually granted, so the UI can show the user what was allowed. */
  grantedScopes(): Promise<string[]>
  listThreads(options?: ListThreadsOptions): Promise<EmailThreadSummaryData[]>
  listMessagesInThread(externalThreadId: string): Promise<EmailMessageData[]>
}

/**
 * Implemented only by providers explicitly granted send permission.
 *
 * Callers must check for its presence rather than assume it. Nothing in this
 * codebase calls `sendReply` without first verifying a recorded human approval
 * whose content hash matches what is about to go out.
 */
export interface SendCapableEmailProvider extends EmailProvider {
  sendReply(input: {
    externalThreadId: string
    to: string[]
    cc: string[]
    subject: string
    body: string
    /** Prevents a retried request from sending twice. */
    idempotencyKey: string
  }): Promise<{ sentAt: Date; externalMessageId: string }>
}

export function canSend(provider: EmailProvider): provider is SendCapableEmailProvider {
  return typeof (provider as SendCapableEmailProvider).sendReply === 'function'
}

import type {
  EmailMessageData,
  EmailProvider,
  EmailThreadSummaryData,
  ListThreadsOptions,
} from '@/core/ports/email'

/**
 * Microsoft Graph (Outlook / Microsoft 365) adapter — READ ONLY.
 *
 * This class deliberately does not implement `sendReply`, so `canSend()`
 * returns false and the send path refuses. Sending requires the `Mail.Send`
 * scope, which Momentum does not request during the standard connect flow;
 * a separate opt-in would add a send-capable subclass.
 *
 * Status: written and type-checked, but never exercised against live Graph —
 * no account has been connected. Treat the response shapes as unverified until
 * a real mailbox is attached.
 */

/** Least-privilege scopes. Note the absence of Mail.Send and Mail.ReadWrite. */
export const GRAPH_READ_SCOPES = [
  'offline_access',
  'User.Read',
  'Mail.Read',
  'MailboxSettings.Read',
] as const

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

interface GraphMessage {
  id: string
  conversationId: string
  subject: string | null
  receivedDateTime: string
  isRead: boolean
  webLink: string | null
  from?: { emailAddress?: { name?: string; address?: string } }
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[]
  body?: { contentType?: string; content?: string }
  bodyPreview?: string
}

export interface GraphAdapterOptions {
  /** Decrypted access token. The caller owns refresh. */
  accessToken: string
  /** The signed-in user's own address, used to identify their messages. */
  selfAddress: string
  fetchImpl?: typeof fetch
}

/** Strips HTML to plain text before any content reaches the domain layer. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Coarse categorization from headers and sender shape.
 *
 * Deliberately deterministic rather than model-driven: bulk mail is high
 * volume, and paying for a model call per newsletter would be wasteful and
 * would send more content to a provider than the feature needs.
 */
function categorize(message: GraphMessage): EmailThreadSummaryData['category'] {
  const from = message.from?.emailAddress?.address?.toLowerCase() ?? ''
  const subject = message.subject?.toLowerCase() ?? ''

  if (/^(no-?reply|donotreply|notifications?|mailer|bounce)@/.test(from)) return 'notification'
  if (/(newsletter|digest|weekly|unsubscribe)/.test(subject)) return 'newsletter'
  if (/(receipt|invoice paid|your order|payment received)/.test(subject)) return 'receipt'
  return 'primary'
}

export class GraphEmailProvider implements EmailProvider {
  readonly id = 'microsoft'
  private readonly accessToken: string
  private readonly selfAddress: string
  private readonly fetchImpl: typeof fetch

  constructor(options: GraphAdapterOptions) {
    this.accessToken = options.accessToken
    this.selfAddress = options.selfAddress.toLowerCase()
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async isConnected(): Promise<boolean> {
    try {
      const response = await this.request('/me?$select=id')
      return response.ok
    } catch {
      return false
    }
  }

  async grantedScopes(): Promise<string[]> {
    return [...GRAPH_READ_SCOPES]
  }

  private async request(path: string): Promise<Response> {
    return this.fetchImpl(`${GRAPH_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/json',
      },
    })
  }

  async listThreads(options?: ListThreadsOptions): Promise<EmailThreadSummaryData[]> {
    const top = Math.min(options?.limit ?? 50, 100)
    const filter = options?.since
      ? `&$filter=receivedDateTime ge ${options.since.toISOString()}`
      : ''

    const response = await this.request(
      `/me/messages?$top=${top}&$orderby=receivedDateTime desc&$select=id,conversationId,subject,receivedDateTime,isRead,from,toRecipients,webLink${filter}`,
    )

    if (!response.ok) {
      throw new Error(`Graph listThreads failed with ${response.status}`)
    }

    const payload = (await response.json()) as { value: GraphMessage[] }

    // Graph returns messages; collapse to threads by conversationId.
    const byThread = new Map<string, EmailThreadSummaryData>()
    for (const message of payload.value) {
      const fromAddress = message.from?.emailAddress?.address?.toLowerCase() ?? ''
      const fromMe = fromAddress === this.selfAddress
      const receivedAt = new Date(message.receivedDateTime)

      const existing = byThread.get(message.conversationId)
      const participants = new Set(existing?.participants ?? [])
      if (fromAddress) participants.add(fromAddress)
      for (const recipient of message.toRecipients ?? []) {
        const address = recipient.emailAddress?.address?.toLowerCase()
        if (address) participants.add(address)
      }

      if (!existing || (existing.lastMessageAt?.getTime() ?? 0) < receivedAt.getTime()) {
        byThread.set(message.conversationId, {
          externalThreadId: message.conversationId,
          subject: message.subject,
          participants: [...participants],
          lastMessageAt: receivedAt,
          lastMessageFromMe: fromMe,
          unread: !message.isRead,
          category: categorize(message),
        })
      } else {
        existing.participants = [...participants]
      }
    }

    return [...byThread.values()]
  }

  async listMessagesInThread(externalThreadId: string): Promise<EmailMessageData[]> {
    const escaped = externalThreadId.replace(/'/g, "''")
    const response = await this.request(
      `/me/messages?$filter=conversationId eq '${escaped}'&$orderby=receivedDateTime asc&$select=id,conversationId,subject,receivedDateTime,from,toRecipients,body,webLink`,
    )

    if (!response.ok) {
      throw new Error(`Graph listMessagesInThread failed with ${response.status}`)
    }

    const payload = (await response.json()) as { value: GraphMessage[] }

    return payload.value.map((message) => {
      const fromAddress = message.from?.emailAddress?.address ?? ''
      const rawBody = message.body?.content ?? message.bodyPreview ?? ''
      const bodyText =
        message.body?.contentType?.toLowerCase() === 'html' ? htmlToText(rawBody) : rawBody

      return {
        externalId: message.id,
        externalThreadId: message.conversationId,
        from: { name: message.from?.emailAddress?.name ?? null, address: fromAddress },
        to: (message.toRecipients ?? []).map((r) => ({
          name: r.emailAddress?.name ?? null,
          address: r.emailAddress?.address ?? '',
        })),
        subject: message.subject,
        receivedAt: new Date(message.receivedDateTime),
        bodyText,
        fromMe: fromAddress.toLowerCase() === this.selfAddress,
        webUrl: message.webLink,
      }
    })
  }
}

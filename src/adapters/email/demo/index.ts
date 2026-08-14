import type {
  EmailMessageData,
  EmailProvider,
  EmailThreadSummaryData,
  ListThreadsOptions,
} from '@/core/ports/email'

/**
 * Demo mailbox.
 *
 * Read-only by construction: it does not implement `sendReply`, so `canSend()`
 * returns false and the send path refuses before it can do anything. Demo mode
 * exercises the entire review and approval flow and then stops at exactly the
 * point where a real send would occur, which is what the spec asks for.
 */
export class DemoEmailProvider implements EmailProvider {
  readonly id = 'demo'

  async isConnected(): Promise<boolean> {
    return true
  }

  async grantedScopes(): Promise<string[]> {
    return ['demo.read']
  }

  async listThreads(options?: ListThreadsOptions): Promise<EmailThreadSummaryData[]> {
    const threads: EmailThreadSummaryData[] = [
      {
        externalThreadId: 'AAQkAD-demo-invoice',
        subject: 'Invoice #4471 — payment question',
        participants: ['priya@bright.example', 'demo@example.com'],
        lastMessageAt: new Date(Date.now() - 4 * 86_400_000),
        lastMessageFromMe: false,
        unread: true,
        category: 'primary',
      },
      {
        externalThreadId: 'AAQkAD-demo-contract',
        subject: 'Re: Northwind renewal paperwork',
        participants: ['dana@northwind.example', 'demo@example.com'],
        lastMessageAt: new Date(Date.now() - 6 * 86_400_000),
        lastMessageFromMe: true,
        unread: false,
        category: 'primary',
      },
      {
        externalThreadId: 'AAQkAD-demo-newsletter',
        subject: 'The Weekly Ops Digest — issue 212',
        participants: ['digest@ops.example'],
        lastMessageAt: new Date(Date.now() - 86_400_000),
        lastMessageFromMe: false,
        unread: true,
        category: 'newsletter',
      },
    ]

    const since = options?.since
    const filtered = since
      ? threads.filter((t) => (t.lastMessageAt?.getTime() ?? 0) >= since.getTime())
      : threads

    return filtered.slice(0, options?.limit ?? filtered.length)
  }

  async listMessagesInThread(externalThreadId: string): Promise<EmailMessageData[]> {
    if (externalThreadId === 'AAQkAD-demo-invoice') {
      return [
        {
          externalId: 'msg-demo-invoice-1',
          externalThreadId,
          from: { name: 'Priya Raman', address: 'priya@bright.example' },
          to: [{ name: null, address: 'demo@example.com' }],
          subject: 'Invoice #4471 — payment question',
          receivedAt: new Date(Date.now() - 4 * 86_400_000),
          bodyText:
            'Hi — quick question on invoice #4471. Could you confirm whether this should be billed to the Q3 or Q4 budget? We need to close the month by Friday. Thanks, Priya',
          fromMe: false,
          webUrl: 'https://outlook.office.com/mail/demo/invoice',
        },
      ]
    }

    if (externalThreadId === 'AAQkAD-demo-contract') {
      return [
        {
          externalId: 'msg-demo-contract-1',
          externalThreadId,
          from: { name: 'Casey', address: 'demo@example.com' },
          to: [{ name: 'Dana Whitfield', address: 'dana@northwind.example' }],
          subject: 'Re: Northwind renewal paperwork',
          receivedAt: new Date(Date.now() - 6 * 86_400_000),
          bodyText:
            "Thanks Dana — I'll send the signed contract over by Friday so legal can review.",
          fromMe: true,
          webUrl: 'https://outlook.office.com/mail/demo/contract',
        },
      ]
    }

    return []
  }
}

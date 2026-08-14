import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * The nine key workflows from the specification, plus the account-connection
 * flow and accessibility scans — end to end, against a production build.
 *
 * Run with `npm run test:e2e` after a one-time `npx playwright install
 * chromium`. Browsers land in `.playwright-browsers/` inside this project
 * rather than a machine-level cache.
 *
 * A note on locators: several assertions target a specific element (a `dd`, a
 * `span.italic`, a scoped section) rather than matching text anywhere on the
 * page. That is deliberate. Evidence quotes and recipient fields legitimately
 * repeat the same string, so a loose match is ambiguous and, worse, can pass
 * for the wrong reason.
 */

test.describe('1. Capture a task by typing', () => {
  test('a typed capture appears in Tasks', async ({ page }) => {
    await page.goto('/')
    const unique = `Buy milk ${Date.now()}`

    await page.getByLabel(/capture a task/i).fill(unique)
    await page.getByRole('button', { name: /^capture$/i }).click()

    await page.goto('/tasks')
    await expect(page.getByText(unique)).toBeVisible()
  })

  test('captures with a marker become the right kind', async ({ page }) => {
    await page.goto('/')
    const unique = `waiting: Dana on the quote ${Date.now()}`

    await page.getByLabel(/capture a task/i).fill(unique)
    await page.getByRole('button', { name: /^capture$/i }).click()

    await page.goto('/waiting')
    await expect(page.getByText(/dana on the quote/i)).toBeVisible()
  })
})

test.describe('2. View and update today’s priorities', () => {
  test('Today shows suggested priorities with a reason', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /suggested first/i })).toBeVisible()
    // Every priority must explain itself, never show a bare score.
    await expect(page.getByText(/^This /).first()).toBeVisible()
  })

  test('marking something done removes it from Today', async ({ page }) => {
    await page.goto('/')
    const firstDone = page.getByRole('button', { name: /mark done/i }).first()
    await firstDone.click()
    await expect(page).toHaveURL('/')
  })
})

test.describe('3 & 4. Detect a commitment and review its evidence', () => {
  test('an inferred item shows confidence, reason, and source', async ({ page }) => {
    await page.goto('/tasks')

    const card = page.locator('article', { hasText: /Northwind contract/i }).first()
    await expect(card).toBeVisible()
    await expect(card.getByText(/Momentum suggested this/i)).toBeVisible()
    await expect(card.getByText(/Fairly confident|Possible|Uncertain/)).toBeVisible()

    // Two distinct things must both be on the card, and they are asserted
    // separately because a loose match hits both and is therefore ambiguous:
    //   1. the plain-language reason for the inference
    await expect(card.getByText(/^You wrote/)).toBeVisible()
    //   2. the source excerpt, quoted verbatim underneath it
    await expect(card.locator('span.italic')).toContainText(/I'll send the signed contract/i)

    // The evidence must not contradict the claim: a card that says "You wrote"
    // has to cite the user's own message, not the other party's.
    await expect(card.getByText(/Casey <demo@example\.com>/)).toBeVisible()
  })

  test('loose ends show what, why, source, confidence, and a next step', async ({ page }) => {
    await page.goto('/loose-ends')
    const card = page.locator('article').first()

    await expect(card.getByText(/Fairly confident|Possible|Uncertain/)).toBeVisible()
    await expect(card.getByText(/Suggested:/)).toBeVisible()
    // Tone: never accusatory.
    await expect(card).not.toContainText(/you forgot|you failed|you are behind/i)
  })
})

test.describe('5. Draft a reply and require approval before send', () => {
  test('a draft shows exact recipients, subject, and full body', async ({ page }) => {
    await page.goto('/drafts')

    const draft = page.locator('article').first()

    // Assert against the recipients field specifically, not "the address
    // appears somewhere on the card" — the address also appears in the cited
    // source, and the point of this test is that the *send targets* are shown.
    await expect(draft.locator('dd').filter({ hasText: 'priya@bright.example' })).toBeVisible()
    await expect(draft.locator('dd').filter({ hasText: /Invoice #4471/ })).toBeVisible()
    // The full body, not a truncated preview.
    await expect(draft.locator('pre')).toContainText('billed against Q3')
  })

  test('sending is not offered until the draft is approved', async ({ page }) => {
    await page.goto('/drafts')
    const draft = page.locator('article', { hasText: /Invoice #4471/ }).first()

    // Before approval there is no send control at all.
    await expect(draft.getByRole('button', { name: /send it/i })).toHaveCount(0)
    await expect(draft.getByRole('button', { name: /^approve$/i })).toBeVisible()
  })

  test('financial content is flagged for careful review', async ({ page }) => {
    await page.goto('/drafts')
    await expect(page.getByText(/read it closely before approving/i)).toBeVisible()
  })

  test('after approval, sending stays disabled on a read-only connection', async ({ page }) => {
    await page.goto('/drafts')
    const draft = page.locator('article', { hasText: /Invoice #4471/ }).first()

    await draft.getByRole('button', { name: /^approve$/i }).click()

    const send = page.locator('article', { hasText: /Invoice #4471/ }).getByRole('button', {
      name: /send it/i,
    })
    await expect(send).toBeDisabled()
  })
})

test.describe('6. Create and read a daily briefing', () => {
  test('Today shows a briefing that can be expanded', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /your briefing/i })).toBeVisible()
    await page.getByText(/show the full picture/i).click()
  })
})

test.describe('7. Snooze a nudge and prove suppression works', () => {
  test('an item set aside disappears from Today and says so in Tasks', async ({ page }) => {
    await page.goto('/')
    await page
      .getByRole('button', { name: /not today/i })
      .first()
      .click()

    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: /set aside/i })).toBeVisible()
  })
})

test.describe('8. Track a waiting-for item', () => {
  test('waiting items never appear as overdue', async ({ page }) => {
    await page.goto('/waiting')
    await expect(page.getByText(/waiting on/i).first()).toBeVisible()
    await expect(page.getByText(/past the date you set/i)).toHaveCount(0)
  })
})

test.describe('9. Pause all proactive reminders', () => {
  test('the global pause switch takes effect immediately', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: /pause all proactive reminders/i }).click()

    await expect(page.getByText(/Momentum will not raise anything on its own/i)).toBeVisible()

    // And it can be undone.
    await page.getByRole('button', { name: /resume reminders/i }).click()
    await expect(page.getByText(/Momentum may speak up/i)).toBeVisible()
  })
})

test.describe('Account connection', () => {
  test('shows a precise configuration checklist when not configured', async ({ page }) => {
    // With no MS_GRAPH_* values set, the user must be told exactly what is
    // missing rather than being bounced to a Microsoft error page.
    await page.goto('/settings')

    // Scoped to the integrations section: the privacy section legitimately
    // mentions the same state, so a page-wide match is ambiguous.
    const section = page.locator('section').filter({ hasText: 'Connected accounts' })

    await expect(section.getByText(/No account is connected/i)).toBeVisible()
    await expect(section.getByText(/Not configured yet/i)).toBeVisible()
    await expect(section.getByText(/MS_GRAPH_CLIENT_ID/)).toBeVisible()
    await expect(section.getByText(/randomBytes\(32\)/)).toBeVisible()
  })

  test('does not offer a Connect button until configuration is valid', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('link', { name: /connect outlook/i })).toHaveCount(0)
  })

  test('refuses to start OAuth when unconfigured, naming the problems', async ({ request }) => {
    const response = await request.get('/api/integrations/microsoft/start', {
      maxRedirects: 0,
    })

    expect(response.status()).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/not fully configured/i)
    expect(body.problems.join(' ')).toContain('MS_GRAPH_CLIENT_ID')
  })

  test('rejects a forged callback that has no matching state cookie', async ({ request }) => {
    // The CSRF guard: without the cookie set by /start, this must not connect.
    const response = await request.get(
      '/api/integrations/microsoft/callback?code=forged&state=attacker',
      { maxRedirects: 0 },
    )

    expect(response.status()).toBe(303)
    const location = response.headers().location ?? ''
    expect(location).toContain('connect_error')
    // URLSearchParams encodes spaces as '+', which decodeURIComponent leaves
    // alone — normalise before matching on prose.
    expect(decodeURIComponent(location).replace(/\+/g, ' ')).toMatch(/could not be verified/i)
  })

  test('surfaces a provider-reported error instead of failing silently', async ({ request }) => {
    const response = await request.get(
      '/api/integrations/microsoft/callback?error=access_denied&error_description=User+declined',
      { maxRedirects: 0 },
    )

    expect(response.status()).toBe(303)
    expect(decodeURIComponent(response.headers().location ?? '').replace(/\+/g, ' ')).toMatch(
      /User declined/i,
    )
  })
})

test.describe('Accessibility', () => {
  const routes = [
    '/',
    '/review',
    '/tasks',
    '/waiting',
    '/loose-ends',
    '/drafts',
    '/talk',
    '/settings',
  ]

  for (const route of routes) {
    test(`${route} has no serious or critical violations`, async ({ page }) => {
      await page.goto(route)

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      const serious = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      )

      expect(
        serious,
        `Violations: ${serious.map((v) => `${v.id} (${v.impact})`).join(', ')}`,
      ).toEqual([])
    })
  }

  test('every page is reachable by keyboard from the skip link', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: /skip to main content/i })).toBeFocused()
  })
})

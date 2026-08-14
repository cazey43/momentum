/**
 * Fetches the authorize URL server-side and looks for an AADSTS error.
 *
 * Microsoft validates the client id and redirect URI *before* showing a
 * sign-in form, so a mis-registered redirect URI or unknown app produces an
 * error page rather than a login page. That is detectable without any user
 * interaction, which is useful when the browser flow stalls and the error is
 * only visible on Microsoft's page.
 *
 *   npx tsx scripts/probe-authorize.ts
 */
const startUrl = 'http://localhost:3000/api/integrations/microsoft/start'

const start = await fetch(startUrl, { redirect: 'manual' })
const location = start.headers.get('location')

console.log(`/start -> HTTP ${start.status}`)
if (!location) {
  console.log('No Location header; is the dev server running on port 3000?')
  process.exitCode = 1
} else {
  const authorize = new URL(location)
  console.log(`authorize host: ${authorize.host}`)
  console.log(`tenant segment: ${authorize.pathname.split('/')[1]}`)

  const response = await fetch(authorize, { redirect: 'manual' })
  const body = await response.text()

  console.log(`authorize -> HTTP ${response.status}`)

  const codes = [...new Set(body.match(/AADSTS\d+/g) ?? [])]
  if (codes.length === 0) {
    console.log('\nNo AADSTS error on the authorize page.')
    console.log('Microsoft is willing to show a sign-in form, so the client id,')
    console.log('tenant, and redirect URI are all registered correctly.')
    console.log('Whatever is stopping the flow happens during sign-in or consent.')
  } else {
    console.log(`\nAADSTS codes present: ${codes.join(', ')}`)

    const meanings: Record<string, string> = {
      AADSTS50011:
        'Redirect URI mismatch. The URI in Entra must equal MS_GRAPH_REDIRECT_URI exactly.',
      AADSTS700016: 'Application not found in this tenant. Check client id and tenant id.',
      AADSTS900023: 'Tenant identifier is not valid.',
      AADSTS50020:
        'The signed-in user is from a different tenant and is not permitted by this registration.',
      AADSTS650057: 'Invalid resource — the requested scopes are not configured on the app.',
      AADSTS90009: 'The app is requesting a token for itself; check the scope values.',
      AADSTS500011: 'The resource principal was not found in the tenant.',
    }

    for (const code of codes) {
      console.log(`  ${code}: ${meanings[code] ?? 'see Microsoft documentation for this code'}`)
    }

    // The human-readable message, when present, is the most useful line.
    const message = /"error_description"\s*:\s*"([^"]+)"/.exec(body)?.[1]
    if (message) console.log(`\nMicrosoft says: ${message.slice(0, 400)}`)
  }

  // Does the page look like a normal sign-in form?
  const looksLikeLogin = /login|sign in|password|Pick an account/i.test(body)
  console.log(`\npage looks like a sign-in form: ${looksLikeLogin}`)
  console.log(`response body length: ${body.length}`)
}

import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The libsql client is a native-ish dependency; keep it external to the
  // server bundle so Next does not attempt to trace/bundle its binaries.
  serverExternalPackages: ['@libsql/client'],

  // Momentum is a local-only, single-user app. These headers are still worth
  // setting: they harden the browser surface against XSS and clickjacking and
  // keep the app from leaking referrers to third parties.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            // Microphone is required for voice mode; everything else is denied.
            value: 'camera=(), geolocation=(), microphone=(self), interest-cohort=()',
          },
        ],
      },
    ]
  },
}

export default nextConfig

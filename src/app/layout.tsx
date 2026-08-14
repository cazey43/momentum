import type { Metadata, Viewport } from 'next'
import { AmbientBackground } from '@/components/AmbientBackground'
import { AppNav } from '@/components/AppNav'
import { VoiceMoodProvider } from '@/components/VoiceMood'
import { APP_NAME, APP_TAGLINE } from '@/config/branding'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_TAGLINE,
  // This is a personal, local-only tool. Keep it out of any index.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f6' },
    { media: '(prefers-color-scheme: dark)', color: '#1d1b19' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <VoiceMoodProvider>
          <a
            href="#main"
            className="sr-only-focusable absolute top-2 left-2 z-50 rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent"
          >
            Skip to main content
          </a>

          <AmbientBackground />

          <div className="relative z-10 flex min-h-dvh flex-col md:flex-row">
            <AppNav />
            <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-5 py-6 md:px-10 md:py-10">
              {children}
            </main>
          </div>
        </VoiceMoodProvider>
      </body>
    </html>
  )
}

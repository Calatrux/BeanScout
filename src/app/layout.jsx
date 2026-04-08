import './globals.css'
import Nav from '@/components/Nav'
import { AuthProvider } from '@/lib/auth-context'
import { debugLog } from '@/lib/debug'
import PWAProvider from '@/components/PWAProvider'

export const metadata = {
  title: 'BEAN Scout',
  description: 'Qualitative FRC scouting tool',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.png',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'BEAN Scout',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1B97AD',
}

export default function RootLayout({ children }) {
  // Only log during runtime, not build time
  if (typeof window !== 'undefined') {
    debugLog('RootLayout', 'Rendering root layout')
  }

  return (
    <html lang="en">
      <body>
        <PWAProvider>
          <AuthProvider>
            <Nav />
            <main>{children}</main>
          </AuthProvider>
        </PWAProvider>
      </body>
    </html>
  )
}

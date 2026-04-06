import './globals.css'
import Nav from '@/components/Nav'
import { AuthProvider } from '@/lib/auth-context'
import { debugLog } from '@/lib/debug'

export const metadata = {
  title: 'BEAN Scout',
  description: 'Qualitative FRC scouting tool',
  icons: {
    icon: '/favicon.png',
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
        <AuthProvider>
          <Nav />
          <main>{children}</main>
        </AuthProvider>
      </body>
    </html>
  )
}

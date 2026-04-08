'use client'

import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const OFFLINE_PASSWORD = 'bleh123'

function OfflineLock({ onUnlock }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (password === OFFLINE_PASSWORD) {
      sessionStorage.setItem('offline-unlocked', '1')
      onUnlock()
    } else {
      setError('Wrong password')
      setPassword('')
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Offline Mode</h1>
        <p className="auth-subtitle">Enter the offline password to continue</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="offline-pw">Password</label>
            <input
              id="offline-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Offline password"
              autoFocus
              required
            />
          </div>
          {error && <div className="status error">{error}</div>}
          <button type="submit" className="submit-btn">Unlock</button>
        </form>
      </div>
    </div>
  )
}

export default function ProtectedRoute({ children, requireScouter = false, requireAdmin = false }) {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const [isOffline, setIsOffline] = useState(false)
  const [offlineUnlocked, setOfflineUnlocked] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setIsOffline(!navigator.onLine)
    setOfflineUnlocked(sessionStorage.getItem('offline-unlocked') === '1')

    const goOffline = () => setIsOffline(true)
    const goOnline = () => {
      setIsOffline(false)
      // Clear offline unlock when back online — normal auth takes over
      sessionStorage.removeItem('offline-unlocked')
      setOfflineUnlocked(false)
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  useEffect(() => {
    if (loading) return
    // If online and no user, redirect to login as normal
    if (!user && !isOffline && !offlineUnlocked) {
      router.push('/login')
      return
    }

    if (user && requireScouter && !profile?.is_scouter && !profile?.is_admin) {
      router.push('/unauthorized')
      return
    }

    if (user && requireAdmin && !profile?.is_admin) {
      router.push('/unauthorized')
      return
    }
  }, [user, profile, loading, router, requireScouter, requireAdmin, isOffline, offlineUnlocked])

  if (loading) {
    return (
      <div className="page" style={{ textAlign: 'center', paddingTop: '100px' }}>
        <div className="loading-text" style={{ justifyContent: 'center' }}>
          <span className="loading-spinner" />
          Loading...
        </div>
      </div>
    )
  }

  // Offline and no session: show offline password gate
  if (!user && (isOffline || !navigator.onLine) && !offlineUnlocked) {
    return <OfflineLock onUnlock={() => setOfflineUnlocked(true)} />
  }

  // Online but no user and not offline-unlocked
  if (!user && !offlineUnlocked) {
    return null
  }

  if (user && requireScouter && !profile?.is_scouter && !profile?.is_admin) {
    return null
  }

  if (user && requireAdmin && !profile?.is_admin) {
    return null
  }

  return children
}

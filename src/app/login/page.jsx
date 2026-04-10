'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const OFFLINE_PASSWORD = 'bleh123'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [offlinePw, setOfflinePw] = useState('')
  const router = useRouter()

  useEffect(() => {
    if (typeof window === 'undefined') return
    setIsOffline(!navigator.onLine)
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    router.push('/')
  }

  const handleOfflineUnlock = (e) => {
    e.preventDefault()
    if (offlinePw === OFFLINE_PASSWORD) {
      sessionStorage.setItem('offline-unlocked', '1')
      router.push('/')
    } else {
      setError('Wrong password')
      setOfflinePw('')
    }
  }

  // Offline: show offline password gate instead of login form
  if (isOffline) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1 className="auth-title">Offline Mode</h1>
          <p className="auth-subtitle">No internet connection. Enter the offline password to continue.</p>
          <form className="auth-form" onSubmit={handleOfflineUnlock}>
            <div className="field">
              <label htmlFor="offline-pw">Password</label>
              <input
                id="offline-pw"
                type="password"
                value={offlinePw}
                onChange={(e) => setOfflinePw(e.target.value)}
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

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Sign in to your BEAN Scout account</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              required
            />
          </div>

          {error && (
            <div className="status error">{error}</div>
          )}

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="auth-link">
          Don&apos;t have an account? <Link href="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  )
}

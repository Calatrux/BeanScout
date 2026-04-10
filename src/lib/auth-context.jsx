'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { debugLog } from '@/lib/debug'

const AuthContext = createContext({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
})

// If loading takes longer than this, assume the session is stuck and clear it
const AUTH_TIMEOUT_MS = 8000

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const timeoutRef = useRef(null)

  const finishLoading = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setLoading(false)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    debugLog('AuthProvider', 'Starting auth initialization')

    // Escape hatch: if we're still loading after AUTH_TIMEOUT_MS, the session
    // is likely stuck (e.g. a stale Supabase auth lock in localStorage).
    // Force-clear it so the user can sign in again without manually clearing storage.
    timeoutRef.current = setTimeout(() => {
      console.warn('[Auth] Session stuck — force-clearing auth state')
      supabase.auth.signOut().catch(() => {})
      setUser(null)
      setProfile(null)
      setLoading(false)
    }, AUTH_TIMEOUT_MS)

    // onAuthStateChange fires INITIAL_SESSION on startup, so we don't need a
    // separate getSession() call. Using both causes fetchProfile() to run twice
    // simultaneously, which is a race condition that leaves loading=true.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        debugLog('AuthProvider', 'Auth state changed', { event })

        if (!session?.user) {
          setUser(null)
          setProfile(null)
          finishLoading()
          return
        }

        // Token refresh just rotates the JWT — user and profile haven't changed,
        // so skip the unnecessary DB round-trip.
        if (event === 'TOKEN_REFRESHED') {
          setUser(session.user)
          finishLoading()
          return
        }

        setUser(session.user)
        await fetchProfile(session.user.id)
      }
    )

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      subscription.unsubscribe()
    }
  }, [])

  const fetchProfile = async (userId) => {
    debugLog('AuthProvider', 'Fetching profile for userId:', userId)

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        // RLS recursion — retrying won't help
        if (error.code === '42P17') {
          console.error('[Auth] RLS policy recursion detected. Check Supabase policies.')
          finishLoading()
          return
        }

        // Profile might not exist yet (trigger delay) — retry once after 1s
        console.log('[Auth] Profile not found, retrying in 1s...')
        await new Promise(resolve => setTimeout(resolve, 1000))

        const { data: retryData, error: retryError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()

        if (!retryError && retryData) {
          setProfile(retryData)
        } else {
          console.error('[Auth] Profile retry failed:', retryError)
        }
        finishLoading()
        return
      }

      setProfile(data)
      finishLoading()
    } catch (err) {
      console.error('[Auth] Unexpected error fetching profile:', err)
      finishLoading()
    }
  }

  const signOut = async () => {
    // Reset state immediately so the UI is responsive even if the network call hangs
    setUser(null)
    setProfile(null)
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error('[Auth] Sign out error (non-fatal):', err)
    }
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

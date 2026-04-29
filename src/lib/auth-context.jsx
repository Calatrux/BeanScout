'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const AuthContext = createContext({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
})

// Belt-and-suspenders: if auth hasn't resolved by this point, unblock the UI.
// The real fix for hangs is the custom lock in supabase.js; this is a last resort.
const AUTH_TIMEOUT_MS = 5000

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const loadingDone = useRef(false)

  const finishLoading = () => {
    if (loadingDone.current) return
    loadingDone.current = true
    setLoading(false)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const timeout = setTimeout(() => {
      console.warn('[Auth] Auth init timed out — unblocking UI')
      finishLoading()
    }, AUTH_TIMEOUT_MS)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!session?.user) {
          setUser(null)
          setProfile(null)
          finishLoading()
          return
        }

        // Token refresh just rotates the JWT — skip unnecessary profile re-fetch
        if (event === 'TOKEN_REFRESHED') {
          setUser(session.user)
          finishLoading()
          return
        }

        setUser(session.user)
        await fetchProfile(session.user.id)
        finishLoading()
      }
    )

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  const fetchProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (!error && data) {
        setProfile(data)
        return
      }

      if (error?.code === '42P17') {
        console.error('[Auth] RLS policy recursion detected — check Supabase policies')
        return
      }

      // Profile might not exist yet if the DB trigger is slow — retry once
      await new Promise(r => setTimeout(r, 1000))
      const { data: retryData, error: retryError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (!retryError && retryData) {
        setProfile(retryData)
      } else if (retryError) {
        console.error('[Auth] Profile fetch failed:', retryError.message)
      }
    } catch (err) {
      console.error('[Auth] Unexpected profile fetch error:', err)
    }
  }

  const signOut = async () => {
    setUser(null)
    setProfile(null)
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error('[Auth] Sign out error (non-fatal):', err)
    }
    localStorage.clear()
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

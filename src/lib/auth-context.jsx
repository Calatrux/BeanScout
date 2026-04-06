'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { debugLog } from '@/lib/debug'

const AuthContext = createContext({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    debugLog('AuthProvider', 'Starting auth initialization')

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      debugLog('AuthProvider', 'Initial session retrieved', { hasSession: !!session })
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setLoading(false)
        debugLog('AuthProvider', 'Auth load complete (no user)')
        window.beanscoutDebug?.markLoaded('AuthProvider')
      }
    }).catch(err => {
      debugLog('AuthProvider', 'Failed to get initial session', err)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        debugLog('AuthProvider', 'Auth state changed', { event })
        setUser(session?.user ?? null)
        if (session?.user) {
          await fetchProfile(session.user.id)
        } else {
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (userId) => {
    debugLog('AuthProvider', 'Fetching profile for userId:', userId)
    console.log('[Auth] Fetching profile for userId:', userId)

    const { data, error, status } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    debugLog('AuthProvider', 'Profile fetch result:', { hasData: !!data, hasError: !!error })
    console.log('[Auth] Profile fetch result:', { data, error, status })

    if (error) {
      console.error('[Auth] Error fetching profile:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })

      // If it's a recursion error, don't retry - it's a policy issue
      if (error.code === '42P17') {
        console.error('[Auth] RLS policy recursion detected. Check Supabase policies.')
        setLoading(false)
        debugLog('AuthProvider', 'Auth load complete (policy error)')
        window.beanscoutDebug?.markLoaded('AuthProvider')
        return
      }

      // Profile might not exist yet (trigger delay), retry once
      debugLog('AuthProvider', 'Retrying profile fetch in 1 second...')
      console.log('[Auth] Retrying profile fetch in 1 second...')
      setTimeout(async () => {
        const { data: retryData, error: retryError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()

        debugLog('AuthProvider', 'Retry result:', { hasRetryData: !!retryData, hasRetryError: !!retryError })
        console.log('[Auth] Retry result:', { retryData, retryError })

        if (!retryError && retryData) {
          setProfile(retryData)
        } else {
          console.error('[Auth] Retry failed:', retryError)
        }
        setLoading(false)
        debugLog('AuthProvider', 'Auth load complete (after retry)')
        window.beanscoutDebug?.markLoaded('AuthProvider')
      }, 1000)
      return
    }

    if (data) {
      debugLog('AuthProvider', 'Profile loaded successfully')
      console.log('[Auth] Profile loaded:', data)
      setProfile(data)
    }
    setLoading(false)
    debugLog('AuthProvider', 'Auth load complete (success)')
    window.beanscoutDebug?.markLoaded('AuthProvider')
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
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

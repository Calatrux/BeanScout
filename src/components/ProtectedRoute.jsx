'use client'

import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function ProtectedRoute({ children, requireScouter = false, requireAdmin = false }) {
  const { user, profile, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return

    if (!user) {
      router.push('/login')
      return
    }

    if (requireScouter && !profile?.is_scouter && !profile?.is_admin) {
      router.push('/unauthorized')
      return
    }

    if (requireAdmin && !profile?.is_admin) {
      router.push('/unauthorized')
      return
    }
  }, [user, profile, loading, router, requireScouter, requireAdmin])

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

  if (!user) {
    return null
  }

  if (requireScouter && !profile?.is_scouter && !profile?.is_admin) {
    return null
  }

  if (requireAdmin && !profile?.is_admin) {
    return null
  }

  return children
}

'use client'

import PicklistForm from '@/components/PicklistForm'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function PicklistPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="page-loading">
        <span className="loading-spinner" />
        Loading...
      </div>
    )
  }

  if (!user) {
    return null
  }

  return <PicklistForm />
}

'use client'

import PicklistForm from '@/components/PicklistForm'
import ProtectedRoute from '@/components/ProtectedRoute'

export default function PicklistPage() {
  return (
    <ProtectedRoute requireScouter>
      <PicklistForm />
    </ProtectedRoute>
  )
}

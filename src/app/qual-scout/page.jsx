'use client'

import QualScoutForm from '@/components/QualScoutForm'
import ProtectedRoute from '@/components/ProtectedRoute'

export default function QualScoutPage() {
  return (
    <ProtectedRoute requireScouter>
      <div className="page">
        <QualScoutForm />
      </div>
    </ProtectedRoute>
  )
}

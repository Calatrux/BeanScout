'use client'

import PrescoutingForm from '@/components/PrescoutingForm'
import ProtectedRoute from '@/components/ProtectedRoute'

export default function PrescoutingPage() {
  return (
    <ProtectedRoute requireScouter>
      <div className="page">
        <PrescoutingForm />
      </div>
    </ProtectedRoute>
  )
}

'use client'

import TeamNotesForm from '@/components/TeamNotesForm'
import ProtectedRoute from '@/components/ProtectedRoute'

export default function TeamNotesPage() {
  return (
    <ProtectedRoute requireScouter>
      <div className="page">
        <TeamNotesForm />
      </div>
    </ProtectedRoute>
  )
}

'use client'

import ProtectedRoute from '@/components/ProtectedRoute'
import AnalysisDashboard from '@/components/AnalysisDashboard'

export default function AdminPage() {
  return (
    <ProtectedRoute requireAdmin>
      <AnalysisDashboard />
    </ProtectedRoute>
  )
}

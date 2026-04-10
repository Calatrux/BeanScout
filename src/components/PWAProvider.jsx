'use client'

import { useEffect } from 'react'
import { registerServiceWorker } from '@/lib/register-sw'

export default function PWAProvider({ children }) {
  useEffect(() => {
    registerServiceWorker()
  }, [])

  return children
}

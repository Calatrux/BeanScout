'use client'

import { useState, useEffect, useCallback } from 'react'
import { getUnsyncedCount, getUnsyncedQualEntries, getUnsyncedTeamNotes, getUnsyncedPicklists, markQualEntrySynced, markTeamNoteSynced, markPicklistSynced, getUnsyncedPrescoutingEntries, markPrescoutingEntrySynced } from '@/lib/indexeddb'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

export default function SyncBanner() {
  const { user } = useAuth()
  const [count, setCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncError, setSyncError] = useState(null)
  const [isOffline, setIsOffline] = useState(false)

  const refreshCount = useCallback(async () => {
    try {
      console.log('[SyncBanner] Refreshing unsynced count...')
      const n = await getUnsyncedCount()
      console.log('[SyncBanner] Unsynced count:', n)
      setCount(n)
      if (n === 0) setSyncError(null)
    } catch (err) {
      console.error('[SyncBanner] Failed to get unsynced count:', err)
      setCount(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    setIsOffline(!navigator.onLine)
    refreshCount()

    window.addEventListener('beanscout:saved', refreshCount)

    const handleOnline = () => {
      setIsOffline(false)
      // Auto-sync when connectivity returns
      refreshCount().then(() => {
        // handleSync is called via a small delay to let network stabilize
        setTimeout(() => {
          if (navigator.onLine) handleSync()
        }, 1000)
      })
    }

    const handleOffline = () => setIsOffline(true)

    // Auto-sync when iOS PWA resumes from background
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        refreshCount()
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('beanscout:saved', refreshCount)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refreshCount])

  const handleSync = async () => {
    if (!user) {
      setSyncError('Sign in to sync')
      return
    }

    setSyncing(true)
    setSyncError(null)
    let successCount = 0
    let failCount = 0

    try {
      console.log('[SyncBanner] Starting sync...')
      const [qualEntries, teamNotes, picklists, prescoutingEntries] = await Promise.all([
        getUnsyncedQualEntries(),
        getUnsyncedTeamNotes(),
        getUnsyncedPicklists(),
        getUnsyncedPrescoutingEntries(),
      ])

      console.log('[SyncBanner] Found entries to sync:', {
        qualEntries: qualEntries.length,
        teamNotes: teamNotes.length,
        picklists: picklists.length,
        prescoutingEntries: prescoutingEntries.length,
      })

      // Sync qual entries
      for (const entry of qualEntries) {
        try {
          const { id, synced: _s, ...record } = entry
          console.log('[SyncBanner] Syncing qual entry:', id)
          const { error } = await supabase.from('qual_scouting').upsert({ id, ...record })
          if (error) {
            console.error('[SyncBanner] Qual entry sync failed:', id, error.message)
            failCount++
          } else {
            await markQualEntrySynced(id)
            successCount++
          }
        } catch (err) {
          console.error('[SyncBanner] Error syncing qual entry:', err)
          failCount++
        }
      }

      // Sync team notes
      for (const note of teamNotes) {
        try {
          const { id, synced: _s, ...record } = note
          console.log('[SyncBanner] Syncing team note:', id)
          const { error } = await supabase.from('team_notes').upsert({ id, ...record })
          if (error) {
            console.error('[SyncBanner] Team note sync failed:', id, error.message)
            failCount++
          } else {
            await markTeamNoteSynced(id)
            successCount++
          }
        } catch (err) {
          console.error('[SyncBanner] Error syncing team note:', err)
          failCount++
        }
      }

      // Sync picklists
      for (const picklist of picklists) {
        try {
          const { id, synced: _s, ...record } = picklist
          console.log('[SyncBanner] Syncing picklist:', id)
          const { error } = await supabase.from('picklists').upsert({ id, ...record })
          if (error) {
            console.error('[SyncBanner] Picklist sync failed:', id, error.message)
            failCount++
          } else {
            await markPicklistSynced(id)
            successCount++
          }
        } catch (err) {
          console.error('[SyncBanner] Error syncing picklist:', err)
          failCount++
        }
      }

      // Sync prescouting entries
      for (const entry of prescoutingEntries) {
        try {
          const { id, synced: _s, ...record } = entry
          console.log('[SyncBanner] Syncing prescouting entry:', id)
          const { error } = await supabase.from('prescouting').upsert({ id, ...record })
          if (error) {
            console.error('[SyncBanner] Prescouting entry sync failed:', id, error.message)
            failCount++
          } else {
            await markPrescoutingEntrySynced(id)
            successCount++
          }
        } catch (err) {
          console.error('[SyncBanner] Error syncing prescouting entry:', err)
          failCount++
        }
      }

      console.log('[SyncBanner] Sync completed:', { successCount, failCount })

      if (failCount > 0) {
        setSyncError(`${failCount} failed`)
      }
    } catch (err) {
      console.error('[SyncBanner] Sync failed:', err)
      setSyncError('Sync failed')
    } finally {
      await refreshCount()
      setSyncing(false)
    }
  }

  if (loading || (count === 0 && !isOffline)) return null

  return (
    <div className="sync-banner">
      {isOffline && <span className="offline-badge">Offline</span>}
      {count > 0 && (
        <>
          <span>
            {count} pending
            {syncError && <span className="sync-error"> ({syncError})</span>}
          </span>
          <button className="sync-btn" onClick={handleSync} disabled={syncing || isOffline || !user}>
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        </>
      )}
    </div>
  )
}

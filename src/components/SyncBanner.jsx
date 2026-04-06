'use client'

import { useState, useEffect, useCallback } from 'react'
import { getUnsyncedCount, getUnsyncedQualEntries, getUnsyncedTeamNotes, getUnsyncedPicklists, markQualEntrySynced, markTeamNoteSynced, markPicklistSynced } from '@/lib/indexeddb'
import { supabase } from '@/lib/supabase'

export default function SyncBanner() {
  const [count, setCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [syncError, setSyncError] = useState(null)

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

    refreshCount()

    window.addEventListener('beanscout:saved', refreshCount)
    return () => window.removeEventListener('beanscout:saved', refreshCount)
  }, [refreshCount])

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    let successCount = 0
    let failCount = 0

    try {
      console.log('[SyncBanner] Starting sync...')
      const [qualEntries, teamNotes, picklists] = await Promise.all([
        getUnsyncedQualEntries(),
        getUnsyncedTeamNotes(),
        getUnsyncedPicklists(),
      ])

      console.log('[SyncBanner] Found entries to sync:', {
        qualEntries: qualEntries.length,
        teamNotes: teamNotes.length,
        picklists: picklists.length
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

  if (loading || count === 0) return null

  return (
    <div className="sync-banner">
      <span>
        {count} pending
        {syncError && <span className="sync-error"> ({syncError})</span>}
      </span>
      <button className="sync-btn" onClick={handleSync} disabled={syncing}>
        {syncing ? 'Syncing...' : 'Sync'}
      </button>
    </div>
  )
}

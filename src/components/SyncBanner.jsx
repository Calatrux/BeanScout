'use client'

import { useState, useEffect, useCallback } from 'react'
import { getUnsyncedCount, getUnsyncedQualEntries, getUnsyncedTeamNotes, markQualEntrySynced, markTeamNoteSynced } from '@/lib/indexeddb'
import { supabase } from '@/lib/supabase'

export default function SyncBanner() {
  const [count, setCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [loading, setLoading] = useState(true)

  const refreshCount = useCallback(async () => {
    try {
      console.log('[SyncBanner] Refreshing unsynced count...')
      const n = await getUnsyncedCount()
      console.log('[SyncBanner] Unsynced count:', n)
      setCount(n)
    } catch (err) {
      console.error('[SyncBanner] Failed to get unsynced count:', err)
      // Don't block the UI if IndexedDB fails
      setCount(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Make this non-blocking - don't wait for it to complete before rendering
    refreshCount()

    // Re-check after any form submission
    window.addEventListener('beanscout:saved', refreshCount)
    return () => window.removeEventListener('beanscout:saved', refreshCount)
  }, [refreshCount])

  const handleSync = async () => {
    setSyncing(true)
    try {
      console.log('[SyncBanner] Starting sync...')
      const [qualEntries, teamNotes] = await Promise.all([
        getUnsyncedQualEntries(),
        getUnsyncedTeamNotes(),
      ])

      console.log('[SyncBanner] Found entries to sync:', { qualEntries: qualEntries.length, teamNotes: teamNotes.length })

      for (const entry of qualEntries) {
        const { id, synced: _s, ...record } = entry
        const { error } = await supabase.from('qual_scouting').upsert({ id, ...record })
        if (!error) await markQualEntrySynced(id)
      }

      for (const note of teamNotes) {
        const { id, synced: _s, ...record } = note
        const { error } = await supabase.from('team_notes').upsert({ id, ...record })
        if (!error) await markTeamNoteSynced(id)
      }

      console.log('[SyncBanner] Sync completed successfully')
    } catch (err) {
      console.error('[SyncBanner] Sync failed:', err)
    } finally {
      await refreshCount()
      setSyncing(false)
    }
  }

  // Don't show anything while loading or if no items to sync
  if (loading || count === 0) return null

  return (
    <div className="sync-banner">
      <span>{count} record{count !== 1 ? 's' : ''} pending sync</span>
      <button className="sync-btn" onClick={handleSync} disabled={syncing}>
        {syncing ? 'Syncing...' : 'Sync now'}
      </button>
    </div>
  )
}

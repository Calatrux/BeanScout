'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { saveTeamNote, markTeamNoteSynced } from '@/lib/indexeddb'
import { getEventTeams, getEventInfo } from '@/lib/tba'
import { getCachedEventData, cacheEventData, getCachedTeams } from '@/lib/tba-cache'
import { useAuth } from '@/lib/auth-context'

export default function TeamNotesForm() {
  const { profile } = useAuth()

  // Event state
  const [eventKey, setEventKey] = useState('')
  const [eventInfo, setEventInfo] = useState(null)
  const [teams, setTeams] = useState([])
  const [loadingEvent, setLoadingEvent] = useState(false)
  const [eventError, setEventError] = useState(null)

  // Form state
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [teamSearch, setTeamSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [matchNumber, setMatchNumber] = useState('')
  const [note, setNote] = useState('')
  const [isUpdate, setIsUpdate] = useState(false)
  const [status, setStatus] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const dropdownRef = useRef(null)

  // Get scouter name from profile
  const scouterName = profile
    ? `${profile.first_name} ${profile.last_name}`.trim() || profile.username
    : ''

  // Restore persisted event key
  useEffect(() => {
    const event = localStorage.getItem('bs_event_key')
    if (event) setEventKey(event)
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Load event data
  const loadEventData = useCallback(async (key) => {
    if (!key || key.length < 4) {
      setEventInfo(null)
      setTeams([])
      setEventError(null)
      return
    }

    console.log('[TeamNotes] Loading event:', key)
    setLoadingEvent(true)
    setEventError(null)

    try {
      // Try cache first
      console.log('[TeamNotes] Checking cache...')
      const cached = await getCachedEventData(key)
      if (cached && cached.teams && cached.teams.length > 0) {
        console.log('[TeamNotes] Using cached data')
        setEventInfo(cached.info)
        setTeams(cached.teams || [])
        localStorage.setItem('bs_event_key', key)
        setLoadingEvent(false)
        return
      }
      console.log('[TeamNotes] Cache miss or incomplete, fetching fresh data')

      // Fetch from TBA
      console.log('[TeamNotes] Fetching from TBA...')
      const [info, teamsData] = await Promise.all([
        getEventInfo(key),
        getEventTeams(key),
      ])

      console.log('[TeamNotes] TBA data received:', { info, teamCount: teamsData.length })
      setEventInfo(info)
      setTeams(teamsData)
      localStorage.setItem('bs_event_key', key)

      // Cache for offline use (don't wait for it, merge with existing cache)
      const existingCache = await getCachedEventData(key)
      cacheEventData(key, info, existingCache?.matches || [], teamsData).catch(err => {
        console.error('[TeamNotes] Cache write failed (non-fatal):', err)
      })
    } catch (err) {
      console.error('[TeamNotes] Event load error:', err)
      // Try to get teams from cache even if refresh failed
      const cachedTeams = await getCachedTeams(key)
      if (cachedTeams) {
        console.log('[TeamNotes] Using stale cached teams')
        setTeams(cachedTeams)
        setEventError('Using cached team list. Could not refresh from TBA.')
      } else {
        setEventError(`Could not load event: ${err.message || 'Unknown error'}`)
        setTeams([])
      }
      setEventInfo(null)
    } finally {
      console.log('[TeamNotes] Load complete, setting loading to false')
      setLoadingEvent(false)
    }
  }, [])

  // Debounced event loading
  useEffect(() => {
    const timer = setTimeout(() => {
      if (eventKey) {
        loadEventData(eventKey)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [eventKey, loadEventData])

  // Filter teams based on search
  const filteredTeams = teams.filter((team) => {
    const search = teamSearch.toLowerCase()
    return (
      String(team.number).includes(search) ||
      team.name?.toLowerCase().includes(search)
    )
  })

  const handleTeamSelect = (team) => {
    setSelectedTeam(team)
    setTeamSearch(String(team.number))
    setDropdownOpen(false)
  }

  const handleTeamSearchChange = (value) => {
    setTeamSearch(value)
    setSelectedTeam(null)
    setDropdownOpen(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setStatus(null)

    if (!selectedTeam) {
      setStatus({ type: 'error', message: 'Please select a team from the dropdown.' })
      return
    }

    if (!note.trim() || !scouterName || !eventKey.trim()) {
      setStatus({ type: 'error', message: 'Event key and note are required. Make sure you are signed in.' })
      return
    }

    setSubmitting(true)
    localStorage.setItem('bs_event_key', eventKey.trim())

    try {
      const id = crypto.randomUUID()
      const entry = {
        id,
        event_key: eventKey.trim(),
        team_number: selectedTeam.number,
        match_number: matchNumber ? parseInt(matchNumber, 10) : null,
        note: note.trim(),
        is_update: isUpdate,
        scouter_name: scouterName,
        created_at: new Date().toISOString(),
        synced: false,
      }

      console.log('[TeamNotes] Saving entry to IndexedDB...')
      await saveTeamNote(entry)
      console.log('[TeamNotes] Entry saved to IndexedDB successfully')

      console.log('[TeamNotes] Attempting Supabase sync...')
      const { synced: _s, ...supabaseRecord } = entry
      try {
        const syncPromise = supabase.from('team_notes').insert(supabaseRecord)
        const { error } = await Promise.race([
          syncPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 5000))
        ])

        if (error) {
          console.log('[TeamNotes] Supabase sync failed:', error.message)
          window.dispatchEvent(new Event('beanscout:saved'))
          setStatus({
            type: 'warning',
            message: `Saved locally. Will sync when online. (${error.message})`,
          })
        } else {
          console.log('[TeamNotes] Supabase sync successful')
          await markTeamNoteSynced(id)
          window.dispatchEvent(new Event('beanscout:saved'))
          setStatus({
            type: 'success',
            message: `Note for team ${selectedTeam.number} saved and synced.${isUpdate ? ' (Marked as update)' : ''}`,
          })
        }
      } catch (syncErr) {
        console.log('[TeamNotes] Supabase sync timed out or failed:', syncErr.message)
        window.dispatchEvent(new Event('beanscout:saved'))
        setStatus({
          type: 'warning',
          message: 'Saved locally. Will sync when online.',
        })
      }

      // Reset note-specific fields, keep persistent context
      setSelectedTeam(null)
      setTeamSearch('')
      setMatchNumber('')
      setNote('')
      setIsUpdate(false)
    } catch (err) {
      console.error('[TeamNotes] Submit error:', err)
      setStatus({
        type: 'error',
        message: `Failed to save note: ${err.message}. Please try again.`
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <h1 className="form-title">Team Note</h1>

      {/* Event key */}
      <div className="field">
        <label htmlFor="tn-event">Event Key</label>
        <input
          id="tn-event"
          type="text"
          value={eventKey}
          onChange={(e) => setEventKey(e.target.value.toLowerCase())}
          placeholder="e.g. 2026gagai"
          autoComplete="off"
        />
      </div>

      {/* Event info banner */}
      {loadingEvent && (
        <div className="loading-text">
          <span className="loading-spinner" />
          Loading event data...
        </div>
      )}

      {eventError && (
        <div className="status warning">{eventError}</div>
      )}

      {eventInfo && !loadingEvent && (
        <div className="event-banner">
          <div className="event-banner-info">
            <span className="event-banner-name">{eventInfo.name}</span>
            <span className="event-banner-key">{eventInfo.key} | {teams.length} teams</span>
          </div>
        </div>
      )}

      {/* Team selector + Match */}
      <div className="form-row">
        <div className="field" ref={dropdownRef}>
          <label htmlFor="tn-team">Team</label>
          <div className="team-search-container">
            <input
              id="tn-team"
              type="text"
              value={teamSearch}
              onChange={(e) => handleTeamSearchChange(e.target.value)}
              onFocus={() => teams.length > 0 && setDropdownOpen(true)}
              placeholder={teams.length > 0 ? 'Search teams...' : 'Load event first'}
              autoComplete="off"
              disabled={teams.length === 0}
            />
            {dropdownOpen && filteredTeams.length > 0 && (
              <div className="team-dropdown">
                {filteredTeams.slice(0, 8).map((team) => (
                  <button
                    key={team.number}
                    type="button"
                    className={`team-dropdown-item${selectedTeam?.number === team.number ? ' selected' : ''}`}
                    onClick={() => handleTeamSelect(team)}
                  >
                    <span className="team-dropdown-number">{team.number}</span>
                    <span className="team-dropdown-name">{team.name}</span>
                  </button>
                ))}
                {filteredTeams.length > 8 && (
                  <div className="team-dropdown-hint">
                    {filteredTeams.length - 8} more teams. Keep typing to narrow results.
                  </div>
                )}
              </div>
            )}
            {dropdownOpen && teamSearch && filteredTeams.length === 0 && (
              <div className="team-dropdown">
                <div className="team-dropdown-hint">No teams found</div>
              </div>
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="tn-match">
            Match # <span style={{ color: 'var(--text-dim)', textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
          </label>
          <input
            id="tn-match"
            type="number"
            value={matchNumber}
            onChange={(e) => setMatchNumber(e.target.value)}
            placeholder="leave blank if general"
            min="1"
          />
        </div>
      </div>

      {/* Note */}
      <div className="field">
        <label htmlFor="tn-note">Note</label>
        <textarea
          id="tn-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you observe? Be specific: what happened, when, and why it matters."
          rows={5}
        />
      </div>

      {/* Is Update toggle */}
      <div
        role="checkbox"
        aria-checked={isUpdate}
        tabIndex={0}
        className={`toggle-field${isUpdate ? ' active' : ''}`}
        onClick={() => setIsUpdate((v) => !v)}
        onKeyDown={(e) => e.key === ' ' || e.key === 'Enter' ? setIsUpdate((v) => !v) : null}
      >
        <div className="toggle-switch" />
        <div className="toggle-label">
          <div className="toggle-label-title">Mark as Update</div>
          <div className="toggle-label-desc">
            This note revises or supersedes an earlier observation. Updates are weighted
            more heavily when analyzing a team. Use this for corrections or significant
            new findings.
          </div>
        </div>
      </div>

      {/* Scouter display (read-only) */}
      {scouterName && (
        <div className="scouter-display">
          Scouting as <strong>{scouterName}</strong>
        </div>
      )}

      {status && (
        <div className={`status ${status.type}`}>{status.message}</div>
      )}

      <button type="submit" className="submit-btn" disabled={submitting}>
        {submitting ? 'Saving...' : 'Submit Note'}
      </button>
    </form>
  )
}

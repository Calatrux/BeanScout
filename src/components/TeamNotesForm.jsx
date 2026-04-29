'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { saveTeamNote, markTeamNoteSynced } from '@/lib/indexeddb'
import { getEventMatches, getEventInfo, getEventTeams } from '@/lib/tba'
import { getCachedEventData, cacheEventData } from '@/lib/tba-cache'
import { useAuth } from '@/lib/auth-context'

const DEFENSE_EFFECTIVENESS = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'decent', label: 'Decent' },
  { value: 'impactful', label: 'Impactful' },
  { value: 'shutdown', label: 'Shutdown' },
]

function makeTeams(numbers) {
  return numbers.map((num) => ({
    number: num,
    notes: '',
    isUpdate: false,
    noChange: false,
    playedDefense: false,
    defenseEffectiveness: null,
    starred: false,
  }))
}

export default function TeamNotesForm() {
  const { profile } = useAuth()

  // Event state
  const [eventKey, setEventKey] = useState('')
  const [eventInfo, setEventInfo] = useState(null)
  const [matches, setMatches] = useState([])
  const [loadingEvent, setLoadingEvent] = useState(false)
  const [eventError, setEventError] = useState(null)

  // Form state
  const [selectedMatch, setSelectedMatch] = useState('')
  const [alliance, setAlliance] = useState('red')
  const [teams, setTeams] = useState([])
  const [status, setStatus] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const scouterName = profile
    ? `${profile.first_name} ${profile.last_name}`.trim() || profile.username
    : ''

  // Restore persisted event key and alliance
  useEffect(() => {
    const event = localStorage.getItem('bs_event_key') || process.env.NEXT_PUBLIC_DEFAULT_EVENT_KEY || ''
    const savedAlliance = localStorage.getItem('bs_alliance')
    if (event) setEventKey(event)
    if (savedAlliance) setAlliance(savedAlliance)
  }, [])

  const loadEventData = useCallback(async (key) => {
    if (!key || key.length < 4) {
      setEventInfo(null)
      setMatches([])
      setEventError(null)
      return
    }

    setLoadingEvent(true)
    setEventError(null)

    try {
      const cached = await getCachedEventData(key)
      if (cached && cached.matches && cached.matches.length > 0) {
        setEventInfo(cached.info)
        setMatches(cached.matches)
        localStorage.setItem('bs_event_key', key)
        setLoadingEvent(false)
        return
      }

      const [info, matchData, teamsData] = await Promise.all([
        getEventInfo(key),
        getEventMatches(key, true),
        getEventTeams(key),
      ])

      setEventInfo(info)
      setMatches(matchData)
      localStorage.setItem('bs_event_key', key)

      cacheEventData(key, info, matchData, teamsData).catch(err => {
        console.error('[TeamNotes] Cache write failed (non-fatal):', err)
      })
    } catch (err) {
      console.error('[TeamNotes] Event load error:', err)
      setEventError(`Could not load event: ${err.message || 'Unknown error'}`)
      setEventInfo(null)
      setMatches([])
    } finally {
      setLoadingEvent(false)
    }
  }, [])

  // Debounced event loading
  useEffect(() => {
    const timer = setTimeout(() => {
      if (eventKey) loadEventData(eventKey)
    }, 500)
    return () => clearTimeout(timer)
  }, [eventKey, loadEventData])

  // Auto-select first match when matches load
  useEffect(() => {
    if (matches.length > 0 && !selectedMatch) {
      setSelectedMatch(String(matches[0].matchNumber))
    }
  }, [matches, selectedMatch])

  // Update teams when match or alliance changes
  useEffect(() => {
    if (!selectedMatch || matches.length === 0) { setTeams([]); return }
    const match = matches.find(m => String(m.matchNumber) === selectedMatch)
    if (match) {
      setTeams(makeTeams(alliance === 'red' ? match.red : match.blue))
    }
  }, [selectedMatch, alliance, matches])

  // Persist alliance choice
  useEffect(() => {
    localStorage.setItem('bs_alliance', alliance)
  }, [alliance])

  const updateNotes = (index, value) => {
    setTeams(prev => prev.map((t, i) => i === index ? { ...t, notes: value } : t))
  }

  const updateFlag = (index, field, value) => {
    setTeams(prev => prev.map((t, i) => i === index ? { ...t, [field]: value } : t))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setStatus(null)

    if (!eventKey.trim() || !selectedMatch || !scouterName) {
      setStatus({ type: 'error', message: 'Event and match are required. Make sure you are signed in.' })
      return
    }
    if (teams.length !== 3) {
      setStatus({ type: 'error', message: 'Match data not loaded. Select a valid match.' })
      return
    }

    setSubmitting(true)

    try {
      const matchNum = parseInt(selectedMatch, 10)
      const entries = teams
        .filter(team => !team.noChange)
        .map(team => ({
          id: crypto.randomUUID(),
          event_key: eventKey.trim(),
          team_number: team.number,
          match_number: matchNum,
          note: team.notes.trim(),
          is_update: team.isUpdate,
          played_defense: team.playedDefense,
          defense_effectiveness: team.playedDefense ? team.defenseEffectiveness : null,
          starred: team.starred || false,
          scouter_name: scouterName,
          created_at: new Date().toISOString(),
          synced: false,
        }))

      // Save all to IndexedDB first
      await Promise.all(entries.map(entry => saveTeamNote(entry)))

      // Attempt Supabase sync with timeout
      let syncFailed = false
      let syncError = null
      try {
        const supabaseRecords = entries.map(({ synced, ...rest }) => rest)
        const syncPromise = supabase.from('team_notes').insert(supabaseRecords)
        const { error } = await Promise.race([
          syncPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 5000))
        ])
        if (error) { syncFailed = true; syncError = error.message }
        else {
          await Promise.all(entries.map(entry => markTeamNoteSynced(entry.id)))
        }
      } catch (syncErr) {
        syncFailed = true; syncError = syncErr.message
      }

      window.dispatchEvent(new Event('beanscout:saved'))

      if (syncFailed) {
        setStatus({ type: 'warning', message: `Saved locally. Will sync when online.${syncError ? ` (${syncError})` : ''}` })
      } else {
        setStatus({ type: 'success', message: `Match ${matchNum} (${alliance}) notes saved and synced.` })
      }

      // Advance to next match
      const currentIndex = matches.findIndex(m => String(m.matchNumber) === selectedMatch)
      if (currentIndex >= 0 && currentIndex < matches.length - 1) {
        setSelectedMatch(String(matches[currentIndex + 1].matchNumber))
      }
    } catch (err) {
      console.error('[TeamNotes] Submit error:', err)
      setStatus({ type: 'error', message: `Failed to save notes: ${err.message}. Please try again.` })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="form-header-with-scouter">
        <h1 className="form-title">Team Notes</h1>
        {scouterName && (
          <div className="scouter-display">
            Scouting as <strong>{scouterName}</strong>
          </div>
        )}
      </div>

      {/* Event Key */}
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

      {loadingEvent && (
        <div className="loading-text">
          <span className="loading-spinner" />
          Loading event data...
        </div>
      )}

      {eventError && <div className="status error">{eventError}</div>}

      {eventInfo && !loadingEvent && (
        <div className="event-banner">
          <div className="event-banner-info">
            <span className="event-banner-name">{eventInfo.name}</span>
            <span className="event-banner-key">{eventInfo.key} | {matches.length} qual matches</span>
          </div>
        </div>
      )}

      {/* Match selector */}
      {matches.length > 0 && (
        <div className="field">
          <label htmlFor="tn-match">Match</label>
          <select
            id="tn-match"
            value={selectedMatch}
            onChange={(e) => setSelectedMatch(e.target.value)}
          >
            <option value="">Select a match...</option>
            {matches.map((match) => (
              <option key={match.key} value={String(match.matchNumber)}>
                Qual {match.matchNumber}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Alliance */}
      {selectedMatch && (
        <div className="field">
          <label>Alliance You&apos;re Scouting</label>
          <div className="alliance-toggle">
            <button
              type="button"
              className={`alliance-btn red${alliance === 'red' ? ' active' : ''}`}
              onClick={() => setAlliance('red')}
            >
              Red
            </button>
            <button
              type="button"
              className={`alliance-btn blue${alliance === 'blue' ? ' active' : ''}`}
              onClick={() => setAlliance('blue')}
            >
              Blue
            </button>
          </div>
        </div>
      )}

      {/* Team notes cards */}
      {teams.length === 3 && (
        <div className="teams-section">
          {teams.map((team, index) => (
            <div
              key={`${selectedMatch}-${alliance}-${team.number}`}
              className={`team-card ${alliance}`}
            >
              <div className="team-header">
                <span className="team-number">{team.number}</span>
                <button
                  type="button"
                  className={`star-btn${team.starred ? ' active' : ''}`}
                  onClick={() => updateFlag(index, 'starred', !team.starred)}
                  aria-label={`Star team ${team.number}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={team.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                  </svg>
                </button>
                <div className="team-status-buttons">
                  <label className="status-checkbox-label">
                    <input
                      type="checkbox"
                      checked={team.isUpdate}
                      onChange={(e) => updateFlag(index, 'isUpdate', e.target.checked)}
                    />
                    Significant Update
                  </label>
                  <label className="status-checkbox-label">
                    <input
                      type="checkbox"
                      checked={team.noChange}
                      onChange={(e) => updateFlag(index, 'noChange', e.target.checked)}
                    />
                    No Significant Change
                  </label>
                </div>
              </div>
              {!team.noChange && (
                <textarea
                  className="team-notes"
                  value={team.notes}
                  onChange={(e) => updateNotes(index, e.target.value)}
                  placeholder={`Notes for team ${team.number}…`}
                  rows={4}
                />
              )}

              {/* Defense tracking */}
              <div className="defense-section">
                <button
                  type="button"
                  className={`defense-toggle-btn${team.playedDefense ? ' active' : ''}`}
                  onClick={() => {
                    updateFlag(index, 'playedDefense', !team.playedDefense)
                    if (team.playedDefense) updateFlag(index, 'defenseEffectiveness', null)
                  }}
                >
                  {team.playedDefense ? '🛡 Played Defense' : '🛡 Played Defense?'}
                </button>
                {team.playedDefense && (
                  <div className="defense-effectiveness-row">
                    <span className="defense-effectiveness-label">How effective?</span>
                    <div className="defense-effectiveness-buttons">
                      {DEFENSE_EFFECTIVENESS.map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          data-value={value}
                          className={`defense-effectiveness-btn${team.defenseEffectiveness === value ? ' active' : ''}`}
                          onClick={() => updateFlag(index, 'defenseEffectiveness', team.defenseEffectiveness === value ? null : value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {status && <div className={`status ${status.type}`}>{status.message}</div>}

      <button
        type="submit"
        className="submit-btn"
        disabled={submitting || teams.length !== 3}
      >
        {submitting ? 'Saving...' : 'Submit Notes'}
      </button>
    </form>
  )
}

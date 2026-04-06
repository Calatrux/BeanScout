'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { saveQualEntry, markQualEntrySynced } from '@/lib/indexeddb'
import { getEventMatches, getEventInfo, getEventTeams } from '@/lib/tba'
import { getCachedEventData, cacheEventData } from '@/lib/tba-cache'
import { useAuth } from '@/lib/auth-context'

// Characterization tags organized by category
const CHARACTERIZATION_TAGS = {
  offense: [
    'High BPS Shooter',
    'Accurate Scorer',
    'Fast Cycling',
    'High Capacity',
    'Inaccurate Scorer',
    'Slow Cycling'
  ],
  defense: [
    'Aggressive Defender',
    'Shutdown Defense',
    'Weak Defense'
  ],
  mobility: [
    'Agile Maneuvering',
    'Slow Moving',
    'Good Driver',
    'Poor Driver'
  ],
  reliability: [
    'Very Reliable',
    'Breakdown Prone',
    'Inconsistent'
  ]
}

function makeTeams(numbers) {
  return numbers.map((num) => ({ number: num, notes: '', noShow: false, incap: false, tags: [] }))
}

export default function QualScoutForm() {
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

  // Drag state
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const dragRef = useRef(null)

  // Tag category state
  const [expandedTagCategory, setExpandedTagCategory] = useState(null)

  // Get scouter name from profile
  const scouterName = profile
    ? `${profile.first_name} ${profile.last_name}`.trim() || profile.username
    : ''

  // Restore persisted event key and alliance
  useEffect(() => {
    const event = localStorage.getItem('bs_event_key')
    const savedAlliance = localStorage.getItem('bs_alliance')
    if (event) setEventKey(event)
    if (savedAlliance) setAlliance(savedAlliance)
  }, [])

  // Load event data when event key changes (with debounce)
  const loadEventData = useCallback(async (key) => {
    if (!key || key.length < 4) {
      setEventInfo(null)
      setMatches([])
      setEventError(null)
      return
    }

    console.log('[QualScout] Loading event:', key)
    setLoadingEvent(true)
    setEventError(null)

    try {
      // Try cache first
      console.log('[QualScout] Checking cache...')
      const cached = await getCachedEventData(key)
      if (cached && cached.matches && cached.matches.length > 0) {
        console.log('[QualScout] Using cached data')
        setEventInfo(cached.info)
        setMatches(cached.matches)
        localStorage.setItem('bs_event_key', key)
        setLoadingEvent(false)
        return
      }
      console.log('[QualScout] Cache miss or incomplete, fetching fresh data')

      // Fetch from TBA
      console.log('[QualScout] Fetching from TBA...')
      const [info, matchData, teamsData] = await Promise.all([
        getEventInfo(key),
        getEventMatches(key, true),
        getEventTeams(key),
      ])

      console.log('[QualScout] TBA data received:', { info, matchCount: matchData.length, teamCount: teamsData.length })
      setEventInfo(info)
      setMatches(matchData)
      localStorage.setItem('bs_event_key', key)

      // Cache for offline use (don't wait for it)
      cacheEventData(key, info, matchData, teamsData).catch(err => {
        console.error('[QualScout] Cache write failed (non-fatal):', err)
      })
    } catch (err) {
      console.error('[QualScout] Event load error:', err)
      setEventError(`Could not load event: ${err.message || 'Unknown error'}`)
      setEventInfo(null)
      setMatches([])
    } finally {
      console.log('[QualScout] Load complete, setting loading to false')
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

  // Auto-select first match when matches load
  useEffect(() => {
    if (matches.length > 0 && !selectedMatch) {
      setSelectedMatch(String(matches[0].matchNumber))
    }
  }, [matches, selectedMatch])

  // Update teams when match or alliance changes
  useEffect(() => {
    if (!selectedMatch || matches.length === 0) {
      setTeams([])
      return
    }

    const match = matches.find(m => String(m.matchNumber) === selectedMatch)
    if (match) {
      const teamNumbers = alliance === 'red' ? match.red : match.blue
      setTeams(makeTeams(teamNumbers))
    }
  }, [selectedMatch, alliance, matches])

  // Persist alliance choice
  useEffect(() => {
    localStorage.setItem('bs_alliance', alliance)
  }, [alliance])

  const moveTeam = (index, dir) => {
    const target = index + dir
    if (target < 0 || target >= teams.length) return
    setTeams((prev) => {
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const updateNotes = (index, value) => {
    setTeams((prev) => prev.map((t, i) => (i === index ? { ...t, notes: value } : t)))
  }

  const updateTeamFlag = (index, field, value) => {
    setTeams((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)))
  }

  const toggleTag = (teamIndex, tag) => {
    setTeams((prev) => prev.map((team, i) => {
      if (i !== teamIndex) return team
      const currentTags = team.tags || []
      const hasTag = currentTags.includes(tag)
      const newTags = hasTag
        ? currentTags.filter(t => t !== tag)
        : [...currentTags, tag]
      return { ...team, tags: newTags }
    }))
  }

  const toggleTagCategory = (category) => {
    setExpandedTagCategory(expandedTagCategory === category ? null : category)
  }

  // Drag and drop handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index)
    dragRef.current = index
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', index)
  }

  const handleDragOver = (e, index) => {
    e.preventDefault()
    if (dragRef.current !== index) {
      setDragOverIndex(index)
    }
  }

  const handleDragLeave = () => {
    setDragOverIndex(null)
  }

  const handleDrop = (e, dropIndex) => {
    e.preventDefault()
    const dragIndex = dragRef.current
    if (dragIndex === null || dragIndex === dropIndex) return

    setTeams((prev) => {
      const next = [...prev]
      const [dragged] = next.splice(dragIndex, 1)
      next.splice(dropIndex, 0, dragged)
      return next
    })
    setDraggedIndex(null)
    setDragOverIndex(null)
    dragRef.current = null
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
    dragRef.current = null
  }

  // Touch drag handlers for mobile
  const handleTouchStart = (e, index) => {
    dragRef.current = index
    setDraggedIndex(index)
  }

  const handleTouchMove = (e) => {
    if (dragRef.current === null) return

    const touch = e.touches[0]
    const elements = document.elementsFromPoint(touch.clientX, touch.clientY)
    const card = elements.find(el => el.classList.contains('team-card'))
    if (card) {
      const idx = parseInt(card.dataset.index, 10)
      if (!isNaN(idx) && idx !== dragRef.current) {
        setDragOverIndex(idx)
      }
    }
  }

  const handleTouchEnd = () => {
    if (dragRef.current !== null && dragOverIndex !== null && dragRef.current !== dragOverIndex) {
      setTeams((prev) => {
        const next = [...prev]
        const [dragged] = next.splice(dragRef.current, 1)
        next.splice(dragOverIndex, 0, dragged)
        return next
      })
    }
    setDraggedIndex(null)
    setDragOverIndex(null)
    dragRef.current = null
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
      const id = crypto.randomUUID()
      const matchNum = parseInt(selectedMatch, 10)
      const entry = {
        id,
        event_key: eventKey.trim(),
        match_number: matchNum,
        alliance,
        team1_number: teams[0].number,
        team1_notes: teams[0].notes,
        team1_no_show: teams[0].noShow,
        team1_incap: teams[0].incap,
        team1_tags: teams[0].tags || [],
        team2_number: teams[1].number,
        team2_notes: teams[1].notes,
        team2_no_show: teams[1].noShow,
        team2_incap: teams[1].incap,
        team2_tags: teams[1].tags || [],
        team3_number: teams[2].number,
        team3_notes: teams[2].notes,
        team3_no_show: teams[2].noShow,
        team3_incap: teams[2].incap,
        team3_tags: teams[2].tags || [],
        scouter_name: scouterName,
        created_at: new Date().toISOString(),
        synced: false,
      }

      console.log('[QualScout] Saving entry to IndexedDB...')
      // Always write to IndexedDB first
      await saveQualEntry(entry)
      console.log('[QualScout] Entry saved to IndexedDB successfully')

      console.log('[QualScout] Attempting Supabase sync...')
      // Attempt Supabase sync with timeout
      const { synced: _s, ...supabaseRecord } = entry
      try {
        const syncPromise = supabase.from('qual_scouting').insert(supabaseRecord)
        const { error } = await Promise.race([
          syncPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 5000))
        ])

        if (error) {
          console.log('[QualScout] Supabase sync failed:', error.message)
          window.dispatchEvent(new Event('beanscout:saved'))
          setStatus({
            type: 'warning',
            message: `Saved locally. Will sync when online. (${error.message})`,
          })
        } else {
          console.log('[QualScout] Supabase sync successful')
          await markQualEntrySynced(id)
          window.dispatchEvent(new Event('beanscout:saved'))
          setStatus({ type: 'success', message: `Match ${matchNum} (${alliance}) saved and synced.` })
        }
      } catch (syncErr) {
        console.log('[QualScout] Supabase sync timed out or failed:', syncErr.message)
        window.dispatchEvent(new Event('beanscout:saved'))
        setStatus({
          type: 'warning',
          message: 'Saved locally. Will sync when online.',
        })
      }

      // Advance to next match, reset team notes
      const currentIndex = matches.findIndex(m => String(m.matchNumber) === selectedMatch)
      if (currentIndex >= 0 && currentIndex < matches.length - 1) {
        setSelectedMatch(String(matches[currentIndex + 1].matchNumber))
      }
    } catch (err) {
      console.error('[QualScout] Submit error:', err)
      setStatus({
        type: 'error',
        message: `Failed to save match: ${err.message}. Please try again.`
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="form-header-with-scouter">
        <h1 className="form-title">Qual Match Scouting</h1>
        {scouterName && (
          <div className="scouter-display">
            Scouting as <strong>{scouterName}</strong>
          </div>
        )}
      </div>

      {/* Event Key */}
      <div className="field">
        <label htmlFor="qs-event">Event Key</label>
        <input
          id="qs-event"
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
        <div className="status error">{eventError}</div>
      )}

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
          <label htmlFor="qs-match">Match</label>
          <select
            id="qs-match"
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

      {/* Team ranking */}
      {teams.length === 3 && (
        <div className="teams-section">
          <p className="teams-hint">
            Rank teams 1 to 3. Drag or use arrows. Top is rank 1 (best), bottom is rank 3 (worst).
          </p>
          {teams.map((team, index) => (
            <div
              key={`${selectedMatch}-${alliance}-${team.number}`}
              data-index={index}
              className={`team-card ${alliance}${draggedIndex === index ? ' dragging' : ''}${dragOverIndex === index ? ' drag-over' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onTouchStart={(e) => handleTouchStart(e, index)}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{ touchAction: draggedIndex === index ? 'none' : 'auto' }}
            >
              <div className="team-header">
                <span className="drag-handle" aria-label="Drag to reorder">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                    <circle cx="4" cy="3" r="1.5" />
                    <circle cx="10" cy="3" r="1.5" />
                    <circle cx="4" cy="7" r="1.5" />
                    <circle cx="10" cy="7" r="1.5" />
                    <circle cx="4" cy="11" r="1.5" />
                    <circle cx="10" cy="11" r="1.5" />
                  </svg>
                </span>
                <span className={`rank-badge rank-${index + 1}`}>#{index + 1}</span>
                <span className="team-number">{team.number}</span>
                <div className="team-status-buttons">
                  <button
                    type="button"
                    className={`status-toggle-btn${team.noShow ? ' active' : ''}`}
                    onClick={() => updateTeamFlag(index, 'noShow', !team.noShow)}
                    aria-label={`Toggle no-show for team ${team.number}`}
                  >
                    No-Show
                  </button>
                  <button
                    type="button"
                    className={`status-toggle-btn${team.incap ? ' active' : ''}`}
                    onClick={() => updateTeamFlag(index, 'incap', !team.incap)}
                    aria-label={`Toggle incap for team ${team.number}`}
                  >
                    Incap
                  </button>
                </div>
                <div className="move-buttons">
                  <button
                    type="button"
                    className="move-btn"
                    onClick={() => moveTeam(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move team ${team.number} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="move-btn"
                    onClick={() => moveTeam(index, 1)}
                    disabled={index === teams.length - 1}
                    aria-label={`Move team ${team.number} down`}
                  >
                    ↓
                  </button>
                </div>
              </div>
              <textarea
                className="team-notes"
                value={team.notes}
                onChange={(e) => updateNotes(index, e.target.value)}
                placeholder={`Why rank #${index + 1}? What did team ${team.number} do?`}
                rows={3}
              />

              {/* Characterization Tags */}
              <div className="team-tags-section">
                <label className="tags-label">Quick Tags</label>
                <div className="tags-container">
                  {Object.entries(CHARACTERIZATION_TAGS).map(([category, tags]) => {
                    const selectedTags = (team.tags || []).filter(tag => tags.includes(tag))
                    const isExpanded = expandedTagCategory === category

                    return (
                      <div key={category} className="tag-category">
                        <button
                          type="button"
                          className={`tag-category-header${isExpanded ? ' expanded' : ''}${selectedTags.length > 0 ? ' has-selected' : ''}`}
                          onClick={() => toggleTagCategory(category)}
                        >
                          <span className="tag-category-label">
                            {category.charAt(0).toUpperCase() + category.slice(1)}
                          </span>
                          {selectedTags.length > 0 && (
                            <span className="tag-category-count">({selectedTags.length})</span>
                          )}
                          <span className="tag-category-icon">
                            {isExpanded ? '−' : '+'}
                          </span>
                        </button>

                        {/* Show selected tags when collapsed */}
                        {!isExpanded && selectedTags.length > 0 && (
                          <div className="tag-buttons-preview">
                            {selectedTags.map(tag => (
                              <button
                                key={tag}
                                type="button"
                                className="tag-btn active preview"
                                onClick={() => toggleTag(index, tag)}
                                title={`Remove ${tag}`}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Show all tags when expanded */}
                        {isExpanded && (
                          <div className="tag-buttons">
                            {tags.map(tag => (
                              <button
                                key={tag}
                                type="button"
                                className={`tag-btn${(team.tags || []).includes(tag) ? ' active' : ''}`}
                                onClick={() => toggleTag(index, tag)}
                                title={tag}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {status && (
        <div className={`status ${status.type}`}>{status.message}</div>
      )}

      <button
        type="submit"
        className="submit-btn"
        disabled={submitting || teams.length !== 3}
      >
        {submitting ? 'Saving...' : 'Submit Match'}
      </button>
    </form>
  )
}

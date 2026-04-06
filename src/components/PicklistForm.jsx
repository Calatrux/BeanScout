'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { savePicklist, getPicklistsByScouter, deletePicklist, markPicklistSynced } from '@/lib/indexeddb'
import { getEventTeams, getEventInfo } from '@/lib/tba'
import { getCachedEventData, cacheEventData, getCachedTeams } from '@/lib/tba-cache'
import { useAuth } from '@/lib/auth-context'

export default function PicklistForm() {
  const { profile } = useAuth()

  // Event state
  const [eventKey, setEventKey] = useState('')
  const [eventInfo, setEventInfo] = useState(null)
  const [eventTeams, setEventTeams] = useState([])
  const [loadingEvent, setLoadingEvent] = useState(false)
  const [eventError, setEventError] = useState(null)

  // Picklist management state
  const [picklists, setPicklists] = useState([])
  const [activePicklistId, setActivePicklistId] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newPicklistName, setNewPicklistName] = useState('')
  const [editingName, setEditingName] = useState(false)

  // Active picklist state
  const [teams, setTeams] = useState([])
  const [notes, setNotes] = useState([])
  const [newNoteText, setNewNoteText] = useState('')

  // Team search state
  const [teamSearch, setTeamSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  // Drag state
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [touchStartY, setTouchStartY] = useState(null)

  // Status
  const [status, setStatus] = useState(null)

  // Get scouter name from profile
  const scouterName = profile
    ? `${profile.first_name} ${profile.last_name}`.trim() || profile.username
    : ''

  // Get active picklist
  const activePicklist = picklists.find(p => p.id === activePicklistId)

  // Restore persisted event key and load picklists
  useEffect(() => {
    const event = localStorage.getItem('bs_event_key')
    if (event) setEventKey(event)
  }, [])

  // Load picklists for current scouter
  useEffect(() => {
    if (scouterName) {
      loadPicklists()
    }
  }, [scouterName])

  const loadPicklists = async () => {
    if (!scouterName) return
    try {
      const lists = await getPicklistsByScouter(scouterName)
      setPicklists(lists)
      // Auto-select first picklist if available
      if (lists.length > 0 && !activePicklistId) {
        selectPicklist(lists[0])
      }
    } catch (err) {
      console.error('[Picklist] Failed to load picklists:', err)
    }
  }

  const selectPicklist = (picklist) => {
    setActivePicklistId(picklist.id)
    setTeams(picklist.teams || [])
    setNotes(picklist.notes || [])
    setEditingName(false)
  }

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
      setEventTeams([])
      setEventError(null)
      return
    }

    setLoadingEvent(true)
    setEventError(null)

    try {
      const cached = await getCachedEventData(key)
      if (cached && cached.teams && cached.teams.length > 0) {
        setEventInfo(cached.info)
        setEventTeams(cached.teams || [])
        localStorage.setItem('bs_event_key', key)
        setLoadingEvent(false)
        return
      }

      const [info, teamsData] = await Promise.all([
        getEventInfo(key),
        getEventTeams(key),
      ])

      setEventInfo(info)
      setEventTeams(teamsData)
      localStorage.setItem('bs_event_key', key)

      const existingCache = await getCachedEventData(key)
      cacheEventData(key, info, existingCache?.matches || [], teamsData).catch(err => {
        console.error('[Picklist] Cache write failed:', err)
      })
    } catch (err) {
      console.error('[Picklist] Event load error:', err)
      const cachedTeams = await getCachedTeams(key)
      if (cachedTeams) {
        setEventTeams(cachedTeams)
        setEventError('Using cached team list.')
      } else {
        setEventError(`Could not load event: ${err.message || 'Unknown error'}`)
        setEventTeams([])
      }
      setEventInfo(null)
    } finally {
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

  // Filter teams for search (excluding already added teams)
  const addedTeamNumbers = teams.map(t => t.number)
  const filteredTeams = eventTeams.filter((team) => {
    if (addedTeamNumbers.includes(team.number)) return false
    const search = teamSearch.toLowerCase()
    return (
      String(team.number).includes(search) ||
      team.name?.toLowerCase().includes(search)
    )
  })

  // Save picklist (called explicitly after changes, not auto-save)
  const saveCurrentPicklist = useCallback(async (newTeams, newNotes) => {
    if (!activePicklist || !scouterName) return

    try {
      const updatedPicklist = {
        ...activePicklist,
        teams: newTeams,
        notes: newNotes,
        updated_at: new Date().toISOString(),
        synced: false,
      }

      await savePicklist(updatedPicklist)
      setPicklists(prev => prev.map(p => p.id === updatedPicklist.id ? updatedPicklist : p))

      // Try to sync to Supabase silently with timeout
      const { synced: _s, ...supabaseRecord } = updatedPicklist
      try {
        const syncPromise = supabase.from('picklists').upsert(supabaseRecord)
        const { error } = await Promise.race([
          syncPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 5000))
        ])
        if (!error) {
          await markPicklistSynced(updatedPicklist.id)
          setPicklists(prev => prev.map(p => p.id === updatedPicklist.id ? { ...p, synced: true } : p))
        } else {
          window.dispatchEvent(new Event('beanscout:saved'))
        }
      } catch {
        window.dispatchEvent(new Event('beanscout:saved'))
      }
    } catch (err) {
      console.error('[Picklist] Save failed:', err)
    }
  }, [activePicklist, scouterName])

  // Create new picklist
  const handleCreatePicklist = async () => {
    if (!newPicklistName.trim() || !scouterName || !eventKey) {
      setStatus({ type: 'error', message: 'Please enter a picklist name and load an event.' })
      return
    }

    const id = crypto.randomUUID()
    const newPicklist = {
      id,
      name: newPicklistName.trim(),
      event_key: eventKey.trim(),
      scouter_name: scouterName,
      teams: [],
      notes: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      synced: false,
    }

    try {
      await savePicklist(newPicklist)
      setPicklists(prev => [...prev, newPicklist])
      selectPicklist(newPicklist)
      setNewPicklistName('')
      setShowCreateModal(false)

      // Try to sync with timeout
      const { synced: _s, ...supabaseRecord } = newPicklist
      try {
        const syncPromise = supabase.from('picklists').upsert(supabaseRecord)
        const { error } = await Promise.race([
          syncPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 5000))
        ])
        if (!error) {
          await markPicklistSynced(id)
          setPicklists(prev => prev.map(p => p.id === id ? { ...p, synced: true } : p))
          setStatus({ type: 'success', message: `Picklist "${newPicklist.name}" created and synced!` })
        } else {
          window.dispatchEvent(new Event('beanscout:saved'))
          setStatus({ type: 'success', message: `Picklist "${newPicklist.name}" created! Will sync later.` })
        }
      } catch {
        window.dispatchEvent(new Event('beanscout:saved'))
        setStatus({ type: 'success', message: `Picklist "${newPicklist.name}" created! Will sync later.` })
      }
    } catch (err) {
      console.error('[Picklist] Create failed:', err)
      setStatus({ type: 'error', message: 'Failed to create picklist.' })
    }
  }

  // Delete picklist
  const handleDeletePicklist = async (picklistId) => {
    if (!confirm('Delete this picklist? This cannot be undone.')) return

    try {
      await deletePicklist(picklistId)
      setPicklists(prev => prev.filter(p => p.id !== picklistId))
      if (activePicklistId === picklistId) {
        setActivePicklistId(null)
        setTeams([])
        setNotes([])
      }
      setStatus({ type: 'success', message: 'Picklist deleted.' })

      // Try to delete from Supabase
      await supabase.from('picklists').delete().eq('id', picklistId)
    } catch (err) {
      console.error('[Picklist] Delete failed:', err)
      setStatus({ type: 'error', message: 'Failed to delete picklist.' })
    }
  }

  // Rename picklist
  const handleRenamePicklist = async (newName) => {
    if (!newName.trim() || !activePicklist) return

    const updatedPicklist = {
      ...activePicklist,
      name: newName.trim(),
      teams,
      notes,
      updated_at: new Date().toISOString(),
      synced: false,
    }

    try {
      await savePicklist(updatedPicklist)
      setPicklists(prev => prev.map(p => p.id === updatedPicklist.id ? updatedPicklist : p))
      setEditingName(false)
      window.dispatchEvent(new Event('beanscout:saved'))
    } catch (err) {
      console.error('[Picklist] Rename failed:', err)
    }
  }

  // Add team to picklist
  const handleAddTeam = (team) => {
    if (teams.some(t => t.number === team.number)) return
    const newTeams = [...teams, { number: team.number, name: team.name }]
    setTeams(newTeams)
    setTeamSearch('')
    setDropdownOpen(false)
    saveCurrentPicklist(newTeams, notes)
  }

  // Remove team from picklist
  const handleRemoveTeam = (teamNumber) => {
    const newTeams = teams.filter(t => t.number !== teamNumber)
    setTeams(newTeams)
    saveCurrentPicklist(newTeams, notes)
  }

  // Drag and drop handlers
  const handleDragStart = (index) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e, index) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const newTeams = [...teams]
    const [draggedItem] = newTeams.splice(draggedIndex, 1)
    newTeams.splice(index, 0, draggedItem)
    setTeams(newTeams)
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    // Save after drag completes
    saveCurrentPicklist(teams, notes)
  }

  // Touch handlers for mobile drag
  const handleTouchStart = (e, index) => {
    setDraggedIndex(index)
    setTouchStartY(e.touches[0].clientY)
  }

  const handleTouchMove = (e, index) => {
    if (draggedIndex === null) return

    const touchY = e.touches[0].clientY
    const deltaY = touchY - touchStartY

    if (Math.abs(deltaY) > 40) {
      const direction = deltaY > 0 ? 1 : -1
      const newIndex = draggedIndex + direction

      if (newIndex >= 0 && newIndex < teams.length) {
        const newTeams = [...teams]
        const [draggedItem] = newTeams.splice(draggedIndex, 1)
        newTeams.splice(newIndex, 0, draggedItem)
        setTeams(newTeams)
        setDraggedIndex(newIndex)
        setTouchStartY(touchY)
      }
    }
  }

  const handleTouchEnd = () => {
    setDraggedIndex(null)
    setTouchStartY(null)
    // Save after touch drag completes
    saveCurrentPicklist(teams, notes)
  }

  // Move team up/down buttons
  const moveTeam = (index, direction) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= teams.length) return

    const newTeams = [...teams]
    const [item] = newTeams.splice(index, 1)
    newTeams.splice(newIndex, 0, item)
    setTeams(newTeams)
    saveCurrentPicklist(newTeams, notes)
  }

  // Add note
  const handleAddNote = () => {
    if (!newNoteText.trim()) return

    const newNote = {
      id: crypto.randomUUID(),
      text: newNoteText.trim(),
      created_at: new Date().toISOString(),
    }

    const newNotes = [newNote, ...notes]
    setNotes(newNotes)
    setNewNoteText('')
    saveCurrentPicklist(teams, newNotes)
  }

  // Delete note
  const handleDeleteNote = (noteId) => {
    const newNotes = notes.filter(n => n.id !== noteId)
    setNotes(newNotes)
    saveCurrentPicklist(teams, newNotes)
  }

  return (
    <div className="picklist-container">
      <div className="picklist-header">
        <h1 className="form-title">Picklists</h1>
        {scouterName && (
          <div className="scouter-display">
            Scouting as <strong>{scouterName}</strong>
          </div>
        )}
      </div>

      {/* Event Key */}
      <div className="field">
        <label htmlFor="pl-event">Event Key</label>
        <input
          id="pl-event"
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

      {eventError && <div className="status warning">{eventError}</div>}

      {eventInfo && !loadingEvent && (
        <div className="event-banner">
          <div className="event-banner-info">
            <span className="event-banner-name">{eventInfo.name}</span>
            <span className="event-banner-key">{eventInfo.key} | {eventTeams.length} teams</span>
          </div>
        </div>
      )}

      {/* Picklist tabs */}
      <div className="picklist-tabs">
        <div className="picklist-tabs-scroll">
          {picklists.filter(p => p.event_key === eventKey).map(picklist => (
            <button
              key={picklist.id}
              type="button"
              className={`picklist-tab${picklist.id === activePicklistId ? ' active' : ''}`}
              onClick={() => selectPicklist(picklist)}
            >
              {picklist.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="picklist-tab-add"
          onClick={() => setShowCreateModal(true)}
          disabled={!eventKey || eventTeams.length === 0}
          title="Create new picklist"
        >
          +
        </button>
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Picklist</h2>
            <div className="field">
              <label htmlFor="new-picklist-name">Picklist Name</label>
              <input
                id="new-picklist-name"
                type="text"
                value={newPicklistName}
                onChange={(e) => setNewPicklistName(e.target.value)}
                placeholder="e.g. Offense, Defense, Climb..."
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button type="button" className="submit-btn" onClick={handleCreatePicklist}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active picklist content */}
      {activePicklist && (
        <div className="picklist-content">
          {/* Picklist header with name and actions */}
          <div className="picklist-name-header">
            {editingName ? (
              <input
                type="text"
                className="picklist-name-input"
                defaultValue={activePicklist.name}
                autoFocus
                onBlur={(e) => handleRenamePicklist(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenamePicklist(e.target.value)
                  if (e.key === 'Escape') setEditingName(false)
                }}
              />
            ) : (
              <h2 className="picklist-name" onClick={() => setEditingName(true)}>
                {activePicklist.name}
                <span className="edit-icon">✎</span>
              </h2>
            )}
            <button
              type="button"
              className="delete-picklist-btn"
              onClick={() => handleDeletePicklist(activePicklist.id)}
              title="Delete picklist"
            >
              🗑
            </button>
          </div>

          {/* Add team search */}
          <div className="field" ref={dropdownRef}>
            <label>Add Team</label>
            <div className="team-search-container">
              <input
                type="text"
                value={teamSearch}
                onChange={(e) => {
                  setTeamSearch(e.target.value)
                  setDropdownOpen(true)
                }}
                onFocus={() => eventTeams.length > 0 && setDropdownOpen(true)}
                placeholder={eventTeams.length > 0 ? 'Search teams to add...' : 'Load event first'}
                autoComplete="off"
                disabled={eventTeams.length === 0}
              />
              {dropdownOpen && filteredTeams.length > 0 && (
                <div className="team-dropdown">
                  {filteredTeams.slice(0, 8).map((team) => (
                    <button
                      key={team.number}
                      type="button"
                      className="team-dropdown-item"
                      onClick={() => handleAddTeam(team)}
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

          {/* Ranked teams list */}
          {teams.length > 0 ? (
            <div className="picklist-teams">
              <label className="picklist-teams-label">Rankings ({teams.length} teams)</label>
              {teams.map((team, index) => (
                <div
                  key={team.number}
                  className={`picklist-team-row${draggedIndex === index ? ' dragging' : ''}`}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  onTouchStart={(e) => handleTouchStart(e, index)}
                  onTouchMove={(e) => handleTouchMove(e, index)}
                  onTouchEnd={handleTouchEnd}
                  style={{ touchAction: draggedIndex === index ? 'none' : 'auto' }}
                >
                  <span className="drag-handle">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <circle cx="4" cy="4" r="1.5" />
                      <circle cx="10" cy="4" r="1.5" />
                      <circle cx="4" cy="8" r="1.5" />
                      <circle cx="10" cy="8" r="1.5" />
                      <circle cx="4" cy="12" r="1.5" />
                      <circle cx="10" cy="12" r="1.5" />
                    </svg>
                  </span>
                  <span className={`rank-badge rank-${Math.min(index + 1, 4)}`}>#{index + 1}</span>
                  <span className="picklist-team-number">{team.number}</span>
                  <span className="picklist-team-name">{team.name}</span>
                  <div className="picklist-team-actions">
                    <button
                      type="button"
                      className="move-btn"
                      onClick={() => moveTeam(index, -1)}
                      disabled={index === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="move-btn"
                      onClick={() => moveTeam(index, 1)}
                      disabled={index === teams.length - 1}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="remove-btn"
                      onClick={() => handleRemoveTeam(team.number)}
                      title="Remove from picklist"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="picklist-empty">
              <p>No teams added yet.</p>
              <p className="hint">Search for teams above to add them to your picklist.</p>
            </div>
          )}

          {/* Notes section */}
          <div className="picklist-notes-section">
            <label className="picklist-notes-label">Notes</label>
            <div className="picklist-new-note">
              <textarea
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                placeholder="Add a note about your rankings, changes, or observations..."
                rows={3}
              />
              <button
                type="button"
                className="add-note-btn"
                onClick={handleAddNote}
                disabled={!newNoteText.trim()}
              >
                Add Note
              </button>
            </div>
            {notes.length > 0 && (
              <div className="picklist-notes-list">
                {notes.map((note) => (
                  <div key={note.id} className="picklist-note">
                    <div className="picklist-note-text">{note.text}</div>
                    <div className="picklist-note-footer">
                      <span className="picklist-note-time">
                        {new Date(note.created_at).toLocaleString()}
                      </span>
                      <button
                        type="button"
                        className="delete-note-btn"
                        onClick={() => handleDeleteNote(note.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* No picklist selected */}
      {!activePicklist && eventKey && eventTeams.length > 0 && (
        <div className="picklist-empty">
          <p>No picklist selected.</p>
          <p className="hint">Create a new picklist using the + button above.</p>
        </div>
      )}

      {status && (
        <div className={`status ${status.type}`}>{status.message}</div>
      )}
    </div>
  )
}

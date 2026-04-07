'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { getEventTeams, getEventInfo } from '@/lib/tba'
import { getCachedEventData, cacheEventData, getCachedTeams } from '@/lib/tba-cache'
import { savePicklist, deletePicklist, markPicklistSynced } from '@/lib/indexeddb'
import { useAuth } from '@/lib/auth-context'
import AutonsTab from '@/components/AutonsTab'

export default function AnalysisDashboard() {
  const { profile } = useAuth()

  // Event state
  const [eventKey, setEventKey] = useState('')
  const [eventInfo, setEventInfo] = useState(null)
  const [eventTeams, setEventTeams] = useState([])
  const [loadingEvent, setLoadingEvent] = useState(false)
  const [eventError, setEventError] = useState(null)

  // Tab state
  const [activeTab, setActiveTab] = useState('rankings')

  // Data state
  const [qualData, setQualData] = useState([])
  const [teamNotes, setTeamNotes] = useState([])
  const [loadingData, setLoadingData] = useState(false)

  // Rankings tab state
  const [expandedTeam, setExpandedTeam] = useState(null)

  // Filtering and sorting state
  const [selectedTags, setSelectedTags] = useState([])
  const [sortMethod, setSortMethod] = useState('avgRank')
  const [sortDirection, setSortDirection] = useState('asc')
  const [showFilters, setShowFilters] = useState(false)

  // Team picklist management state
  const [teamPicklists, setTeamPicklists] = useState([])
  const [activePicklistId, setActivePicklistId] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newPicklistName, setNewPicklistName] = useState('')
  const [editingName, setEditingName] = useState(false)

  // Active team picklist state
  const [picklistTeams, setPicklistTeams] = useState([])
  const [picklistNotes, setPicklistNotes] = useState([])
  const [newNoteText, setNewNoteText] = useState('')
  const [teamSearch, setTeamSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [status, setStatus] = useState(null)

  const dropdownRef = useRef(null)
  const dragRef = useRef(null)

  const isAdmin = profile?.is_admin

  // Get active team picklist
  const activePicklist = teamPicklists.find(p => p.id === activePicklistId)

  // Load team picklists for current event
  useEffect(() => {
    if (eventKey && isAdmin) {
      loadTeamPicklists()
    }
  }, [eventKey, isAdmin])

  const loadTeamPicklists = async () => {
    if (!eventKey || !isAdmin) return
    try {
      console.log('[Admin] Loading team picklists for event:', eventKey)
      const { data, error } = await supabase
        .from('picklists')
        .select('*')
        .eq('event_key', eventKey)
        .eq('scouter_name', 'TEAM_WIDE')
        .order('created_at')

      if (error) throw error

      setTeamPicklists(data || [])
      // Auto-select first picklist if available
      if (data && data.length > 0 && !activePicklistId) {
        selectPicklist(data[0])
      }
    } catch (err) {
      console.error('[Admin] Failed to load team picklists:', err)
    }
  }

  const selectPicklist = (picklist) => {
    console.log('[Admin] Selecting picklist:', picklist.name)
    setActivePicklistId(picklist.id)
    setPicklistTeams(picklist.teams || [])
    setPicklistNotes(picklist.notes || [])
    setEditingName(false)
  }

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
      setEventTeams([])
      setEventError(null)
      return
    }

    setLoadingEvent(true)
    setEventError(null)

    try {
      // Try cache first
      const cached = await getCachedEventData(key)
      if (cached && cached.teams && cached.teams.length > 0) {
        setEventInfo(cached.info)
        setEventTeams(cached.teams || [])
        localStorage.setItem('bs_event_key', key)
        setLoadingEvent(false)
        return
      }

      // Fetch from TBA
      const [info, teamsData] = await Promise.all([
        getEventInfo(key),
        getEventTeams(key),
      ])

      setEventInfo(info)
      setEventTeams(teamsData)
      localStorage.setItem('bs_event_key', key)

      // Cache for offline use
      const existingCache = await getCachedEventData(key)
      cacheEventData(key, info, existingCache?.matches || [], teamsData).catch(err => {
        console.error('[Admin] Cache write failed:', err)
      })
    } catch (err) {
      console.error('[Admin] Event load error:', err)
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

  // Load analysis data when event loads
  useEffect(() => {
    if (eventKey && eventTeams.length > 0) {
      loadAnalysisData(eventKey)
    }
  }, [eventKey, eventTeams.length])

  const loadAnalysisData = async (key) => {
    setLoadingData(true)
    try {
      const [qualResult, notesResult] = await Promise.all([
        supabase.from('qual_scouting').select('*').eq('event_key', key).order('match_number'),
        supabase.from('team_notes').select('*').eq('event_key', key).order('created_at', { ascending: false }),
      ])

      setQualData(qualResult.data || [])
      setTeamNotes(notesResult.data || [])
    } catch (err) {
      console.error('[Admin] Failed to load analysis data:', err)
    } finally {
      setLoadingData(false)
    }
  }

  // Compute team rankings from qual data
  const teamRankings = useMemo(() => {
    if (!qualData.length || !eventTeams.length) return []

    const teamStats = {}

    // Initialize with event teams
    eventTeams.forEach(team => {
      teamStats[team.number] = {
        number: team.number,
        name: team.name,
        rankSum: 0,
        rankCount: 0,
        rankings: [],
        tagCounts: {},
      }
    })

    // Process qual scouting entries
    qualData.forEach(entry => {
      const teams = [
        { number: entry.team1_number, notes: entry.team1_notes, rank: 1, noShow: entry.team1_no_show, incap: entry.team1_incap, tags: entry.team1_tags, path: entry.team1_path || [], crossesMidline: entry.team1_crosses_midline || false },
        { number: entry.team2_number, notes: entry.team2_notes, rank: 2, noShow: entry.team2_no_show, incap: entry.team2_incap, tags: entry.team2_tags, path: entry.team2_path || [], crossesMidline: entry.team2_crosses_midline || false },
        { number: entry.team3_number, notes: entry.team3_notes, rank: 3, noShow: entry.team3_no_show, incap: entry.team3_incap, tags: entry.team3_tags, path: entry.team3_path || [], crossesMidline: entry.team3_crosses_midline || false },
      ]

      teams.forEach(({ number, notes, rank, noShow, incap, tags, path, crossesMidline }) => {
        if (teamStats[number]) {
          teamStats[number].rankSum += rank
          teamStats[number].rankCount += 1
          teamStats[number].rankings.push({
            rank,
            matchNumber: entry.match_number,
            notes: notes || '',
            scouter: entry.scouter_name,
            alliance: entry.alliance,
            createdAt: entry.created_at,
            noShow: noShow || false,
            incap: incap || false,
            tags: tags || [],
            path: path || [],
            crossesMidline: crossesMidline || false,
          })

          // Count tags for aggregation
          if (tags && Array.isArray(tags)) {
            tags.forEach(tag => {
              teamStats[number].tagCounts[tag] = (teamStats[number].tagCounts[tag] || 0) + 1
            })
          }
        }
      })
    })

    // Calculate averages and filter to teams with data
    let teams = Object.values(teamStats)
      .filter(team => team.rankCount > 0)
      .map(team => ({
        ...team,
        avgRank: team.rankSum / team.rankCount,
      }))

    // Apply tag filtering
    if (selectedTags.length > 0) {
      teams = teams.filter(team => {
        return selectedTags.every(selectedTag =>
          Object.keys(team.tagCounts).includes(selectedTag)
        )
      })
    }

    // Apply sorting
    teams.sort((a, b) => {
      let comparison = 0

      switch (sortMethod) {
        case 'avgRank':
          comparison = a.avgRank - b.avgRank
          break
        case 'observations':
          comparison = b.rankCount - a.rankCount
          break
        case 'teamNumber':
          comparison = a.number - b.number
          break
        case 'teamName':
          comparison = (a.name || '').localeCompare(b.name || '')
          break
        default:
          comparison = a.avgRank - b.avgRank
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })

    return teams
  }, [qualData, eventTeams, selectedTags, sortMethod, sortDirection])

  // Compute available tags for filtering
  const availableTags = useMemo(() => {
    const tagSet = new Set()
    qualData.forEach(entry => {
      [entry.team1_tags, entry.team2_tags, entry.team3_tags].forEach(tags => {
        if (tags && Array.isArray(tags)) {
          tags.forEach(tag => tagSet.add(tag))
        }
      })
    })
    return Array.from(tagSet).sort()
  }, [qualData])

  // Get team notes for a specific team
  const getTeamNotes = (teamNumber) => {
    return teamNotes.filter(n => n.team_number === teamNumber)
  }

  // Team picklist functions
  const saveCurrentPicklist = useCallback(async (newTeams, newNotes) => {
    if (!activePicklist || !isAdmin) return

    try {
      const updatedPicklist = {
        ...activePicklist,
        teams: newTeams,
        notes: newNotes,
        updated_at: new Date().toISOString(),
        synced: false,
      }

      await savePicklist(updatedPicklist)
      setTeamPicklists(prev => prev.map(p => p.id === updatedPicklist.id ? updatedPicklist : p))

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
          setTeamPicklists(prev => prev.map(p => p.id === updatedPicklist.id ? { ...p, synced: true } : p))
        }
      } catch {
        // Silent fail for sync
      }
    } catch (err) {
      console.error('[Admin] Save failed:', err)
      setStatus({ type: 'error', message: 'Failed to save team picklist.' })
    }
  }, [activePicklist, isAdmin])

  // Create new team picklist
  const handleCreatePicklist = async () => {
    if (!newPicklistName.trim() || !isAdmin || !eventKey) {
      setStatus({ type: 'error', message: 'Please enter a picklist name and load an event.' })
      return
    }

    const id = crypto.randomUUID()
    const newPicklist = {
      id,
      name: newPicklistName.trim(),
      event_key: eventKey.trim(),
      scouter_name: 'TEAM_WIDE',
      teams: [],
      notes: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      synced: false,
    }

    try {
      await savePicklist(newPicklist)
      setTeamPicklists(prev => [...prev, newPicklist])
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
          setTeamPicklists(prev => prev.map(p => p.id === id ? { ...p, synced: true } : p))
          setStatus({ type: 'success', message: `Team picklist "${newPicklist.name}" created and synced!` })
        } else {
          setStatus({ type: 'success', message: `Team picklist "${newPicklist.name}" created! Will sync later.` })
        }
      } catch {
        setStatus({ type: 'success', message: `Team picklist "${newPicklist.name}" created! Will sync later.` })
      }
    } catch (err) {
      console.error('[Admin] Create failed:', err)
      setStatus({ type: 'error', message: 'Failed to create team picklist.' })
    }
  }

  // Delete team picklist
  const handleDeletePicklist = async (picklistId) => {
    if (!confirm('Delete this team picklist? This cannot be undone.')) return

    try {
      await deletePicklist(picklistId)
      setTeamPicklists(prev => prev.filter(p => p.id !== picklistId))
      if (activePicklistId === picklistId) {
        setActivePicklistId(null)
        setPicklistTeams([])
        setPicklistNotes([])
      }
      setStatus({ type: 'success', message: 'Team picklist deleted.' })

      // Try to delete from Supabase
      await supabase.from('picklists').delete().eq('id', picklistId)
    } catch (err) {
      console.error('[Admin] Delete failed:', err)
      setStatus({ type: 'error', message: 'Failed to delete team picklist.' })
    }
  }

  // Rename team picklist
  const handleRenamePicklist = async (newName) => {
    if (!newName.trim() || !activePicklist) return

    const updatedPicklist = {
      ...activePicklist,
      name: newName.trim(),
      teams: picklistTeams,
      notes: picklistNotes,
      updated_at: new Date().toISOString(),
      synced: false,
    }

    try {
      await savePicklist(updatedPicklist)
      setTeamPicklists(prev => prev.map(p => p.id === updatedPicklist.id ? updatedPicklist : p))
      setEditingName(false)
    } catch (err) {
      console.error('[Admin] Rename failed:', err)
    }
  }

  const addTeamToPicklist = (team) => {
    if (picklistTeams.find(t => t.number === team.number)) {
      setStatus({ type: 'warning', message: `Team ${team.number} is already in the picklist.` })
      setTimeout(() => setStatus(null), 3000)
      return
    }

    const newTeams = [...picklistTeams, { number: team.number, name: team.name }]
    setPicklistTeams(newTeams)
    setTeamSearch('')
    setDropdownOpen(false)

    // Auto-save after adding
    saveCurrentPicklist(newTeams, picklistNotes)
  }

  const removeTeamFromPicklist = (teamNumber) => {
    const newTeams = picklistTeams.filter(t => t.number !== teamNumber)
    setPicklistTeams(newTeams)
    saveCurrentPicklist(newTeams, picklistNotes)
  }

  const movePicklistTeam = (index, direction) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= picklistTeams.length) return

    const newTeams = [...picklistTeams]
    const temp = newTeams[index]
    newTeams[index] = newTeams[newIndex]
    newTeams[newIndex] = temp

    setPicklistTeams(newTeams)
    saveCurrentPicklist(newTeams, picklistNotes)
  }

  const addNote = () => {
    if (!newNoteText.trim()) return

    const note = {
      id: crypto.randomUUID(),
      text: newNoteText.trim(),
      created_at: new Date().toISOString(),
    }

    const newNotes = [...picklistNotes, note]
    setPicklistNotes(newNotes)
    setNewNoteText('')
    saveCurrentPicklist(picklistTeams, newNotes)
  }

  const deleteNote = (noteId) => {
    const newNotes = picklistNotes.filter(n => n.id !== noteId)
    setPicklistNotes(newNotes)
    saveCurrentPicklist(picklistTeams, newNotes)
  }

  // Drag handlers for team picklist
  const handleDragStart = (e, index) => {
    setDraggedIndex(index)
    dragRef.current = index
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', index)
  }

  const handleDragOver = (e, index) => {
    e.preventDefault()
    // Don't update state here, just allow the drop
  }

  const handleDragLeave = () => {
    // Optional: visual feedback
  }

  const handleDrop = (e, dropIndex) => {
    e.preventDefault()
    const dragIndex = dragRef.current
    if (dragIndex === null || dragIndex === dropIndex) return

    const newTeams = [...picklistTeams]
    const [draggedItem] = newTeams.splice(dragIndex, 1)
    newTeams.splice(dropIndex, 0, draggedItem)

    setPicklistTeams(newTeams)
    setDraggedIndex(null)
    dragRef.current = null
    saveCurrentPicklist(newTeams, picklistNotes)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    dragRef.current = null
  }

  // Touch handlers for mobile
  const handleTouchStart = (e, index) => {
    dragRef.current = index
    setDraggedIndex(index)
  }

  const handleTouchMove = (e) => {
    if (dragRef.current === null) return

    const touch = e.touches[0]
    const elements = document.elementsFromPoint(touch.clientX, touch.clientY)
    const row = elements.find(el => el.classList.contains('picklist-view-row'))
    if (row) {
      const idx = parseInt(row.dataset.index, 10)
      if (!isNaN(idx) && idx !== dragRef.current) {
        // Don't update state during touch move, just visual feedback
      }
    }
  }

  const handleTouchEnd = (e) => {
    if (dragRef.current === null) return

    const touch = e.changedTouches[0]
    const elements = document.elementsFromPoint(touch.clientX, touch.clientY)
    const row = elements.find(el => el.classList.contains('picklist-view-row'))

    if (row) {
      const dropIndex = parseInt(row.dataset.index, 10)
      if (!isNaN(dropIndex) && dropIndex !== dragRef.current) {
        const newTeams = [...picklistTeams]
        const [draggedItem] = newTeams.splice(dragRef.current, 1)
        newTeams.splice(dropIndex, 0, draggedItem)
        setPicklistTeams(newTeams)
        saveCurrentPicklist(newTeams, picklistNotes)
      }
    }

    setDraggedIndex(null)
    dragRef.current = null
  }

  // Filtered teams for search dropdown (excluding already added teams)
  const filteredTeams = useMemo(() => {
    if (!teamSearch.trim()) return []
    const addedTeamNumbers = picklistTeams.map(t => t.number)
    const search = teamSearch.toLowerCase()
    return eventTeams
      .filter(team =>
        !addedTeamNumbers.includes(team.number) &&
        (team.number.toString().includes(search) || team.name?.toLowerCase().includes(search))
      )
      .slice(0, 10)
  }, [teamSearch, eventTeams, picklistTeams])

  return (
    <div className="analysis-container">
      <div className="analysis-header">
        <h1 className="form-title">Analysis Dashboard</h1>
      </div>

      {/* Event Key Input */}
      <div className="field">
        <label htmlFor="admin-event">Event Key</label>
        <input
          id="admin-event"
          type="text"
          value={eventKey}
          onChange={(e) => setEventKey(e.target.value.toLowerCase())}
          placeholder="e.g. 2026gagai"
          autoComplete="off"
        />
      </div>

      {/* Loading/Error States */}
      {loadingEvent && (
        <div className="loading-text">
          <span className="loading-spinner" />
          Loading event data...
        </div>
      )}

      {eventError && <div className="status warning">{eventError}</div>}

      {/* Event Banner */}
      {eventInfo && !loadingEvent && (
        <div className="event-banner">
          <div className="event-banner-info">
            <span className="event-banner-name">{eventInfo.name}</span>
            <span className="event-banner-key">
              {eventInfo.key} | {eventTeams.length} teams
            </span>
          </div>
        </div>
      )}

      {/* Tabs */}
      {eventTeams.length > 0 && (
        <>
          <div className="analysis-tabs">
            <button
              type="button"
              className={`analysis-tab${activeTab === 'rankings' ? ' active' : ''}`}
              onClick={() => setActiveTab('rankings')}
            >
              Team Rankings
            </button>
            <button
              type="button"
              className={`analysis-tab${activeTab === 'picklists' ? ' active' : ''}`}
              onClick={() => setActiveTab('picklists')}
            >
              Picklists
            </button>
            <button
              type="button"
              className={`analysis-tab${activeTab === 'autons' ? ' active' : ''}`}
              onClick={() => setActiveTab('autons')}
            >
              Autons
            </button>
          </div>

          {loadingData ? (
            <div className="loading-text">
              <span className="loading-spinner" />
              Loading analysis data...
            </div>
          ) : (
            <>
              {/* Rankings Tab */}
              {activeTab === 'rankings' && (
                <div className="rankings-tab">
                  {teamRankings.length === 0 ? (
                    <div className="analysis-empty">
                      <p>No ranking data yet</p>
                      <p className="hint">Rankings appear after scouters submit qual match observations.</p>
                    </div>
                  ) : (
                    <>
                      <div className="rankings-header">
                        <div className="rankings-count-and-controls">
                          <span className="rankings-count">
                            {teamRankings.length} teams ranked | {qualData.length} observations
                          </span>
                          <button
                            type="button"
                            className={`filter-toggle-btn${showFilters ? ' active' : ''}`}
                            onClick={() => setShowFilters(!showFilters)}
                            title="Show/hide filters and sorting"
                          >
                            Filters & Sort
                          </button>
                        </div>

                        {/* Filter and Sort Controls */}
                        {showFilters && (
                          <div className="rankings-filters">
                            {/* Tag Filters */}
                            {availableTags.length > 0 && (
                              <div className="filter-section">
                                <label className="filter-label">Filter by Tags</label>
                                <div className="tag-filter-buttons">
                                  {availableTags.map(tag => (
                                    <button
                                      key={tag}
                                      type="button"
                                      className={`tag-filter-btn${selectedTags.includes(tag) ? ' active' : ''}`}
                                      onClick={() => {
                                        if (selectedTags.includes(tag)) {
                                          setSelectedTags(selectedTags.filter(t => t !== tag))
                                        } else {
                                          setSelectedTags([...selectedTags, tag])
                                        }
                                      }}
                                    >
                                      {tag}
                                    </button>
                                  ))}
                                </div>
                                {selectedTags.length > 0 && (
                                  <button
                                    type="button"
                                    className="clear-filters-btn"
                                    onClick={() => setSelectedTags([])}
                                  >
                                    Clear Tag Filters
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Sort Controls */}
                            <div className="filter-section">
                              <label className="filter-label">Sort Teams By</label>
                              <div className="sort-controls">
                                <select
                                  value={sortMethod}
                                  onChange={(e) => setSortMethod(e.target.value)}
                                  className="sort-select"
                                >
                                  <option value="avgRank">Average Rank</option>
                                  <option value="observations">Number of Observations</option>
                                  <option value="teamNumber">Team Number</option>
                                  <option value="teamName">Team Name</option>
                                </select>
                                <button
                                  type="button"
                                  className="sort-direction-btn"
                                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                                  title={`Sort ${sortDirection === 'asc' ? 'descending' : 'ascending'}`}
                                >
                                  {sortDirection === 'asc' ? '↑' : '↓'}
                                </button>
                              </div>
                            </div>

                            {/* Active Filters Summary */}
                            {selectedTags.length > 0 && (
                              <div className="active-filters">
                                <span className="active-filters-label">Active Filters:</span>
                                <div className="active-filter-tags">
                                  {selectedTags.map(tag => (
                                    <span key={tag} className="active-filter-tag">
                                      {tag}
                                      <button
                                        type="button"
                                        onClick={() => setSelectedTags(selectedTags.filter(t => t !== tag))}
                                        className="remove-filter-btn"
                                      >
                                        ×
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="rankings-list">
                        {teamRankings.map((team, index) => (
                          <div
                            key={team.number}
                            className={`analysis-team-row${expandedTeam === team.number ? ' expanded' : ''}`}
                          >
                            <div
                              className="analysis-team-header"
                              onClick={() => setExpandedTeam(expandedTeam === team.number ? null : team.number)}
                            >
                              <span className={`analysis-team-rank${index < 3 ? ' top-3' : ''}`}>
                                #{index + 1}
                              </span>
                              <span className="analysis-team-number">{team.number}</span>
                              <span className="analysis-team-name">{team.name}</span>
                              <div className="analysis-team-stats">
                                <span className="analysis-team-avg">
                                  {team.avgRank.toFixed(2)} avg
                                </span>
                                <span className="analysis-team-count">
                                  {team.rankCount} obs
                                </span>
                                {/* Show top 2 most frequent tags */}
                                {Object.keys(team.tagCounts || {}).length > 0 && (
                                  <div className="analysis-team-tags">
                                    {Object.entries(team.tagCounts)
                                      .sort(([, a], [, b]) => b - a)
                                      .slice(0, 2)
                                      .map(([tag, count]) => (
                                        <span key={tag} className="analysis-tag" title={`${tag} (${count}x)`}>
                                          {tag} ({count})
                                        </span>
                                      ))}
                                  </div>
                                )}
                              </div>
                              <span className="expand-icon">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                  <path d="M8 10L3 5h10z" />
                                </svg>
                              </span>
                            </div>

                            {expandedTeam === team.number && (
                              <div className="analysis-team-content">
                                {/* Ranking Notes */}
                                <div className="notes-section">
                                  <div className="notes-section-title">
                                    Ranking Notes
                                    <span className="notes-section-count">({team.rankings.length})</span>
                                  </div>
                                  {team.rankings.length === 0 ? (
                                    <div className="notes-empty">No ranking notes</div>
                                  ) : (
                                    team.rankings.map((r, i) => (
                                      <div key={i} className="note-card">
                                        <div className="note-card-header">
                                          <span className={`note-card-rank rank-${r.rank}`}>
                                            Rank #{r.rank}
                                          </span>
                                          <div className="note-card-meta">
                                            <span>Match {r.matchNumber}</span>
                                            <span className={`alliance-badge ${r.alliance}`}>
                                              {r.alliance}
                                            </span>
                                            {r.noShow && (
                                              <span className="flag-badge no-show">No-Show</span>
                                            )}
                                            {r.incap && (
                                              <span className="flag-badge incap">Incap</span>
                                            )}
                                          </div>
                                        </div>
                                        {r.notes ? (
                                          <div className="note-card-text">{r.notes}</div>
                                        ) : (
                                          <div className="note-card-text empty">No notes provided</div>
                                        )}
                                        {r.tags && r.tags.length > 0 && (
                                          <div className="note-card-tags">
                                            {r.tags.map(tag => (
                                              <span key={tag} className="note-tag">
                                                {tag}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                        <div className="note-card-footer">
                                          {r.scouter}
                                        </div>
                                        {r.crossesMidline && (
                                          <span className="midline-badge">Crosses Midline</span>
                                        )}
                                      </div>
                                    ))
                                  )}
                                </div>

                                {/* Team Notes */}
                                <div className="notes-section">
                                  <div className="notes-section-title">
                                    Team Notes
                                    <span className="notes-section-count">
                                      ({getTeamNotes(team.number).length})
                                    </span>
                                  </div>
                                  {getTeamNotes(team.number).length === 0 ? (
                                    <div className="notes-empty">No team notes recorded</div>
                                  ) : (
                                    getTeamNotes(team.number).map((note) => (
                                      <div
                                        key={note.id}
                                        className={`note-card${note.is_update ? ' is-update' : ''}`}
                                      >
                                        <div className="note-card-header">
                                          {note.is_update && (
                                            <span className="update-badge">Update</span>
                                          )}
                                          <div className="note-card-meta">
                                            {note.match_number && (
                                              <span>Match {note.match_number}</span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="note-card-text">{note.note}</div>
                                        <div className="note-card-footer">
                                          {note.scouter_name} &middot;{' '}
                                          {new Date(note.created_at).toLocaleString()}
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Picklists Tab */}
              {activeTab === 'picklists' && (
                <div className="picklists-tab">
                  {/* Team picklist tabs */}
                  <div className="picklist-tabs">
                    <div className="picklist-tabs-scroll">
                      {teamPicklists.filter(p => p.event_key === eventKey).map(picklist => (
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
                    {isAdmin && (
                      <button
                        type="button"
                        className="picklist-tab-add"
                        onClick={() => setShowCreateModal(true)}
                        disabled={!eventKey || eventTeams.length === 0}
                        title="Create new team picklist"
                      >
                        +
                      </button>
                    )}
                  </div>

                  {/* Create modal */}
                  {showCreateModal && (
                    <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                      <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Create Team Picklist</h2>
                        <div className="field">
                          <label htmlFor="new-team-picklist-name">Picklist Name</label>
                          <input
                            id="new-team-picklist-name"
                            type="text"
                            value={newPicklistName}
                            onChange={(e) => setNewPicklistName(e.target.value)}
                            placeholder="e.g. Alliance Selection, Backup List..."
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
                  {activePicklist ? (
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
                          <h2 className="picklist-name" onClick={() => isAdmin && setEditingName(true)}>
                            {activePicklist.name}
                            {isAdmin && <span className="edit-icon">✎</span>}
                          </h2>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            className="delete-picklist-btn"
                            onClick={() => handleDeletePicklist(activePicklist.id)}
                            title="Delete team picklist"
                          >
                            🗑
                          </button>
                        )}
                      </div>

                      {/* Team search and add */}
                      {isAdmin && (
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
                                    onClick={() => addTeamToPicklist(team)}
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
                      )}

                      {/* Teams list */}
                      {picklistTeams.length > 0 ? (
                        <div className="picklist-teams">
                          <label className="picklist-teams-label">Rankings ({picklistTeams.length} teams)</label>
                          {picklistTeams.map((team, index) => (
                            <div
                              key={team.number}
                              data-index={index}
                              className={`picklist-team-row${draggedIndex === index ? ' dragging' : ''}`}
                              draggable={isAdmin}
                              onDragStart={(e) => isAdmin && handleDragStart(e, index)}
                              onDragOver={(e) => isAdmin && handleDragOver(e, index)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => isAdmin && handleDrop(e, index)}
                              onDragEnd={handleDragEnd}
                              onTouchStart={(e) => isAdmin && handleTouchStart(e, index)}
                              onTouchMove={isAdmin ? handleTouchMove : undefined}
                              onTouchEnd={handleTouchEnd}
                              style={{ touchAction: draggedIndex === index ? 'none' : 'auto' }}
                            >
                              {isAdmin && (
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
                              )}
                              <span className={`rank-badge rank-${Math.min(index + 1, 4)}`}>#{index + 1}</span>
                              <span className="picklist-team-number">{team.number}</span>
                              <span className="picklist-team-name">{team.name}</span>
                              {isAdmin && (
                                <div className="picklist-team-actions">
                                  <button
                                    type="button"
                                    className="move-btn"
                                    onClick={() => movePicklistTeam(index, -1)}
                                    disabled={index === 0}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    className="move-btn"
                                    onClick={() => movePicklistTeam(index, 1)}
                                    disabled={index === picklistTeams.length - 1}
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    className="remove-btn"
                                    onClick={() => removeTeamFromPicklist(team.number)}
                                    title="Remove from picklist"
                                  >
                                    ×
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="picklist-empty">
                          <p>No teams added yet.</p>
                          {isAdmin && <p className="hint">Search for teams above to add them to your picklist.</p>}
                        </div>
                      )}

                      {/* Notes section */}
                      <div className="picklist-notes-section">
                        <label className="picklist-notes-label">Notes</label>
                        {isAdmin && (
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
                              onClick={addNote}
                              disabled={!newNoteText.trim()}
                            >
                              Add Note
                            </button>
                          </div>
                        )}
                        {picklistNotes.length > 0 && (
                          <div className="picklist-notes-list">
                            {picklistNotes.map((note) => (
                              <div key={note.id} className="picklist-note">
                                <div className="picklist-note-text">{note.text}</div>
                                <div className="picklist-note-footer">
                                  <span className="picklist-note-time">
                                    {new Date(note.created_at).toLocaleString()}
                                  </span>
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      className="delete-note-btn"
                                      onClick={() => deleteNote(note.id)}
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    // No picklist selected
                    <div className="picklist-empty">
                      <p>No team picklist selected.</p>
                      {isAdmin ? (
                        <p className="hint">Create a new team picklist using the + button above.</p>
                      ) : (
                        <p className="hint">No team picklists created yet.</p>
                      )}
                    </div>
                  )}

                  {status && <div className={`status ${status.type}`}>{status.message}</div>}
                </div>
              )}

              {/* Autons Tab */}
              {activeTab === 'autons' && (
                <AutonsTab qualData={qualData} onRefresh={() => loadAnalysisData(eventKey)} />
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

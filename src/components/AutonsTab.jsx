'use client'

import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import FieldMap from '@/components/FieldMap'

const ZONE_LABELS = ['Trench', 'Bump', 'Hub', 'Bump', 'Trench']

function posLabel(pos) {
  if (pos == null) return '?'
  return `${pos} · ${ZONE_LABELS[pos - 1] ?? '?'}`
}

export default function AutonsTab({ qualData, onRefresh }) {
  const [deleting, setDeleting] = useState(null)
  const [expandedRec, setExpandedRec] = useState(null)
  const [playIndex, setPlayIndex] = useState(null) // null = all points visible
  const [isPlaying, setIsPlaying] = useState(false)
  const intervalRef = useRef(null)

  const stopPlay = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setIsPlaying(false)
  }, [])

  // Reset play state when a different record is expanded
  useEffect(() => {
    stopPlay()
    setPlayIndex(null)
  }, [expandedRec, stopPlay])

  // Cleanup interval on unmount
  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  // Close on Escape
  useEffect(() => {
    if (!expandedRec) return
    const onKey = (e) => { if (e.key === 'Escape') setExpandedRec(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expandedRec])

  const startPlay = useCallback(() => {
    if (!expandedRec) return
    const total = expandedRec.path.length
    stopPlay()

    let current = 1
    setPlayIndex(1)
    setIsPlaying(true)

    intervalRef.current = setInterval(() => {
      current++
      setPlayIndex(current)
      if (current >= total) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
        setIsPlaying(false)
      }
    }, 500)
  }, [expandedRec, stopPlay])

  const handlePlayPause = () => {
    if (isPlaying) {
      stopPlay()
    } else {
      startPlay()
    }
  }

  const isAtEnd = expandedRec && playIndex === expandedRec.path.length
  const visiblePoints = expandedRec
    ? (playIndex === null || isAtEnd ? expandedRec.path : expandedRec.path.slice(0, playIndex))
    : []

  const autonsByTeam = useMemo(() => {
    const map = {}
    qualData.forEach(entry => {
      const slots = [
        { slot: 1, num: entry.team1_number, path: entry.team1_path || [], crossesMidline: entry.team1_crosses_midline ?? false, startingPosition: entry.team1_starting_position ?? null, endLocation: entry.team1_end_location ?? null },
        { slot: 2, num: entry.team2_number, path: entry.team2_path || [], crossesMidline: entry.team2_crosses_midline ?? false, startingPosition: entry.team2_starting_position ?? null, endLocation: entry.team2_end_location ?? null },
        { slot: 3, num: entry.team3_number, path: entry.team3_path || [], crossesMidline: entry.team3_crosses_midline ?? false, startingPosition: entry.team3_starting_position ?? null, endLocation: entry.team3_end_location ?? null },
      ]
      slots.forEach(slot => {
        if (slot.path.length === 0) return
        if (!map[slot.num]) map[slot.num] = []
        map[slot.num].push({
          entryId: entry.id,
          teamSlot: slot.slot,
          matchNumber: entry.match_number,
          alliance: entry.alliance,
          path: slot.path,
          crossesMidline: slot.crossesMidline,
          startingPosition: slot.startingPosition,
          endLocation: slot.endLocation,
        })
      })
    })
    Object.values(map).forEach(recs => recs.sort((a, b) => a.matchNumber - b.matchNumber))
    return map
  }, [qualData])

  const teamNumbers = Object.keys(autonsByTeam).map(Number).sort((a, b) => a - b)

  const handleDelete = async (rec) => {
    const key = `${rec.entryId}-${rec.teamSlot}`
    setDeleting(key)
    const p = `team${rec.teamSlot}`
    try {
      const { error } = await supabase
        .from('qual_scouting')
        .update({
          [`${p}_path`]: [],
          [`${p}_crosses_midline`]: false,
          [`${p}_starting_position`]: null,
          [`${p}_end_location`]: null,
        })
        .eq('id', rec.entryId)
      if (!error && onRefresh) onRefresh()
    } catch (err) {
      console.error('[AutonsTab] delete failed:', err)
    } finally {
      setDeleting(null)
    }
  }

  if (teamNumbers.length === 0) {
    return (
      <div className="analysis-empty">
        <p>No auton paths recorded yet</p>
        <p className="hint">Paths appear after scouters draw them in the qual scout form.</p>
      </div>
    )
  }

  return (
    <>
      <div className="autons-tab">
        {teamNumbers.map(num => (
          <div key={num} className="auton-team-section">
            <div className="auton-team-header">Team {num}</div>
            <div className="auton-matches-scroll">
              {autonsByTeam[num].map((rec) => {
                const deleteKey = `${rec.entryId}-${rec.teamSlot}`
                return (
                  <div
                    key={deleteKey}
                    className={`auton-match-card ${rec.alliance}`}
                  >
                    <div className="auton-match-meta">
                      <div className="auton-match-meta-row">
                        <span className="auton-match-num">Q{rec.matchNumber}</span>
                        <span className={`alliance-badge ${rec.alliance}`}>{rec.alliance}</span>
                        <button
                          type="button"
                          className="auton-delete-btn"
                          onClick={() => handleDelete(rec)}
                          disabled={deleting === deleteKey}
                          title="Delete this auton"
                        >
                          {deleting === deleteKey ? '…' : '✕'}
                        </button>
                      </div>
                      <div className="auton-meta-details">
                        <span className="auton-pos">
                          <span className="auton-pos-label">Start</span>
                          <span className="auton-pos-value">{posLabel(rec.startingPosition)}</span>
                        </span>
                        <span className="auton-pos">
                          <span className="auton-pos-label">End</span>
                          <span className="auton-pos-value">{rec.endLocation ?? '?'}</span>
                        </span>
                        <span className="auton-pos">
                          <span className="auton-pos-label">Midline</span>
                          <span className={`auton-pos-value${rec.crossesMidline ? ' midline-yes' : ' midline-no'}`}>
                            {rec.crossesMidline ? 'Yes' : 'No'}
                          </span>
                        </span>
                      </div>
                    </div>
                    <div
                      className="auton-map-container auton-map-clickable"
                      onClick={() => setExpandedRec(rec)}
                      title="Click to expand"
                    >
                      <FieldMap
                        points={rec.path}
                        onChange={() => {}}
                        color={rec.alliance === 'red' ? '#ef4444' : '#3b82f6'}
                        alliance={rec.alliance}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Expanded modal */}
      {expandedRec && (
        <div className="auton-modal-backdrop" onClick={() => setExpandedRec(null)}>
          <div className="auton-modal" onClick={e => e.stopPropagation()}>
            <div className="auton-modal-header">
              <div className="auton-modal-title">
                <span className="auton-match-num">Q{expandedRec.matchNumber}</span>
                <span className={`alliance-badge ${expandedRec.alliance}`}>{expandedRec.alliance}</span>
                <span className="auton-pos-value">{posLabel(expandedRec.startingPosition)}</span>
                <span className="auton-modal-sep">→</span>
                <span className="auton-pos-value">{expandedRec.endLocation ?? '?'}</span>
                {expandedRec.crossesMidline && (
                  <span className="auton-pos-value midline-yes">· Crosses midline</span>
                )}
              </div>
              <button
                type="button"
                className="auton-modal-close"
                onClick={() => setExpandedRec(null)}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            <div className="auton-modal-field">
              <FieldMap
                points={visiblePoints}
                onChange={() => {}}
                color={expandedRec.alliance === 'red' ? '#ef4444' : '#3b82f6'}
                alliance={expandedRec.alliance}
              />
            </div>

            <div className="auton-modal-controls">
              <span className="auton-modal-counter">
                {playIndex === null || isAtEnd
                  ? `${expandedRec.path.length} pts`
                  : `${playIndex} / ${expandedRec.path.length}`}
              </span>
              <button
                type="button"
                className="auton-play-btn"
                onClick={handlePlayPause}
              >
                {isPlaying ? '⏸ Pause' : '▶ Play'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

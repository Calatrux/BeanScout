'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { savePrescoutingEntry, markPrescoutingEntrySynced } from '@/lib/indexeddb'
import { getEventInfo } from '@/lib/tba'
import { getCachedEventData } from '@/lib/tba-cache'
import { FEATURE_ZONES } from '@/components/FieldMap'

const CYCLE_LABELS = ['10+', '20+', '35+', '40+', '50+', '60+']
const CYCLE_KEYS   = [10, 20, 35, 40, 50, 60]
const ZONE_LABELS  = ['Trench 1', 'Bump 1', 'Hub', 'Bump 2', 'Trench 2']

function makeCycles() {
  return { 10: 0, 20: 0, 35: 0, 40: 0, 50: 0, 60: 0 }
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = Math.floor(totalSeconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── Static field reference image with zone overlays ──────────────────────────
function FieldPreview() {
  const canvasRef   = useRef(null)
  const containerRef = useRef(null)
  const imgRef      = useRef(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img || !img.complete) return
    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)

    // Draw zone boxes for both sides (blue left, red right)
    FEATURE_ZONES.forEach(zone => {
      // Blue side
      const blueLeft  = zone.xMin * width
      const blueRight = zone.xMax * width
      const top = zone.yMin * height
      const h   = (zone.yMax - zone.yMin) * height

      ctx.save()
      ctx.strokeStyle = 'rgba(59,130,246,0.7)'
      ctx.lineWidth   = 1.5
      ctx.setLineDash([4, 3])
      ctx.strokeRect(blueLeft, top, blueRight - blueLeft, h)
      ctx.font      = 'bold 8px sans-serif'
      ctx.fillStyle = 'rgba(59,130,246,0.9)'
      ctx.textBaseline = 'top'
      ctx.textAlign    = 'left'
      ctx.fillText(zone.label, blueLeft + 3, top + 2)
      ctx.restore()

      // Red side (mirrored)
      const redLeft  = (1 - zone.xMax) * width
      const redRight = (1 - zone.xMin) * width
      ctx.save()
      ctx.strokeStyle = 'rgba(239,68,68,0.7)'
      ctx.lineWidth   = 1.5
      ctx.setLineDash([4, 3])
      ctx.strokeRect(redLeft, top, redRight - redLeft, h)
      ctx.font      = 'bold 8px sans-serif'
      ctx.fillStyle = 'rgba(239,68,68,0.9)'
      ctx.textBaseline = 'top'
      ctx.textAlign    = 'right'
      ctx.fillText(zone.label, redRight - 3, top + 2)
      ctx.restore()
    })
  }, [])

  useEffect(() => {
    const canvas    = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const observer = new ResizeObserver(() => {
      canvas.width  = container.clientWidth
      canvas.height = container.clientHeight
      draw()
    })
    observer.observe(container)
    canvas.width  = container.clientWidth
    canvas.height = container.clientHeight
    return () => observer.disconnect()
  }, [draw])

  useEffect(() => { draw() }, [draw])

  return (
    <div className="prescout-field-preview" ref={containerRef}>
      <img
        ref={imgRef}
        src="/2026-field.png"
        alt=""
        style={{ display: 'none' }}
        onLoad={draw}
      />
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 'var(--radius-sm)' }} />
    </div>
  )
}

// ── Phase progress bar ────────────────────────────────────────────────────────
function PhaseBar({ phase }) {
  const phases = ['Setup', 'Auton', 'Teleop']
  const idx = phases.findIndex(p => p.toLowerCase() === phase)
  return (
    <div className="prescout-phasebar">
      {phases.map((p, i) => (
        <div key={p} className={`prescout-phase-step${i <= idx ? ' active' : ''}`}>
          <div className="prescout-phase-dot">{i + 1}</div>
          <span className="prescout-phase-label">{p}</span>
          {i < phases.length - 1 && <div className={`prescout-phase-line${i < idx ? ' active' : ''}`} />}
        </div>
      ))}
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="prescout-section">
      {title && <div className="prescout-section-title">{title}</div>}
      {children}
    </div>
  )
}

// ── Cycle counter grid ────────────────────────────────────────────────────────
function CycleGrid({ cycles, onChange }) {
  return (
    <div className="prescout-cycle-grid">
      {CYCLE_KEYS.map((key, i) => (
        <div key={key} className="prescout-cycle-btn" onClick={() => onChange(key, cycles[key] + 1)}>
          <span className="prescout-cycle-label">{CYCLE_LABELS[i]}</span>
          <span className="prescout-cycle-count">{cycles[key]}</span>
          <button
            className="prescout-cycle-dec"
            onClick={e => { e.stopPropagation(); onChange(key, Math.max(0, cycles[key] - 1)) }}
            aria-label="Decrement"
          >−</button>
        </div>
      ))}
    </div>
  )
}

// ── Zone selector ─────────────────────────────────────────────────────────────
function ZoneSelector({ value, onChange, label }) {
  return (
    <div className="prescout-subsection">
      <div className="prescout-subsection-label">{label}</div>
      <div className="prescout-zone-row">
        {ZONE_LABELS.map(z => (
          <button
            key={z}
            type="button"
            className={`prescout-zone-btn${value === z ? ' active' : ''}`}
            onClick={() => onChange(value === z ? null : z)}
          >
            {z}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Climb selector ────────────────────────────────────────────────────────────
function ClimbSelector({ level, onLevelChange, climbTime, onMarkTime }) {
  return (
    <div className="prescout-climb-row">
      {[null, 1, 2, 3].map(l => (
        <button
          key={l ?? 'none'}
          type="button"
          className={`prescout-climb-level${level === l ? ' active' : ''}`}
          onClick={() => onLevelChange(l)}
        >
          {l === null ? 'None' : `L${l}`}
        </button>
      ))}
      <button
        type="button"
        className="prescout-mark-btn"
        onClick={onMarkTime}
        disabled={level === null}
      >
        Mark Time
      </button>
      {climbTime && (
        <span className="prescout-climb-time">
          @ {new Date(climbTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      )}
    </div>
  )
}

// ── Counter row ───────────────────────────────────────────────────────────────
function CounterRow({ label, value, onChange }) {
  return (
    <div className="prescout-counter-item">
      <span className="prescout-counter-label">{label}</span>
      <div className="prescout-counter-row">
        <button type="button" className="prescout-counter-btn" onClick={() => onChange(Math.max(0, value - 1))}>−</button>
        <span className="prescout-counter-val">{value}</span>
        <button type="button" className="prescout-counter-btn" onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function PrescoutingForm() {
  const { profile } = useAuth()
  const scouterName = profile
    ? `${profile.first_name} ${profile.last_name}`.trim() || profile.username
    : ''

  const [phase, setPhase] = useState('setup')

  // Setup
  const [teamNumber,      setTeamNumber]      = useState('')
  const [eventKey,        setEventKey]        = useState('')
  const [matchNumber,     setMatchNumber]     = useState('')
  const [eventInfo,       setEventInfo]       = useState(null)
  const [loadingEvent,    setLoadingEvent]    = useState(false)
  const [eventError,      setEventError]      = useState(null)
  const [myAssignments,   setMyAssignments]   = useState([])

  // Auton
  const [autoStartZone,  setAutoStartZone]  = useState(null)
  const [autoEndZone,    setAutoEndZone]    = useState(null)
  const [autoCycles,     setAutoCycles]     = useState(makeCycles())
  const [autoClimbLevel, setAutoClimbLevel] = useState(null)
  const [autoClimbTime,  setAutoClimbTime]  = useState(null)

  // Teleop
  const [teleopCycles,      setTeleopCycles]      = useState(makeCycles())
  const [passCycles,        setPassCycles]        = useState(makeCycles())
  const [passingActive,     setPassingActive]     = useState(false)
  const [totalPassTime,     setTotalPassTime]     = useState(0)
  const passTimerStartRef   = useRef(null)
  const passAccumRef        = useRef(0)
  const passIntervalRef     = useRef(null)
  const [trenchCount,       setTrenchCount]       = useState(0)
  const [bumpCount,         setBumpCount]         = useState(0)
  const [endgameClimbLevel, setEndgameClimbLevel] = useState(null)
  const [endgameClimbTime,  setEndgameClimbTime]  = useState(null)

  // Form status
  const [status,     setStatus]     = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Load saved event key
  useEffect(() => {
    const saved = localStorage.getItem('bs_event_key') || process.env.NEXT_PUBLIC_DEFAULT_EVENT_KEY || ''
    if (saved) setEventKey(saved)
  }, [])

  // Load event info (debounced)
  const loadEventData = useCallback(async (key) => {
    if (!key || key.length < 4) { setEventInfo(null); setEventError(null); return }
    setLoadingEvent(true)
    setEventError(null)
    try {
      const cached = await getCachedEventData(key)
      if (cached?.info) {
        setEventInfo(cached.info)
        localStorage.setItem('bs_event_key', key)
        setLoadingEvent(false)
        return
      }
      const info = await getEventInfo(key)
      setEventInfo(info)
      localStorage.setItem('bs_event_key', key)
    } catch (err) {
      setEventError(`Could not load event: ${err.message || 'Unknown error'}`)
      setEventInfo(null)
    } finally {
      setLoadingEvent(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => { if (eventKey) loadEventData(eventKey) }, 500)
    return () => clearTimeout(t)
  }, [eventKey, loadEventData])

  // Load my assignments when event key + username are known
  useEffect(() => {
    if (!eventKey || !profile?.username) return
    supabase
      .from('prescouting_assignments')
      .select('team_number')
      .eq('event_key', eventKey.trim().toLowerCase())
      .eq('assigned_to', profile.username)
      .then(({ data }) => setMyAssignments((data || []).map(a => a.team_number)))
  }, [eventKey, profile?.username])

  // Passing timer
  const togglePassing = useCallback(() => {
    if (!passingActive) {
      passTimerStartRef.current = Date.now()
      passIntervalRef.current = setInterval(() => {
        setTotalPassTime(passAccumRef.current + (Date.now() - passTimerStartRef.current) / 1000)
      }, 100)
      setPassingActive(true)
    } else {
      clearInterval(passIntervalRef.current)
      passIntervalRef.current = null
      passAccumRef.current += (Date.now() - passTimerStartRef.current) / 1000
      passTimerStartRef.current = null
      setPassingActive(false)
    }
  }, [passingActive])

  useEffect(() => () => { if (passIntervalRef.current) clearInterval(passIntervalRef.current) }, [])

  const updateAutoCycles   = (key, val) => setAutoCycles(prev   => ({ ...prev, [key]: val }))
  const updateTeleopCycles = (key, val) => setTeleopCycles(prev => ({ ...prev, [key]: val }))
  const updatePassCycles   = (key, val) => setPassCycles(prev   => ({ ...prev, [key]: val }))

  // Submit
  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    setStatus(null)

    if (passingActive) {
      clearInterval(passIntervalRef.current)
      passIntervalRef.current = null
      passAccumRef.current += (Date.now() - passTimerStartRef.current) / 1000
    }
    const finalPassTime = passAccumRef.current

    const id = crypto.randomUUID()
    const entry = {
      id,
      event_key:             eventKey.trim().toLowerCase(),
      team_number:           parseInt(teamNumber, 10),
      match_number:          parseInt(matchNumber, 10),
      scouter_name:          scouterName,
      auto_start_position:   autoStartZone  || null,
      auto_end_position:     autoEndZone    || null,
      auto_10_cycles:        autoCycles[10],
      auto_20_cycles:        autoCycles[20],
      auto_35_cycles:        autoCycles[35],
      auto_40_cycles:        autoCycles[40],
      auto_50_cycles:        autoCycles[50],
      auto_60_cycles:        autoCycles[60],
      auto_climb_level:      autoClimbLevel,
      auto_climb_time:       autoClimbTime  || null,
      teleop_10_cycles:      teleopCycles[10],
      teleop_20_cycles:      teleopCycles[20],
      teleop_35_cycles:      teleopCycles[35],
      teleop_40_cycles:      teleopCycles[40],
      teleop_50_cycles:      teleopCycles[50],
      teleop_60_cycles:      teleopCycles[60],
      pass_10_cycles:        passCycles[10],
      pass_20_cycles:        passCycles[20],
      pass_35_cycles:        passCycles[35],
      pass_40_cycles:        passCycles[40],
      pass_50_cycles:        passCycles[50],
      pass_60_cycles:        passCycles[60],
      total_pass_time:       Math.round(finalPassTime * 10) / 10,
      trench_count:          trenchCount,
      bump_count:            bumpCount,
      endgame_climb_level:   endgameClimbLevel,
      endgame_climb_time:    endgameClimbTime || null,
      created_at:            new Date().toISOString(),
      synced:                false,
    }

    await savePrescoutingEntry(entry)

    const { synced: _s, ...supabaseRecord } = entry
    try {
      const { error } = await Promise.race([
        supabase.from('prescouting').insert(supabaseRecord),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 5000)),
      ])
      if (error) throw error
      await markPrescoutingEntrySynced(id)
      setStatus({ type: 'success', message: `Saved — Team ${teamNumber}, Match ${matchNumber}` })
    } catch {
      setStatus({ type: 'warning', message: 'Saved locally. Will sync when online.' })
    }

    window.dispatchEvent(new Event('beanscout:saved'))

    // Reset
    setPhase('setup')
    setAutoStartZone(null); setAutoEndZone(null)
    setAutoCycles(makeCycles()); setTeleopCycles(makeCycles()); setPassCycles(makeCycles())
    setAutoClimbLevel(null); setAutoClimbTime(null)
    setEndgameClimbLevel(null); setEndgameClimbTime(null)
    setPassingActive(false); passAccumRef.current = 0; setTotalPassTime(0)
    setTrenchCount(0); setBumpCount(0)
    setTeamNumber(''); setMatchNumber('')
    setSubmitting(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="form">
      <h1 className="form-title">Prescouting</h1>

      <PhaseBar phase={phase} />

      {status && (
        <div className={`status ${status.type}`}>
          {status.message}
        </div>
      )}

      {/* ── SETUP ─────────────────────────────────────────────────────────── */}
      {phase === 'setup' && (
        <div>
          <div className="field">
            <label className="field-label">Team Number</label>
            <input
              className="field-input"
              type="number"
              placeholder="e.g. 1833"
              value={teamNumber}
              onChange={e => setTeamNumber(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label">
              Event Key
              {loadingEvent && <span className="prescout-loading-hint">Loading…</span>}
            </label>
            <input
              className="field-input"
              type="text"
              placeholder="e.g. 2026gagai"
              value={eventKey}
              onChange={e => setEventKey(e.target.value)}
            />
            {eventInfo && <div className="prescout-event-name">{eventInfo.name}</div>}
            {eventError && <div className="prescout-event-error">{eventError}</div>}
          </div>

          <div className="field">
            <label className="field-label">Match Number</label>
            <input
              className="field-input"
              type="number"
              placeholder="e.g. 12"
              value={matchNumber}
              onChange={e => setMatchNumber(e.target.value)}
            />
          </div>

          {myAssignments.length > 0 && (
            <div className="prescout-assignments-box">
              <div className="prescout-section-title">Your Assigned Teams</div>
              <div className="prescout-assignment-chips">
                {myAssignments.map(t => (
                  <button
                    key={t}
                    type="button"
                    className={`prescout-assign-chip${String(teamNumber) === String(t) ? ' active' : ''}`}
                    onClick={() => setTeamNumber(String(t))}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className="submit-btn"
            disabled={!teamNumber || !eventKey || !matchNumber}
            onClick={() => setPhase('auton')}
          >
            Start Scouting →
          </button>
        </div>
      )}

      {/* ── AUTON ─────────────────────────────────────────────────────────── */}
      {phase === 'auton' && (
        <div>
          <FieldPreview />

          <Section title="Start Position">
            <ZoneSelector value={autoStartZone} onChange={setAutoStartZone} />
          </Section>

          <Section title="Cycles">
            <CycleGrid cycles={autoCycles} onChange={updateAutoCycles} />
          </Section>

          <Section title="End Position">
            <ZoneSelector value={autoEndZone} onChange={setAutoEndZone} />
          </Section>

          <Section title="Climb">
            <ClimbSelector
              level={autoClimbLevel}
              onLevelChange={setAutoClimbLevel}
              climbTime={autoClimbTime}
              onMarkTime={() => setAutoClimbTime(new Date().toISOString())}
            />
          </Section>

          <div className="prescout-nav">
            <button type="button" className="prescout-back-btn" onClick={() => setPhase('setup')}>← Back</button>
            <button type="button" className="submit-btn prescout-next-btn" onClick={() => setPhase('teleop')}>
              Next: Teleop →
            </button>
          </div>
        </div>
      )}

      {/* ── TELEOP ────────────────────────────────────────────────────────── */}
      {phase === 'teleop' && (
        <div>
          <FieldPreview />

          <Section title="Cycles">
            <CycleGrid cycles={teleopCycles} onChange={updateTeleopCycles} />
          </Section>

          <Section title="Passing">
            <div className="prescout-passing-header">
              <button
                type="button"
                className={`prescout-passing-toggle${passingActive ? ' active' : ''}`}
                onClick={togglePassing}
              >
                {passingActive ? '⏸ Active' : '▶ Start'}
              </button>
              {totalPassTime > 0 && (
                <span className="prescout-pass-timer">{formatTime(totalPassTime)}</span>
              )}
            </div>
            {passingActive && (
              <div className="prescout-pass-panel">
                <p className="prescout-pass-hint">Tap to count a pass cycle</p>
                <div className="prescout-cycle-grid">
                  {CYCLE_KEYS.map((key, i) => (
                    <div
                      key={key}
                      className="prescout-cycle-btn prescout-cycle-btn--pass"
                      onClick={() => updatePassCycles(key, passCycles[key] + 1)}
                    >
                      <span className="prescout-cycle-label">{CYCLE_LABELS[i]}</span>
                      <span className="prescout-cycle-count">{passCycles[key]}</span>
                      <button
                        className="prescout-cycle-dec"
                        onClick={e => { e.stopPropagation(); updatePassCycles(key, Math.max(0, passCycles[key] - 1)) }}
                        aria-label="Decrement"
                      >−</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!passingActive && Object.values(passCycles).some(v => v > 0) && (
              <div className="prescout-pass-summary">
                {CYCLE_KEYS.map((k, i) => passCycles[k] > 0
                  ? <span key={k} className="prescout-pass-chip">{CYCLE_LABELS[i]}: {passCycles[k]}</span>
                  : null
                )}
              </div>
            )}
          </Section>

          <Section title="Field Crossings">
            <div className="prescout-counters-row">
              <CounterRow label="Trench" value={trenchCount} onChange={setTrenchCount} />
              <CounterRow label="Bump"   value={bumpCount}   onChange={setBumpCount}   />
            </div>
          </Section>

          <Section title="Endgame Climb">
            <ClimbSelector
              level={endgameClimbLevel}
              onLevelChange={setEndgameClimbLevel}
              climbTime={endgameClimbTime}
              onMarkTime={() => setEndgameClimbTime(new Date().toISOString())}
            />
          </Section>

          <div className="prescout-nav">
            <button type="button" className="prescout-back-btn" onClick={() => setPhase('auton')}>← Back</button>
            <button
              type="button"
              className="submit-btn prescout-next-btn"
              disabled={submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Saving…' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

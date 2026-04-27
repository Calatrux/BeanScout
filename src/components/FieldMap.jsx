'use client'

import { useRef, useEffect, useCallback, useState } from 'react'

const POINT_RADIUS = 7
const LINE_WIDTH = 2.5
const GRID_COLS = 20
const GRID_ROWS = 12

// ─── Zone layout (normalized 0–1, defined for BLUE/left side) ───────────────
export const FEATURE_ZONES = [
  { label: 'Trench', xMin: 0.15, xMax: 0.34, yMin: 0.00, yMax: 0.18 },
  { label: 'Bump',   xMin: 0.15, xMax: 0.34, yMin: 0.20, yMax: 0.38 },
  { label: 'Hub',    xMin: 0.15, xMax: 0.34, yMin: 0.43, yMax: 0.58 },
  { label: 'Bump',   xMin: 0.15, xMax: 0.34, yMin: 0.60, yMax: 0.78 },
  { label: 'Trench', xMin: 0.15, xMax: 0.34, yMin: 0.80, yMax: 1.00 },
]
// ─────────────────────────────────────────────────────────────────────────────

export default function FieldMap({
  points,
  onChange,
  color = '#1B97AD',
  alliance = 'blue',
  // Array of { matchNum, path } — last N autons for this team (for overlay dropdown)
  historyPaths = [],
}) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const containerRef = useRef(null)

  // ── Flip preferences (persisted) ─────────────────────────────────────────
  const [flipH, setFlipHState] = useState(() => {
    try { return localStorage.getItem('bs_flip_h') === '1' } catch { return false }
  })
  const [flipV, setFlipVState] = useState(() => {
    try { return localStorage.getItem('bs_flip_v') === '1' } catch { return false }
  })

  const setFlipH = (val) => {
    setFlipHState(val)
    try { localStorage.setItem('bs_flip_h', val ? '1' : '0') } catch {}
  }
  const setFlipV = (val) => {
    setFlipVState(val)
    try { localStorage.setItem('bs_flip_v', val ? '1' : '0') } catch {}
  }

  // ── History selection ─────────────────────────────────────────────────────
  // selectedHistoryIdx: which historyPaths entry is shown in the dropdown
  const [selectedHistoryIdx, setSelectedHistoryIdx] = useState(null)
  // isHistorySeed: true when points were just loaded from history — next click
  // starts a fresh path instead of appending
  const isHistorySeed = useRef(false)

  // ── Undo / redo ───────────────────────────────────────────────────────────
  const undoStack = useRef([])
  const redoStack = useRef([])
  const lastKnownPoints = useRef(points)
  const [, forceUpdate] = useState(0)
  const internalChange = useRef(false)

  useEffect(() => {
    if (!internalChange.current && points !== lastKnownPoints.current) {
      undoStack.current = []
      redoStack.current = []
      isHistorySeed.current = false
      setSelectedHistoryIdx(null)
      forceUpdate(n => n + 1)
    }
    internalChange.current = false
    lastKnownPoints.current = points
  })

  const pushHistory = useCallback((prev) => {
    internalChange.current = true
    undoStack.current.push(prev)
    redoStack.current = []
    forceUpdate(n => n + 1)
  }, [])

  // ── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.complete) return

    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    const isBlue = alliance === 'blue'
    const allianceColor = isBlue ? 'rgba(59,130,246,' : 'rgba(239,68,68,'

    ctx.clearRect(0, 0, width, height)

    // Coordinate helpers: normalized (0–1) → canvas px, with flip applied
    const cx = (nx) => flipH ? (1 - nx) * width  : nx * width
    const cy = (ny) => flipV ? (1 - ny) * height : ny * height

    // Field image — flip by transforming the context, then restore
    ctx.save()
    if      (flipH && flipV) { ctx.scale(-1, -1); ctx.translate(-width, -height) }
    else if (flipH)          { ctx.scale(-1,  1); ctx.translate(-width, 0) }
    else if (flipV)          { ctx.scale( 1, -1); ctx.translate(0, -height) }
    ctx.drawImage(img, 0, 0, width, height)
    ctx.restore()

    // Grid (symmetric — looks identical when flipped)
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 0.5
    for (let c = 1; c < GRID_COLS; c++) {
      const x = (c / GRID_COLS) * width
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke()
    }
    for (let r = 1; r < GRID_ROWS; r++) {
      const y = (r / GRID_ROWS) * height
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
    }
    ctx.restore()

    // Feature zone boxes — compute positions through cx/cy so flip applies
    FEATURE_ZONES.forEach(zone => {
      const nxL = isBlue ? zone.xMin : (1 - zone.xMax)
      const nxR = isBlue ? zone.xMax : (1 - zone.xMin)
      const left  = Math.min(cx(nxL), cx(nxR))
      const right = Math.max(cx(nxL), cx(nxR))
      const top   = Math.min(cy(zone.yMin), cy(zone.yMax))
      const h     = Math.abs(cy(zone.yMax) - cy(zone.yMin))

      ctx.save()
      ctx.strokeStyle = `${allianceColor}0.75)`
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 3])
      ctx.strokeRect(left, top, right - left, h)
      ctx.setLineDash([])

      ctx.font = 'bold 9px sans-serif'
      ctx.fillStyle = `${allianceColor}0.9)`
      ctx.textBaseline = 'top'
      // Label aligns to the "near" edge (where the alliance starts)
      const labelLeft = isBlue !== flipH
      ctx.textAlign = labelLeft ? 'left' : 'right'
      ctx.fillText(zone.label, labelLeft ? left + 3 : right - 3, top + 3)
      ctx.restore()
    })

    if (points.length === 0) return

    const pts = points.map(p => ({ x: cx(p.x), y: cy(p.y) }))

    // Connecting lines
    if (pts.length > 1) {
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = LINE_WIDTH
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = color
      ctx.shadowBlur = 4
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      ctx.stroke()
      ctx.restore()
    }

    // Dots + numbers
    pts.forEach((pt, i) => {
      ctx.save()
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, POINT_RADIUS + 1, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fill()
      ctx.restore()

      ctx.save()
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, POINT_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = 8
      ctx.fill()
      ctx.restore()

      ctx.save()
      ctx.font = `bold ${POINT_RADIUS + 3}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#fff'
      ctx.fillText(i + 1, pt.x, pt.y)
      ctx.restore()
    })
  }, [points, color, alliance, flipH, flipV])

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const observer = new ResizeObserver(() => {
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
      draw()
    })
    observer.observe(container)
    canvas.width = container.clientWidth
    canvas.height = container.clientHeight
    return () => observer.disconnect()
  }, [draw])

  useEffect(() => { draw() }, [draw])

  // ── Input handlers ────────────────────────────────────────────────────────
  const getPoint = (clientX, clientY) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    let x = (clientX - rect.left) / rect.width
    let y = (clientY - rect.top) / rect.height
    if (flipH) x = 1 - x
    if (flipV) y = 1 - y
    return { x, y }
  }

  const handleClick = (e) => {
    e.preventDefault()
    const newPoint = getPoint(e.clientX, e.clientY)
    if (isHistorySeed.current) {
      isHistorySeed.current = false
      setSelectedHistoryIdx(null)
      internalChange.current = true
      undoStack.current = []
      redoStack.current = []
      forceUpdate(n => n + 1)
      onChange([newPoint])
      return
    }
    pushHistory(points)
    onChange([...points, newPoint])
  }

  const handleUndo = (e) => {
    e.stopPropagation()
    if (!undoStack.current.length) return
    const prev = undoStack.current.pop()
    redoStack.current.push(points)
    internalChange.current = true
    forceUpdate(n => n + 1)
    onChange(prev)
  }

  const handleRedo = (e) => {
    e.stopPropagation()
    if (!redoStack.current.length) return
    const next = redoStack.current.pop()
    undoStack.current.push(points)
    internalChange.current = true
    forceUpdate(n => n + 1)
    onChange(next)
  }

  const handleClear = (e) => {
    e.stopPropagation()
    if (!points.length) return
    pushHistory(points)
    onChange([])
  }

  return (
    <div className="field-map-outer">
      <div className="field-map-wrapper" ref={containerRef}>
        <img
          ref={imgRef}
          src="/2026-field.png"
          alt=""
          style={{ display: 'none' }}
          onLoad={draw}
        />
        <canvas
          ref={canvasRef}
          className="field-map-canvas"
          onClick={handleClick}
          onTouchEnd={(e) => {
            e.preventDefault()
            const touch = e.changedTouches[0]
            if (!touch) return
            const newPoint = getPoint(touch.clientX, touch.clientY)
            if (isHistorySeed.current) {
              isHistorySeed.current = false
              setSelectedHistoryIdx(null)
              internalChange.current = true
              undoStack.current = []
              redoStack.current = []
              forceUpdate(n => n + 1)
              onChange([newPoint])
              return
            }
            pushHistory(points)
            onChange([...points, newPoint])
          }}
        />
      </div>

      <div className="field-map-controls">
        {/* Previous auton selector */}
        {historyPaths.length > 0 && (
          <select
            className="field-map-history-select"
            value={selectedHistoryIdx ?? ''}
            onChange={e => {
              const idx = e.target.value === '' ? null : Number(e.target.value)
              setSelectedHistoryIdx(idx)
              if (idx !== null && historyPaths[idx]) {
                internalChange.current = true
                isHistorySeed.current = true
                undoStack.current = []
                redoStack.current = []
                forceUpdate(n => n + 1)
                onChange(historyPaths[idx].path)
              } else {
                isHistorySeed.current = false
              }
            }}
            title="Load a previous auton path (click field to start a new one)"
          >
            <option value="">Select Auton</option>
            {historyPaths.map((h, i) => (
              <option key={i} value={i}>M{h.matchNum}</option>
            ))}
          </select>
        )}

        {/* Flip buttons */}
        <button
          type="button"
          className={`field-map-btn icon${flipH ? ' active' : ''}`}
          onClick={() => setFlipH(!flipH)}
          title="Flip field left ↔ right"
        >⟺</button>
        <button
          type="button"
          className={`field-map-btn icon${flipV ? ' active' : ''}`}
          onClick={() => setFlipV(!flipV)}
          title="Flip field top ↕ bottom"
        >↕</button>

        <span className="field-map-divider" />

        {/* Edit controls */}
        <button
          type="button"
          className="field-map-btn icon"
          onClick={handleUndo}
          disabled={undoStack.current.length === 0}
          title="Undo"
        >↩</button>
        <button
          type="button"
          className="field-map-btn icon"
          onClick={handleRedo}
          disabled={redoStack.current.length === 0}
          title="Redo"
        >↪</button>
        <span className="field-map-count">{points.length} pt{points.length !== 1 ? 's' : ''}</span>
        <button
          type="button"
          className="field-map-btn danger"
          onClick={handleClear}
          disabled={points.length === 0}
          title="Clear all points"
        >Clear</button>
      </div>
    </div>
  )
}

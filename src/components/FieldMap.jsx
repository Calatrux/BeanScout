'use client'

import { useRef, useEffect, useCallback, useState } from 'react'

const POINT_RADIUS = 7
const LINE_WIDTH = 2.5
const GRID_COLS = 20
const GRID_ROWS = 12

// ─── Zone layout (normalized 0–1, defined for BLUE/left side) ───────────────
// Red side mirrors these: x_red = 1 − x_blue
// Boxes are sized to sit over the actual field elements in 2026-field.png

export const FEATURE_ZONES = [
  { label: 'Trench', xMin: 0.15, xMax: 0.34, yMin: 0.00, yMax: 0.18 },
  { label: 'Bump',   xMin: 0.15, xMax: 0.34, yMin: 0.20, yMax: 0.38 },
  { label: 'Hub',    xMin: 0.15, xMax: 0.34, yMin: 0.43, yMax: 0.58 },
  { label: 'Bump',   xMin: 0.15, xMax: 0.34, yMin: 0.60, yMax: 0.78 },
  { label: 'Trench', xMin: 0.15, xMax: 0.34, yMin: 0.80, yMax: 1.00 },
]
// ─────────────────────────────────────────────────────────────────────────────

// Returns { left, right } canvas x-coords for a zone x-range
function xRange(xMin, xMax, isBlue, width) {
  if (isBlue) return { left: xMin * width, right: xMax * width }
  return { left: (1 - xMax) * width, right: (1 - xMin) * width }
}

export default function FieldMap({
  points,
  onChange,
  color = '#1B97AD',
  alliance = 'blue',
  ghostPoints = [],
}) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const containerRef = useRef(null)

  // Undo/redo stacks — store snapshots of the points array
  const undoStack = useRef([])
  const redoStack = useRef([])
  // Track last points ref so we can detect external (parent-driven) changes
  const lastKnownPoints = useRef(points)
  const [, forceUpdate] = useState(0)  // used to re-render when stacks change

  // If the parent changes points externally (e.g. "same as previous" toggle),
  // wipe history so undo/redo don't produce surprising results.
  // We use a separate flag ref to distinguish internal vs external updates.
  const internalChange = useRef(false)
  useEffect(() => {
    if (!internalChange.current && points !== lastKnownPoints.current) {
      undoStack.current = []
      redoStack.current = []
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

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.complete) return

    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    const isBlue = alliance === 'blue'
    const allianceColor = isBlue ? 'rgba(59,130,246,' : 'rgba(239,68,68,'

    ctx.clearRect(0, 0, width, height)

    // Field image
    ctx.drawImage(img, 0, 0, width, height)

    // Grid overlay
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

    // ── Feature zone boxes ─────────────────────────────────────────────────
    FEATURE_ZONES.forEach(zone => {
      const { left, right } = xRange(zone.xMin, zone.xMax, isBlue, width)
      const top = zone.yMin * height
      const h = (zone.yMax - zone.yMin) * height

      ctx.save()
      ctx.strokeStyle = `${allianceColor}0.75)`
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 3])
      ctx.strokeRect(left, top, right - left, h)
      ctx.setLineDash([])

      ctx.font = 'bold 9px sans-serif'
      ctx.fillStyle = `${allianceColor}0.9)`
      ctx.textBaseline = 'top'
      ctx.textAlign = isBlue ? 'left' : 'right'
      const labelX = isBlue ? left + 3 : right - 3
      ctx.fillText(zone.label, labelX, top + 3)
      ctx.restore()
    })

    // ── Ghost path (previous auton silhouette, tinted to alliance color) ──
    if (ghostPoints && ghostPoints.length > 0) {
      const gPts = ghostPoints.map(p => ({ x: p.x * width, y: p.y * height }))
      const ghostColor = isBlue ? 'rgba(59,130,246,' : 'rgba(239,68,68,'
      if (gPts.length > 1) {
        ctx.save()
        ctx.strokeStyle = `${ghostColor}0.35)`
        ctx.lineWidth = LINE_WIDTH
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.setLineDash([5, 5])
        ctx.beginPath()
        ctx.moveTo(gPts[0].x, gPts[0].y)
        for (let i = 1; i < gPts.length; i++) ctx.lineTo(gPts[i].x, gPts[i].y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      }
      gPts.forEach(pt => {
        ctx.save()
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, POINT_RADIUS - 1, 0, Math.PI * 2)
        ctx.strokeStyle = `${ghostColor}0.4)`
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.restore()
      })
    }

    if (points.length === 0) return

    // Convert normalized points to canvas coords
    const pts = points.map(p => ({ x: p.x * width, y: p.y * height }))

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

    // Points
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
  }, [points, color, alliance, ghostPoints])

  // Resize canvas to match container
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

  const getCanvasPoint = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    }
  }

  const handleClick = (e) => {
    e.preventDefault()
    pushHistory(points)
    onChange([...points, getCanvasPoint(e)])
  }

  const handleUndo = (e) => {
    e.stopPropagation()
    if (undoStack.current.length === 0) return
    const prev = undoStack.current.pop()
    redoStack.current.push(points)
    internalChange.current = true
    forceUpdate(n => n + 1)
    onChange(prev)
  }

  const handleRedo = (e) => {
    e.stopPropagation()
    if (redoStack.current.length === 0) return
    const next = redoStack.current.pop()
    undoStack.current.push(points)
    internalChange.current = true
    forceUpdate(n => n + 1)
    onChange(next)
  }

  const handleClear = (e) => {
    e.stopPropagation()
    if (points.length === 0) return
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
            const canvas = canvasRef.current
            const rect = canvas.getBoundingClientRect()
            pushHistory(points)
            onChange([...points, {
              x: (touch.clientX - rect.left) / rect.width,
              y: (touch.clientY - rect.top) / rect.height,
            }])
          }}
        />
      </div>
      <div className="field-map-controls">
        <span className="field-map-count">{points.length} pt{points.length !== 1 ? 's' : ''}</span>
        <button
          type="button"
          className="field-map-btn"
          onClick={handleUndo}
          disabled={undoStack.current.length === 0}
          title="Undo"
        >
          ↩ Undo
        </button>
        <button
          type="button"
          className="field-map-btn"
          onClick={handleRedo}
          disabled={redoStack.current.length === 0}
          title="Redo"
        >
          Redo ↪
        </button>
        <button
          type="button"
          className="field-map-btn danger"
          onClick={handleClear}
          disabled={points.length === 0}
          title="Clear all points"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

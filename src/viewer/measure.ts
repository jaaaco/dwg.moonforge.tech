// Measuring on the drawing, the way DIST does it in AutoCAD: pick points and
// read the distance, the offsets, the bearing, a running total, and the area of
// a closed outline. Points snap to the geometry — ends, crossings, midpoints
// and the nearest point of a line — because a reading taken "roughly there" on
// a wall is worth nothing.
//
// Snapping reads the same geometry the PDF export builds (plot.ts), so the two
// features share one pass over the renderer's scene. Segments are bucketed in a
// uniform grid; a segment too long to bucket (a long wall, a grid line) goes to
// a short list scanned on every query instead.
import type { PlotGeometry } from './plot'

export type SnapKind = 'end' | 'cross' | 'mid' | 'edge'

export interface Point {
  x: number
  y: number
}

export interface SnapPoint extends Point {
  kind: SnapKind
}

/** How many cells a segment may cover before it goes to the long list. */
const MAX_CELLS_PER_SEGMENT = 24
/** Cells scanned per axis in one query; a wider radius is clamped to this. */
const MAX_QUERY_CELLS = 24
/** Segments taken into account when looking for a crossing under the cursor. */
const MAX_CROSS_SEGMENTS = 40
/** Grid cells, at most. */
const MAX_CELLS = 1 << 18

export interface SnapIndex {
  /** x0,y0,x1,y1 per segment. */
  seg: Float32Array
  count: number
  minX: number
  minY: number
  cellX: number
  cellY: number
  cols: number
  rows: number
  /** CSR offsets into `items`, one per cell plus a tail. */
  starts: Int32Array
  items: Int32Array
  /** Segments that cover too many cells to bucket. */
  long: Int32Array
  /** Per-segment mark, so one query never looks at a segment twice. */
  stamp: Int32Array
  generation: number
}

/* -------------------------------------------------------------- snap index */

export function buildSnapIndex(geometry: PlotGeometry): SnapIndex {
  let capacity = 0
  for (const stroke of geometry.strokes) {
    // Hatch lines are real geometry on paper but noise to snap to: a wall
    // crossing a hatched wall would offer a hundred meaningless crossings.
    if (stroke.hatch) continue
    capacity += stroke.pts.length / 2 - 1
  }
  const seg = new Float32Array(Math.max(capacity, 1) * 4)
  let count = 0
  for (const stroke of geometry.strokes) {
    if (stroke.hatch) continue
    const p = stroke.pts
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i]
      const ay = p[i + 1]
      const bx = p[i + 2]
      const by = p[i + 3]
      // POINT entities are stored as a zero-length stroke; nothing to snap on.
      if (ax === bx && ay === by) continue
      const o = count++ * 4
      seg[o] = ax
      seg[o + 1] = ay
      seg[o + 2] = bx
      seg[o + 3] = by
    }
  }

  const box = geometry.box
  const width = Math.max(box.maxX - box.minX, 1e-6)
  const height = Math.max(box.maxY - box.minY, 1e-6)
  // Aim for about one cell per segment, so a query touches a handful of them.
  const target = Math.min(Math.max(count, 16), MAX_CELLS)
  const side = Math.sqrt((width * height) / target)
  const cols = Math.max(1, Math.min(2048, Math.round(width / side) || 1))
  const rows = Math.max(1, Math.min(2048, Math.round(height / side) || 1))
  const index: SnapIndex = {
    seg,
    count,
    minX: box.minX,
    minY: box.minY,
    cellX: width / cols,
    cellY: height / rows,
    cols,
    rows,
    starts: new Int32Array(cols * rows + 1),
    items: new Int32Array(0),
    long: new Int32Array(0),
    stamp: new Int32Array(count),
    generation: 0
  }
  if (!Number.isFinite(index.minX) || !Number.isFinite(index.minY)) {
    index.minX = 0
    index.minY = 0
  }

  const long: number[] = []
  const counts = index.starts
  let total = 0
  for (let i = 0; i < count; i++) {
    const o = i * 4
    const cx0 = cellCol(index, Math.min(seg[o], seg[o + 2]))
    const cx1 = cellCol(index, Math.max(seg[o], seg[o + 2]))
    const cy0 = cellRow(index, Math.min(seg[o + 1], seg[o + 3]))
    const cy1 = cellRow(index, Math.max(seg[o + 1], seg[o + 3]))
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_CELLS_PER_SEGMENT) {
      long.push(i)
      continue
    }
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        counts[cy * cols + cx + 1]++
        total++
      }
    }
  }
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1]

  const items = new Int32Array(total)
  const cursor = Int32Array.from(counts.subarray(0, counts.length - 1))
  for (let i = 0; i < count; i++) {
    const o = i * 4
    const cx0 = cellCol(index, Math.min(seg[o], seg[o + 2]))
    const cx1 = cellCol(index, Math.max(seg[o], seg[o + 2]))
    const cy0 = cellRow(index, Math.min(seg[o + 1], seg[o + 3]))
    const cy1 = cellRow(index, Math.max(seg[o + 1], seg[o + 3]))
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_CELLS_PER_SEGMENT) continue
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) items[cursor[cy * cols + cx]++] = i
    }
  }
  index.items = items
  index.long = Int32Array.from(long)
  return index
}

function cellCol(index: SnapIndex, x: number): number {
  const c = Math.floor((x - index.minX) / index.cellX)
  return c < 0 ? 0 : c >= index.cols ? index.cols - 1 : c
}

function cellRow(index: SnapIndex, y: number): number {
  const r = Math.floor((y - index.minY) / index.cellY)
  return r < 0 ? 0 : r >= index.rows ? index.rows - 1 : r
}

// One query at a time, so the candidate list is reused instead of reallocated
// on every pointer move.
const candidates: number[] = []

function collect(index: SnapIndex, x: number, y: number, radius: number): void {
  candidates.length = 0
  const generation = ++index.generation
  const { stamp, starts, items, cols } = index
  const cx0 = cellCol(index, x - radius)
  const cx1 = cellCol(index, x + radius)
  const cy0 = cellRow(index, y - radius)
  const cy1 = cellRow(index, y + radius)
  // Zoomed far out, the radius covers the whole drawing; scanning every cell
  // would stall the pointer, and snapping at that zoom is guesswork anyway.
  const colEnd = Math.min(cx1, cx0 + MAX_QUERY_CELLS)
  const rowEnd = Math.min(cy1, cy0 + MAX_QUERY_CELLS)
  for (let cy = cy0; cy <= rowEnd; cy++) {
    for (let cx = cx0; cx <= colEnd; cx++) {
      const cell = cy * cols + cx
      for (let k = starts[cell]; k < starts[cell + 1]; k++) {
        const id = items[k]
        if (stamp[id] === generation) continue
        stamp[id] = generation
        candidates.push(id)
      }
    }
  }
  for (const id of index.long) {
    if (stamp[id] === generation) continue
    stamp[id] = generation
    candidates.push(id)
  }
}

/** Nearest snap point within `radius` drawing units, or null. */
export function snapAt(index: SnapIndex, x: number, y: number, radius: number): SnapPoint | null {
  if (!index.count) return null
  collect(index, x, y, radius)

  // Ends win over crossings, crossings over midpoints, and anything over a
  // plain point on a line — the same order AutoCAD's object snap uses.
  const rank: Record<SnapKind, number> = { end: 0, cross: 1, mid: 2, edge: 3 }
  let best: SnapPoint | null = null
  let bestRank = 9
  let bestDistance = Infinity
  const consider = (px: number, py: number, kind: SnapKind) => {
    const d = Math.hypot(px - x, py - y)
    if (d > radius) return
    const r = rank[kind]
    if (r > bestRank || (r === bestRank && d >= bestDistance)) return
    best = { x: px, y: py, kind }
    bestRank = r
    bestDistance = d
  }

  const near: number[] = []
  const { seg } = index
  for (const id of candidates) {
    const o = id * 4
    const ax = seg[o]
    const ay = seg[o + 1]
    const bx = seg[o + 2]
    const by = seg[o + 3]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2))
    const px = ax + dx * t
    const py = ay + dy * t
    if (Math.hypot(px - x, py - y) > radius) continue
    if (near.length < MAX_CROSS_SEGMENTS) near.push(id)
    consider(ax, ay, 'end')
    consider(bx, by, 'end')
    consider((ax + bx) / 2, (ay + by) / 2, 'mid')
    consider(px, py, 'edge')
  }

  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const hit = crossing(seg, near[i] * 4, near[j] * 4)
      if (hit) consider(hit.x, hit.y, 'cross')
    }
  }
  return best
}

/** Where two segments cross, if they do inside both of their extents. */
function crossing(seg: Float32Array, a: number, b: number): Point | null {
  const ax = seg[a]
  const ay = seg[a + 1]
  const ux = seg[a + 2] - ax
  const uy = seg[a + 3] - ay
  const bx = seg[b]
  const by = seg[b + 1]
  const vx = seg[b + 2] - bx
  const vy = seg[b + 3] - by
  const denominator = ux * vy - uy * vx
  if (denominator === 0) return null
  const t = ((bx - ax) * vy - (by - ay) * vx) / denominator
  const s = ((bx - ax) * uy - (by - ay) * ux) / denominator
  if (t < 0 || t > 1 || s < 0 || s > 1) return null
  return { x: ax + ux * t, y: ay + uy * t }
}

/* ------------------------------------------------------------------- maths */

export interface ChainStats {
  /** Length of every segment, in drawing units. */
  segments: number[]
  total: number
  /** Area of the outline closed back to its first point. Zero below 3 points. */
  area: number
}

export function chainStats(points: Point[]): ChainStats {
  const segments: number[] = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    segments.push(d)
    total += d
  }
  let area = 0
  if (points.length >= 3) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      area += a.x * b.y - b.x * a.y
    }
    area = Math.abs(area) / 2
  }
  return { segments, total, area }
}

/** Bearing of a→b in degrees, counterclockwise from the positive x axis. */
export function angleOf(a: Point, b: Point): number {
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  return deg < 0 ? deg + 360 : deg
}

/* ------------------------------------------------------------------- units */

// Metres in one drawing unit, by INSUNITS. Missing entries (0, and the US
// survey units, which differ from the international ones by 2 ppm) fall back to
// "the drawing does not say".
const METRES: Record<number, number> = {
  1: 0.0254, 2: 0.3048, 3: 1609.344, 4: 0.001, 5: 0.01, 6: 1, 7: 1000,
  8: 2.54e-8, 9: 2.54e-5, 10: 0.9144, 11: 1e-10, 12: 1e-9, 13: 1e-6,
  14: 0.1, 15: 10, 16: 100, 17: 1e9, 18: 1.495978707e11, 19: 9.4607304725808e15,
  20: 3.0856775814913673e16, 21: 0.3048006096012192, 22: 0.0254000508001016,
  23: 0.914401828803658, 24: 1609.3472186944375
}

const SUFFIX: Record<number, string> = {
  1: 'in', 2: 'ft', 3: 'mi', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km',
  8: 'µin', 9: 'mil', 10: 'yd', 11: 'Å', 12: 'nm', 13: 'µm',
  14: 'dm', 15: 'dam', 16: 'hm', 17: 'Gm', 18: 'au', 19: 'ly', 20: 'pc',
  21: 'ft', 22: 'in', 23: 'yd', 24: 'mi'
}

const IMPERIAL = new Set([1, 2, 3, 8, 9, 10, 21, 22, 23, 24])

export interface DrawingUnits {
  /** INSUNITS. 0 means the drawing does not say what a unit is. */
  insunits: number
  /** Metres in one drawing unit, or null when the drawing does not say. */
  metres: number | null
  /** Unit suffix for the raw reading, empty when unknown. */
  suffix: string
  imperial: boolean
  /** The drawing's own feet-and-inches format, when it uses one. */
  native: ((value: number) => string) | null
}

export const UNITLESS: DrawingUnits = { insunits: 0, metres: null, suffix: '', imperial: false, native: null }

/** What a person can pick when the file's own header is wrong — and it often
 *  is: INSUNITS is a setting nobody has to touch to draw. */
export const UNIT_CHOICES = [4, 5, 6, 1, 2] as const

export function suffixOf(insunits: number): string {
  return SUFFIX[insunits] ?? ''
}

export function unitsOf(insunits: number, native: ((value: number) => string) | null): DrawingUnits {
  return {
    insunits,
    metres: METRES[insunits] ?? null,
    suffix: SUFFIX[insunits] ?? '',
    imperial: IMPERIAL.has(insunits),
    native
  }
}

const formatters = new Map<string, Intl.NumberFormat>()

function num(value: number, locale: string, digits: number): string {
  const key = `${locale}:${digits}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 })
    formatters.set(key, formatter)
  }
  return formatter.format(value)
}

/** Enough decimals to be useful, not enough to look like false precision. */
function digitsFor(value: number): number {
  const v = Math.abs(value)
  if (v >= 100) return 0
  if (v >= 10) return 1
  if (v >= 1) return 2
  return 3
}

/** The reading in the drawing's own units, for example `12 340 mm`. */
export function formatLength(value: number, units: DrawingUnits, locale: string): string {
  if (units.native) {
    const text = units.native(value)
    if (text) return text
  }
  const text = num(value, locale, digitsFor(value))
  return units.suffix ? `${text} ${units.suffix}` : text
}

/** The same length in a unit a person thinks in, or null when it adds nothing. */
export function friendlyLength(value: number, units: DrawingUnits, locale: string): string | null {
  // With no INSUNITS, millimetres are the safe guess: every architectural DWG
  // we have seen is drawn in them. The panel says so in as many words.
  const metres = (units.metres ?? 0.001) * value
  if (!Number.isFinite(metres) || metres === 0) return null
  if (units.imperial) {
    const feet = metres / 0.3048
    if (units.suffix === 'ft' && units.native) return null
    return feetInches(feet, locale)
  }
  const abs = Math.abs(metres)
  const [scaled, suffix] = abs >= 1000 ? [metres / 1000, 'km'] : abs >= 1 ? [metres, 'm'] : [metres * 1000, 'mm']
  if (suffix === units.suffix) return null
  return `${num(scaled, locale, digitsFor(scaled))} ${suffix}`
}

function feetInches(feet: number, locale: string): string {
  const sign = feet < 0 ? '-' : ''
  const whole = Math.floor(Math.abs(feet))
  const inches = (Math.abs(feet) - whole) * 12
  return `${sign}${num(whole, locale, 0)}′ ${num(inches, locale, inches >= 10 ? 1 : 2)}″`
}

export function formatArea(value: number, units: DrawingUnits, locale: string): string {
  const metre = units.metres ?? 0.001
  const squareMetres = value * metre * metre
  if (units.imperial) {
    const squareFeet = squareMetres / 0.09290304
    return `${num(squareFeet, locale, digitsFor(squareFeet))} ft²`
  }
  const abs = Math.abs(squareMetres)
  const [scaled, suffix] = abs >= 1e6 ? [squareMetres / 1e6, 'km²'] : abs >= 0.5 ? [squareMetres, 'm²'] : [squareMetres * 1e4, 'cm²']
  return `${num(scaled, locale, digitsFor(scaled))} ${suffix}`
}

export function formatAngle(degrees: number, locale: string): string {
  return `${num(degrees, locale, 2)}°`
}

/* ----------------------------------------------------------------- drawing */

const LINE_COLOR = '#ff8a3d'
const SNAP_COLOR = '#5ee08a'
const LABEL_INK = '#0c0c0e'
const LABEL_BG = 'rgba(255, 255, 255, 0.92)'

export interface MeasureView {
  /** Drawing units to CSS pixels inside the canvas. */
  toScreen(point: Point): Point
  width: number
  height: number
}

export interface MeasureModel {
  /** Finished measurements, each a chain of points. */
  chains: Point[][]
  /** The chain being picked right now. */
  active: Point[]
  /** Where the pointer is, in drawing units, while a chain is open. */
  preview: Point | null
  snap: SnapPoint | null
  label(length: number): string
}

export function drawMeasure(ctx: CanvasRenderingContext2D, view: MeasureView, model: MeasureModel): void {
  ctx.clearRect(0, 0, view.width, view.height)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.textBaseline = 'middle'

  for (const chain of model.chains) drawChain(ctx, view, model, chain, false)
  if (model.active.length) {
    const points = model.preview ? [...model.active, model.preview] : model.active
    drawChain(ctx, view, model, points, !!model.preview)
  }
  if (model.snap) drawSnap(ctx, view.toScreen(model.snap), model.snap.kind)
}

function drawChain(ctx: CanvasRenderingContext2D, view: MeasureView, model: MeasureModel, points: Point[], rubber: boolean): void {
  if (points.length < 2) {
    if (points.length === 1) drawVertex(ctx, view.toScreen(points[0]))
    return
  }
  const screen = points.map((p) => view.toScreen(p))
  // The outline of a closed shape, so an area reading is visible as one.
  if (points.length >= 3) {
    ctx.beginPath()
    ctx.moveTo(screen[0].x, screen[0].y)
    for (const p of screen.slice(1)) ctx.lineTo(p.x, p.y)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255, 138, 61, 0.12)'
    ctx.fill()
  }

  ctx.beginPath()
  ctx.moveTo(screen[0].x, screen[0].y)
  for (const p of screen.slice(1)) ctx.lineTo(p.x, p.y)
  ctx.strokeStyle = LINE_COLOR
  ctx.lineWidth = 1.6
  ctx.setLineDash(rubber ? [6, 4] : [])
  ctx.stroke()
  ctx.setLineDash([])

  for (const p of screen) drawVertex(ctx, p)
  for (let i = 1; i < points.length; i++) {
    const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    if (length <= 0) continue
    const at = { x: (screen[i - 1].x + screen[i].x) / 2, y: (screen[i - 1].y + screen[i].y) / 2 }
    // Only label a segment long enough on screen to carry a label.
    if (Math.hypot(screen[i].x - screen[i - 1].x, screen[i].y - screen[i - 1].y) < 34) continue
    drawLabel(ctx, at, model.label(length))
  }
}

function drawVertex(ctx: CanvasRenderingContext2D, p: Point): void {
  ctx.beginPath()
  ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
  ctx.fillStyle = LINE_COLOR
  ctx.fill()
}

function drawLabel(ctx: CanvasRenderingContext2D, at: Point, text: string): void {
  const width = ctx.measureText(text).width
  const x = at.x - width / 2 - 4
  const y = at.y - 9
  ctx.fillStyle = LABEL_BG
  ctx.beginPath()
  // roundRect is recent enough (Safari 16.4) to be worth a square fallback.
  if (ctx.roundRect) ctx.roundRect(x, y, width + 8, 18, 4)
  else ctx.rect(x, y, width + 8, 18)
  ctx.fill()
  ctx.fillStyle = LABEL_INK
  ctx.fillText(text, x + 4, y + 9)
}

/** The osnap marker: its shape says what was caught, as in any CAD program. */
function drawSnap(ctx: CanvasRenderingContext2D, p: Point, kind: SnapKind): void {
  const r = 5
  ctx.strokeStyle = SNAP_COLOR
  ctx.lineWidth = 1.8
  ctx.beginPath()
  if (kind === 'end') {
    ctx.rect(p.x - r, p.y - r, r * 2, r * 2)
  } else if (kind === 'mid') {
    ctx.moveTo(p.x - r, p.y + r)
    ctx.lineTo(p.x, p.y - r)
    ctx.lineTo(p.x + r, p.y + r)
    ctx.closePath()
  } else if (kind === 'cross') {
    ctx.moveTo(p.x - r, p.y - r)
    ctx.lineTo(p.x + r, p.y + r)
    ctx.moveTo(p.x + r, p.y - r)
    ctx.lineTo(p.x - r, p.y + r)
  } else {
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  }
  ctx.stroke()
}

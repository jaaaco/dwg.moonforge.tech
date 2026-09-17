// Plotting a drawing to PDF, as a plot in AutoCAD does it: pick the whole
// drawing or a window, a sheet size and a scale, and get vector output.
//
// The renderer keeps the drawing as batched three.js objects, so the geometry
// has to be read back out of them:
//
//   * line batches, either with a plain colour or with a linetype shader whose
//     dash pattern is a uniform (dashed lines become a PDF dash array),
//   * filled meshes: MTEXT glyphs, solid fills and wide polylines, triangulated.
//     Their triangles are turned back into outlines, which is what makes a text
//     paragraph one clean shape instead of a few hundred slivers,
//   * hatch meshes, whose pattern is drawn by a fragment shader over a plain
//     polygon. The pattern lines are the AutoCAD definition (angle, base,
//     offset, dashes), so they are re-created here and clipped to the polygon.
//
// The result is plain geometry in drawing units, which both the PDF writer and
// the on-screen preview draw. Nothing here touches the GPU.
// Structural types instead of three's own: the runtime objects come from the
// renderer, and the viewer does not otherwise need three's type package.
interface AttributeLike {
  count: number
  itemSize: number
  array: ArrayLike<number>
  isInterleavedBufferAttribute?: boolean
  data?: { array: ArrayLike<number>; stride: number }
  offset?: number
}

interface GeometryLike {
  attributes: Record<string, AttributeLike | undefined>
  index: AttributeLike | null
  drawRange: { start: number; count: number }
  instanceCount?: number
}

interface ObjectLike {
  visible: boolean
  parent: ObjectLike | null
  matrixWorld: { elements: ArrayLike<number> }
  geometry?: GeometryLike
  material?: unknown
  [key: string]: unknown
}

interface SceneLike {
  traverse(callback: (obj: ObjectLike) => void): void
}

export interface PlotBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface PlotStroke {
  color: number
  /** Width in drawing units for entities that carry a real lineweight, else 0. */
  widthWorld: number
  /** Dash lengths in drawing units, alternating on/off, or null for a solid line. */
  dash: number[] | null
  /** Distance into the dash pattern at the first point, in drawing units. */
  phase: number
  /** Flat x,y pairs in drawing units. */
  pts: Float32Array
}

export interface PlotFill {
  color: number
  /** Closed contours, flat x,y pairs, filled with the nonzero rule. */
  loops: Float32Array[]
}

export interface PlotGeometry {
  strokes: PlotStroke[]
  fills: PlotFill[]
  box: PlotBox
}

// AcTrGeometryFlags: a batch slot is drawn only when it is both active and
// visible, which is how the renderer hides a layer inside a shared batch.
const FLAG_DRAWN = 3

const MAX_HATCH_LINES = 4000

export function emptyBox(): PlotBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}

export function isEmptyBox(box: PlotBox): boolean {
  return !(box.maxX > box.minX) || !(box.maxY > box.minY)
}

function growBox(box: PlotBox, x: number, y: number): void {
  if (x < box.minX) box.minX = x
  if (y < box.minY) box.minY = y
  if (x > box.maxX) box.maxX = x
  if (y > box.maxY) box.maxY = y
}

/* ------------------------------------------------------------------ reading */

type Anything = any

/** Reads x/y/z from a plain or interleaved attribute without per-call dispatch. */
function reader(attr: AttributeLike) {
  const a = attr as Anything
  if (a.isInterleavedBufferAttribute) {
    const array = a.data.array as ArrayLike<number>
    const stride = a.data.stride as number
    const offset = a.offset as number
    return (i: number, c: number) => array[i * stride + offset + c]
  }
  const array = a.array as ArrayLike<number>
  const size = a.itemSize as number
  return (i: number, c: number) => array[i * size + c]
}

interface Span {
  start: number
  count: number
}

function drawSpan(geometry: GeometryLike, total: number): Span {
  const range = geometry.drawRange
  const start = Math.max(0, range.start | 0)
  const count = range.count == null || !Number.isFinite(range.count) ? total - start : Math.min(range.count, total - start)
  return { start, count: Math.max(0, count) }
}

/** One span per live slot of a batch, clipped to the draw range. */
function subSpans(obj: ObjectLike, span: Span, indexed: boolean): Span[] {
  const info = (obj as Anything)._geometryInfo
  if (!Array.isArray(info) || info.length === 0) return [span]
  const out: Span[] = []
  const end = span.start + span.count
  for (const slot of info) {
    if (!slot || (slot.flags & FLAG_DRAWN) !== FLAG_DRAWN) continue
    const start = indexed ? slot.indexStart : slot.vertexStart
    const count = indexed ? slot.indexCount : slot.vertexCount
    if (!(count > 0) || start < 0) continue
    const from = Math.max(start, span.start)
    const to = Math.min(start + count, end)
    if (to > from) out.push({ start: from, count: to - from })
  }
  return out
}

function firstMaterial(obj: ObjectLike): Anything {
  const material = (obj as Anything).material
  return Array.isArray(material) ? material[0] : material
}

function materialColor(material: Anything): number {
  const direct = material?.color
  if (direct && typeof direct.getHex === 'function') return direct.getHex()
  const uniform = material?.uniforms?.u_color?.value
  if (uniform && typeof uniform.getHex === 'function') return uniform.getHex()
  return 0xffffff
}

function isVisible(obj: ObjectLike): boolean {
  for (let node: ObjectLike | null = obj; node; node = node.parent) if (!node.visible) return false
  return true
}

/** Dash lengths as PDF wants them: alternating on/off, starting with an on. */
interface Dash {
  array: number[]
  /** Added to a path's own distance along the pattern. */
  shift: number
}

function toDash(signed: number[]): Dash | null {
  // Trailing zeros are padding for the shader's fixed-size array.
  let end = signed.length
  while (end > 0 && signed[end - 1] === 0) end--
  const runs: { len: number; on: boolean }[] = []
  for (let i = 0; i < end; i++) {
    const on = signed[i] >= 0
    const len = Math.abs(signed[i])
    const last = runs[runs.length - 1]
    if (last && last.on === on) last.len += len
    else runs.push({ len, on })
  }
  if (runs.length < 2) return null // a single run is a solid line
  let shift = 0
  if (runs.length > 2 && runs[0].on === runs[runs.length - 1].on) {
    // The pattern wraps, so its last and first run are one run. Merging them
    // moves the origin back to where the last run starts.
    const tail = runs.pop() as { len: number; on: boolean }
    runs[0].len += tail.len
    shift += tail.len
  }
  if (!runs[0].on) {
    // PDF reads the array as on, off, on, …: rotate so it starts with a dash.
    const head = runs.shift() as { len: number; on: boolean }
    runs.push(head)
    shift -= head.len
  }
  const array = runs.map((run) => run.len)
  if (!array.some((n) => n > 0)) return null
  return { array, shift }
}

function dashOfMaterial(material: Anything): Dash | null {
  const pattern = material?.uniforms?.pattern?.value
  const length = material?.uniforms?.patternLength?.value
  if (!pattern || !(length > 0)) return null
  const scale = material.uniforms.u_viewportScale?.value ?? 1
  return toDash(Array.from(pattern as ArrayLike<number>, (n) => n * scale))
}

function phaseIn(distance: number, dash: Dash): number {
  let period = 0
  for (const n of dash.array) period += n
  if (!(period > 0)) return 0
  return (((distance + dash.shift) % period) + period) % period
}

/* --------------------------------------------------------------- extraction */

export function buildPlotGeometry(scene: SceneLike): PlotGeometry {
  const geom: PlotGeometry = { strokes: [], fills: [], box: emptyBox() }
  scene.traverse((obj) => {
    const any = obj as Anything
    if (!any.geometry || !isVisible(obj)) return
    if (any.isLineSegments2) addFatLines(obj, geom)
    else if (any.isLineSegments) addLines(obj, geom)
    else if (any.isPoints) addPoints(obj, geom)
    else if (any.isMesh) addMesh(obj, geom)
  })
  return geom
}

function addLines(obj: ObjectLike, geom: PlotGeometry): void {
  const geometry = (obj as Anything).geometry as GeometryLike
  const position = geometry.attributes.position
  if (!position) return
  const index = geometry.index
  const readPos = reader(position)
  const readIndex = index ? reader(index) : null
  const at = (i: number) => (readIndex ? readIndex(i, 0) : i)
  const total = index ? index.count : position.count
  const span = drawSpan(geometry, total)
  const material = firstMaterial(obj)
  const color = materialColor(material)
  const dash = dashOfMaterial(material)
  const distances = geometry.attributes.lineDistance
  const readDistance = distances ? reader(distances) : null
  const m = obj.matrixWorld.elements

  for (const part of subSpans(obj, span, !!index)) {
    let chain: number[] = []
    let phase = 0
    const flush = () => {
      if (chain.length >= 4) geom.strokes.push({ color, widthWorld: 0, dash: dash?.array ?? null, phase, pts: new Float32Array(chain) })
      chain = []
    }
    const end = part.start + part.count - 1
    for (let i = part.start; i < end; i += 2) {
      const a = at(i)
      const b = at(i + 1)
      // Batches pad a slot with degenerate segments; they would print as dots.
      if (a === b) continue
      const ax = worldX(m, readPos, a)
      const ay = worldY(m, readPos, a)
      const bx = worldX(m, readPos, b)
      const by = worldY(m, readPos, b)
      if (ax === bx && ay === by) continue
      const n = chain.length
      if (n === 0 || chain[n - 2] !== ax || chain[n - 1] !== ay) {
        flush()
        phase = dash && readDistance ? phaseIn(readDistance(a, 0), dash) : 0
        chain.push(ax, ay)
      }
      chain.push(bx, by)
      growBox(geom.box, ax, ay)
      growBox(geom.box, bx, by)
    }
    flush()
  }
}

/** Lines drawn with a real lineweight: one instanced segment per slot. */
function addFatLines(obj: ObjectLike, geom: PlotGeometry): void {
  const geometry = (obj as Anything).geometry as GeometryLike
  const start = geometry.attributes.instanceStart
  const finish = geometry.attributes.instanceEnd
  if (!start || !finish) return
  const readStart = reader(start)
  const readEnd = reader(finish)
  const material = firstMaterial(obj)
  const color = materialColor(material)
  const width = material?.worldUnits ? (material.linewidth ?? 0) : 0
  const m = obj.matrixWorld.elements
  const count = Math.min(start.count, (geometry as Anything).instanceCount ?? Infinity)
  for (let i = 0; i < count; i++) {
    const ax = world(m, readStart(i, 0), readStart(i, 1), readStart(i, 2), 0)
    const ay = world(m, readStart(i, 0), readStart(i, 1), readStart(i, 2), 1)
    const bx = world(m, readEnd(i, 0), readEnd(i, 1), readEnd(i, 2), 0)
    const by = world(m, readEnd(i, 0), readEnd(i, 1), readEnd(i, 2), 1)
    if (ax === bx && ay === by) continue
    geom.strokes.push({ color, widthWorld: width, dash: null, phase: 0, pts: new Float32Array([ax, ay, bx, by]) })
    growBox(geom.box, ax, ay)
    growBox(geom.box, bx, by)
  }
}

/** POINT entities: a zero-length stroke, drawn as a dot by the round line cap. */
function addPoints(obj: ObjectLike, geom: PlotGeometry): void {
  const geometry = (obj as Anything).geometry as GeometryLike
  const position = geometry.attributes.position
  if (!position) return
  const readPos = reader(position)
  const color = materialColor(firstMaterial(obj))
  const m = obj.matrixWorld.elements
  for (const part of subSpans(obj, drawSpan(geometry, position.count), false)) {
    for (let i = part.start; i < part.start + part.count; i++) {
      const x = worldX(m, readPos, i)
      const y = worldY(m, readPos, i)
      geom.strokes.push({ color, widthWorld: 0, dash: null, phase: 0, pts: new Float32Array([x, y, x, y]) })
      growBox(geom.box, x, y)
    }
  }
}

function addMesh(obj: ObjectLike, geom: PlotGeometry): void {
  const material = firstMaterial(obj)
  if (material?.uniforms?.u_patternLines) {
    addHatch(obj, material, geom)
    return
  }
  const geometry = (obj as Anything).geometry as GeometryLike
  const position = geometry.attributes.position
  if (!position) return
  const index = geometry.index
  const total = index ? index.count : position.count
  const color = materialColor(material)
  const m = obj.matrixWorld.elements
  for (const part of subSpans(obj, drawSpan(geometry, total), !!index)) {
    const loops = contourLoops(position, index, part, m, geom.box)
    if (loops.length) geom.fills.push({ color, loops })
  }
}

/**
 * Outlines of a triangulated shape. An edge that no neighbouring triangle
 * mirrors is a boundary edge; chaining those gives the original contours, with
 * holes wound the other way round, so a nonzero fill leaves them open. Falls
 * back to the raw triangles when the soup does not chain (degenerate slivers).
 */
function contourLoops(
  position: AttributeLike,
  index: AttributeLike | null,
  span: Span,
  m: ArrayLike<number>,
  box: PlotBox
): Float32Array[] {
  const readPos = reader(position)
  const readIndex = index ? reader(index) : null
  const at = (i: number) => (readIndex ? readIndex(i, 0) : i)
  const triangles = Math.floor(span.count / 3)
  if (triangles === 0) return []
  const stride = position.count
  const directed = new Set<number>()
  const corners: number[] = []
  for (let t = 0; t < triangles; t++) {
    const base = span.start + t * 3
    const a = at(base)
    const b = at(base + 1)
    const c = at(base + 2)
    if (a === b || b === c || a === c) continue
    corners.push(a, b, c)
    directed.add(a * stride + b)
    directed.add(b * stride + c)
    directed.add(c * stride + a)
  }
  const emit = (points: number[][]) =>
    points.map((loop) => {
      const flat = new Float32Array(loop.length * 2)
      for (let i = 0; i < loop.length; i++) {
        const x = worldX(m, readPos, loop[i])
        const y = worldY(m, readPos, loop[i])
        flat[i * 2] = x
        flat[i * 2 + 1] = y
        growBox(box, x, y)
      }
      return flat
    })
  const triangleLoops = () => {
    const loops: number[][] = []
    for (let i = 0; i < corners.length; i += 3) loops.push([corners[i], corners[i + 1], corners[i + 2]])
    return emit(loops)
  }
  if (corners.length === 0) return []

  const next = new Map<number, number[]>()
  for (let i = 0; i < corners.length; i += 3) {
    const tri = [corners[i], corners[i + 1], corners[i + 2]]
    for (let e = 0; e < 3; e++) {
      const from = tri[e]
      const to = tri[(e + 1) % 3]
      if (directed.has(to * stride + from)) continue // shared with a neighbour
      const list = next.get(from)
      if (list) list.push(to)
      else next.set(from, [to])
    }
  }
  if (next.size === 0) return triangleLoops()

  const loops: number[][] = []
  for (const [from, list] of next) {
    while (list.length > 0) {
      const loop = [from]
      let vertex = list.pop() as number
      let guard = 0
      while (vertex !== from) {
        if (++guard > 100_000) return triangleLoops()
        loop.push(vertex)
        const onward = next.get(vertex)
        if (!onward || onward.length === 0) return triangleLoops()
        vertex = onward.pop() as number
      }
      if (loop.length >= 3) loops.push(loop)
    }
  }
  return loops.length ? emit(loops) : triangleLoops()
}

/**
 * Hatch pattern lines, clipped to the hatch polygon. Mirrors what the hatch
 * fragment shader does: every pattern line is a family of parallel lines spaced
 * by the offset, in a frame rotated by the pattern angle, optionally dashed
 * along its length with a per-line stagger.
 */
function addHatch(obj: ObjectLike, material: Anything, geom: PlotGeometry): void {
  const geometry = (obj as Anything).geometry as GeometryLike
  const position = geometry.attributes.position
  if (!position) return
  const index = geometry.index
  const readPos = reader(position)
  const readIndex = index ? reader(index) : null
  const at = (i: number) => (readIndex ? readIndex(i, 0) : i)
  const span = drawSpan(geometry, index ? index.count : position.count)
  const color = materialColor(material)
  const patternAngle = material.uniforms.u_patternAngle?.value ?? 0
  const lines = material.uniforms.u_patternLines?.value ?? []
  const m = obj.matrixWorld.elements

  // Object space: the shader compares the raw position attribute to the pattern.
  const tris: number[] = []
  for (const part of subSpans(obj, span, !!index)) {
    const count = Math.floor(part.count / 3)
    for (let t = 0; t < count; t++) {
      const base = part.start + t * 3
      for (let c = 0; c < 3; c++) {
        const v = at(base + c)
        tris.push(readPos(v, 0), readPos(v, 1))
      }
    }
  }
  if (tris.length === 0) return

  for (const line of lines) {
    const patternLength = line.patternLength ?? 0
    const cosP = Math.cos(patternAngle)
    const sinP = Math.sin(patternAngle)
    const baseX = line.base.x * cosP - line.base.y * sinP
    const baseY = line.base.x * sinP + line.base.y * cosP
    const offsetX = line.offset.x
    const offsetY = line.offset.y
    const spacing = patternLength > 0 ? Math.abs(offsetY) : Math.hypot(offsetX, offsetY)
    if (!(spacing > 1e-9)) continue
    const theta = (line.angle ?? 0) + patternAngle
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    const dash = patternLength > 0 ? toDash(Array.from(line.dashLengths as ArrayLike<number>)) : null

    // Triangles in the frame of this pattern line.
    const local = new Float64Array(tris.length)
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < tris.length; i += 2) {
      const dx = tris[i] - baseX
      const dy = tris[i + 1] - baseY
      const y = cos * dy - sin * dx
      local[i] = cos * dx + sin * dy
      local[i + 1] = y
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const first = Math.ceil(minY / spacing)
    const last = Math.floor(maxY / spacing)
    if (last - first > MAX_HATCH_LINES) continue

    for (let k = first; k <= last; k++) {
      const y = k * spacing
      const intervals: number[][] = []
      for (let t = 0; t < local.length; t += 6) {
        let lo = Infinity
        let hi = -Infinity
        let hits = 0
        for (let e = 0; e < 3; e++) {
          const x0 = local[t + e * 2]
          const y0 = local[t + e * 2 + 1]
          const x1 = local[t + ((e + 1) % 3) * 2]
          const y1 = local[t + ((e + 1) % 3) * 2 + 1]
          // Half-open test, so a vertex exactly on the line counts once.
          if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
            const x = x0 + ((y - y0) / (y1 - y0)) * (x1 - x0)
            if (x < lo) lo = x
            if (x > hi) hi = x
            hits++
          }
        }
        if (hits >= 2 && hi > lo) intervals.push([lo, hi])
      }
      if (intervals.length === 0) continue
      intervals.sort((a, b) => a[0] - b[0])
      // Merge, so adjacent triangles do not each draw the same stretch.
      let [from, to] = intervals[0]
      for (let i = 1; i <= intervals.length; i++) {
        const next = intervals[i]
        if (next && next[0] <= to + 1e-9) {
          if (next[1] > to) to = next[1]
          continue
        }
        const stagger = patternLength > 0 && offsetY !== 0 ? (y * offsetX) / offsetY : 0
        const ax = cos * from - sin * y + baseX
        const ay = cos * y + sin * from + baseY
        const bx = cos * to - sin * y + baseX
        const by = cos * y + sin * to + baseY
        const p0x = world(m, ax, ay, 0, 0)
        const p0y = world(m, ax, ay, 0, 1)
        const p1x = world(m, bx, by, 0, 0)
        const p1y = world(m, bx, by, 0, 1)
        geom.strokes.push({
          color,
          widthWorld: 0,
          dash: dash?.array ?? null,
          phase: dash ? phaseIn(from - stagger, dash) : 0,
          pts: new Float32Array([p0x, p0y, p1x, p1y])
        })
        growBox(geom.box, p0x, p0y)
        growBox(geom.box, p1x, p1y)
        if (next) [from, to] = next
      }
    }
  }
}

type Read = (i: number, c: number) => number

function world(m: ArrayLike<number>, x: number, y: number, z: number, axis: 0 | 1): number {
  return axis === 0 ? m[0] * x + m[4] * y + m[8] * z + m[12] : m[1] * x + m[5] * y + m[9] * z + m[13]
}

function worldX(m: ArrayLike<number>, read: Read, i: number): number {
  return world(m, read(i, 0), read(i, 1), read(i, 2), 0)
}

function worldY(m: ArrayLike<number>, read: Read, i: number): number {
  return world(m, read(i, 0), read(i, 1), read(i, 2), 1)
}

/* ------------------------------------------------------------------- layout */

export const PAPER_SIZES = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  A0: [841, 1189],
  letter: [215.9, 279.4]
} as const

export type PaperName = keyof typeof PAPER_SIZES
export type Orientation = 'auto' | 'portrait' | 'landscape'

export interface PlotLayout {
  widthMm: number
  heightMm: number
  /** Paper millimetres per drawing unit. */
  scale: number
  offsetXMm: number
  offsetYMm: number
  /** True when the area does not fit the sheet at the chosen scale. */
  clipped: boolean
}

export function planLayout(
  area: PlotBox,
  paper: PaperName,
  orientation: Orientation,
  marginMm: number,
  fixedScale: number | null
): PlotLayout {
  const [shortSide, longSide] = PAPER_SIZES[paper]
  const areaWidth = Math.max(area.maxX - area.minX, 1e-9)
  const areaHeight = Math.max(area.maxY - area.minY, 1e-9)
  // Auto picks whichever way round the drawing comes out bigger on the sheet.
  const fitIn = (w: number, h: number) =>
    Math.min(Math.max(w - 2 * marginMm, 1) / areaWidth, Math.max(h - 2 * marginMm, 1) / areaHeight)
  const landscape =
    orientation === 'landscape' || (orientation === 'auto' && fitIn(longSide, shortSide) > fitIn(shortSide, longSide))
  const widthMm = landscape ? longSide : shortSide
  const heightMm = landscape ? shortSide : longSide
  const usableWidth = Math.max(widthMm - 2 * marginMm, 1)
  const usableHeight = Math.max(heightMm - 2 * marginMm, 1)
  const fitScale = Math.min(usableWidth / areaWidth, usableHeight / areaHeight)
  const scale = fixedScale ?? fitScale
  return {
    widthMm,
    heightMm,
    scale,
    offsetXMm: (widthMm - areaWidth * scale) / 2,
    offsetYMm: (heightMm - areaHeight * scale) / 2,
    clipped: scale > fitScale * 1.0001
  }
}

export interface PlotView {
  area: PlotBox
  layout: PlotLayout
  mono: boolean
  lineWidthMm: number
}

export interface PlotSink {
  /** Anything smaller than this in paper millimetres may be dropped. */
  minFeatureMm: number
  stroke(color: number, widthMm: number, dash: number[] | null, phaseMm: number, points: number[]): void
  fill(color: number, loops: number[][]): void
}

/** White and near-white are drawn for a dark canvas; on paper they go black. */
function paperColor(color: number, mono: boolean): number {
  if (mono) return 0
  const r = (color >> 16) & 255
  const g = (color >> 8) & 255
  const b = color & 255
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.88 ? 0 : color
}

export function renderPlot(geom: PlotGeometry, sink: PlotSink, view: PlotView): void {
  const { area, layout, mono } = view
  const s = layout.scale
  const toX = (x: number) => (x - area.minX) * s + layout.offsetXMm
  const toY = (y: number) => (y - area.minY) * s + layout.offsetYMm
  const outside = (minX: number, minY: number, maxX: number, maxY: number) =>
    maxX < area.minX || minX > area.maxX || maxY < area.minY || minY > area.maxY

  for (const stroke of geom.strokes) {
    const pts = stroke.pts
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < minX) minX = pts[i]
      if (pts[i] > maxX) maxX = pts[i]
      if (pts[i + 1] < minY) minY = pts[i + 1]
      if (pts[i + 1] > maxY) maxY = pts[i + 1]
    }
    if (outside(minX, minY, maxX, maxY)) continue
    const sizeMm = Math.max(maxX - minX, maxY - minY) * s
    const dot = pts.length === 4 && minX === maxX && minY === maxY
    if (sizeMm < sink.minFeatureMm && !dot) continue
    const out = new Array<number>(pts.length)
    for (let i = 0; i < pts.length; i += 2) {
      out[i] = toX(pts[i])
      out[i + 1] = toY(pts[i + 1])
    }
    const width = stroke.widthWorld > 0 ? Math.max(stroke.widthWorld * s, view.lineWidthMm) : view.lineWidthMm
    sink.stroke(
      paperColor(stroke.color, mono),
      width,
      stroke.dash ? stroke.dash.map((n) => n * s) : null,
      stroke.phase * s,
      out
    )
  }

  for (const fill of geom.fills) {
    const loops: number[][] = []
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const loop of fill.loops) {
      const out = new Array<number>(loop.length)
      for (let i = 0; i < loop.length; i += 2) {
        const x = loop[i]
        const y = loop[i + 1]
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        out[i] = toX(x)
        out[i + 1] = toY(y)
      }
      loops.push(out)
    }
    if (outside(minX, minY, maxX, maxY)) continue
    if (Math.max(maxX - minX, maxY - minY) * s < sink.minFeatureMm) continue
    sink.fill(paperColor(fill.color, mono), loops)
  }
}

/* ---------------------------------------------------------------------- pdf */

const PT_PER_MM = 72 / 25.4

function fmt(n: number): string {
  const v = Math.round(n * 100) / 100
  return Object.is(v, -0) ? '0' : String(v)
}

function pdfColor(color: number): string {
  const r = ((color >> 16) & 255) / 255
  const g = ((color >> 8) & 255) / 255
  const b = (color & 255) / 255
  return `${fmt3(r)} ${fmt3(g)} ${fmt3(b)}`
}

function fmt3(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

class PdfSink implements PlotSink {
  minFeatureMm = 0
  readonly ops: string[] = []
  private strokeColor = ''
  private fillColor = ''
  private width = ''
  private dash = ''

  stroke(color: number, widthMm: number, dash: number[] | null, phaseMm: number, points: number[]): void {
    const nextColor = pdfColor(color)
    if (nextColor !== this.strokeColor) {
      this.ops.push(`${nextColor} RG`)
      this.strokeColor = nextColor
    }
    const nextWidth = fmt3(widthMm * PT_PER_MM)
    if (nextWidth !== this.width) {
      this.ops.push(`${nextWidth} w`)
      this.width = nextWidth
    }
    const nextDash = dash && dash.some((n) => n > 0) ? `[${dash.map((n) => fmt(n * PT_PER_MM)).join(' ')}] ${fmt(phaseMm * PT_PER_MM)} d` : '[] 0 d'
    if (nextDash !== this.dash) {
      this.ops.push(nextDash)
      this.dash = nextDash
    }
    const path: string[] = []
    for (let i = 0; i < points.length; i += 2) {
      path.push(`${fmt(points[i] * PT_PER_MM)} ${fmt(points[i + 1] * PT_PER_MM)} ${i === 0 ? 'm' : 'l'}`)
    }
    this.ops.push(path.join(' ') + ' S')
  }

  fill(color: number, loops: number[][]): void {
    const nextColor = pdfColor(color)
    if (nextColor !== this.fillColor) {
      this.ops.push(`${nextColor} rg`)
      this.fillColor = nextColor
    }
    const path: string[] = []
    for (const loop of loops) {
      for (let i = 0; i < loop.length; i += 2) {
        path.push(`${fmt(loop[i] * PT_PER_MM)} ${fmt(loop[i + 1] * PT_PER_MM)} ${i === 0 ? 'm' : 'l'}`)
      }
      path.push('h')
    }
    this.ops.push(path.join(' ') + ' f')
  }
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

/** A PDF text string: plain when it is ASCII, UTF-16BE hex when it is not, so a
 *  Polish file name survives into the document properties. */
function pdfString(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return `(${value.replace(/[\\()]/g, (c) => `\\${c}`)})`
  let hex = 'FEFF'
  for (const char of value) {
    for (let i = 0; i < char.length; i++) hex += char.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()
  }
  return `<${hex}>`
}

function pdfDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

export interface PdfOptions {
  title: string
  /** Shown in the reader's document properties, e.g. "1:50". */
  subject?: string
}

/**
 * Writes a one-page PDF. Everything is a path, so there are no fonts to embed
 * and no licensing question about the drawing's typeface.
 */
export async function plotToPdf(geom: PlotGeometry, view: PlotView, options: PdfOptions): Promise<Blob> {
  const sink = new PdfSink()
  renderPlot(geom, sink, view)
  const { widthMm, heightMm } = view.layout
  const widthPt = widthMm * PT_PER_MM
  const heightPt = heightMm * PT_PER_MM
  const clip = [
    `${fmt(view.layout.offsetXMm * PT_PER_MM)} ${fmt(view.layout.offsetYMm * PT_PER_MM)}`,
    `${fmt((view.area.maxX - view.area.minX) * view.layout.scale * PT_PER_MM)} ${fmt((view.area.maxY - view.area.minY) * view.layout.scale * PT_PER_MM)} re W n`
  ].join(' ')
  const content = `q 1 J 1 j ${clip}\n${sink.ops.join('\n')}\nQ\n`
  const raw = new TextEncoder().encode(content)
  const packed = await deflate(raw)
  const body = packed ?? raw

  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (n: number, head: string, stream?: Uint8Array) => {
    offsets[n] = length
    push(`${n} 0 obj\n${head}\n`)
    if (stream) {
      push('stream\n')
      push(stream)
      push('\nendstream\n')
    }
    push('endobj\n')
  }

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(widthPt)} ${fmt(heightPt)}] /Resources << >> /Contents 4 0 R >>`)
  object(4, `<< /Length ${body.length}${packed ? ' /Filter /FlateDecode' : ''} >>`, body)
  object(
    5,
    `<< /Producer (dwg.moonforge.tech) /Creator (dwg.moonforge.tech) /Title (${pdfString(options.title)})${
      options.subject ? ` /Subject (${pdfString(options.subject)})` : ''
    } /CreationDate (${pdfDate(new Date())}) >>`
  )

  const xref = length
  let table = `xref\n0 6\n0000000000 65535 f \n`
  for (let n = 1; n <= 5; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  push(table)
  push(`trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

/* ------------------------------------------------------------------ preview */

/**
 * Draws the same geometry on a canvas. Strokes are batched by style, which
 * keeps a preview of a drawing with 100 000 segments in the tens of
 * milliseconds; the dash phase of the first stroke in a run is good enough for
 * a thumbnail.
 */
export function drawPreview(geom: PlotGeometry, view: PlotView, ctx: CanvasRenderingContext2D, pxPerMm: number): void {
  const { widthMm, heightMm } = view.layout
  ctx.save()
  ctx.clearRect(0, 0, widthMm * pxPerMm, heightMm * pxPerMm)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, widthMm * pxPerMm, heightMm * pxPerMm)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const X = (mm: number) => mm * pxPerMm
  const Y = (mm: number) => (heightMm - mm) * pxPerMm

  let path: Path2D | null = null
  let style = ''
  const flush = () => {
    if (path) ctx.stroke(path)
    path = null
  }
  const sink: PlotSink = {
    minFeatureMm: 0.4 / pxPerMm,
    stroke(color, widthMm2, dash, phaseMm, points) {
      const key = `${color}|${widthMm2}|${dash?.join(',') ?? ''}`
      if (key !== style) {
        flush()
        style = key
        ctx.strokeStyle = css(color)
        ctx.lineWidth = Math.max(widthMm2 * pxPerMm, 0.5)
        ctx.setLineDash(dash ? dash.map((n) => Math.max(n * pxPerMm, 0.2)) : [])
        ctx.lineDashOffset = phaseMm * pxPerMm
      }
      path ??= new Path2D()
      for (let i = 0; i < points.length; i += 2) {
        if (i === 0) path.moveTo(X(points[0]), Y(points[1]))
        else path.lineTo(X(points[i]), Y(points[i + 1]))
      }
    },
    fill(color, loops) {
      flush()
      style = ''
      const shape = new Path2D()
      for (const loop of loops) {
        for (let i = 0; i < loop.length; i += 2) {
          if (i === 0) shape.moveTo(X(loop[0]), Y(loop[1]))
          else shape.lineTo(X(loop[i]), Y(loop[i + 1]))
        }
        shape.closePath()
      }
      ctx.fillStyle = css(color)
      ctx.fill(shape, 'nonzero')
    }
  }
  renderPlot(geom, sink, view)
  flush()
  ctx.restore()
}

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

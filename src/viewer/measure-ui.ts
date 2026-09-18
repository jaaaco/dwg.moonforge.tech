// The measuring tool: clicking on the drawing places points, the overlay draws
// the chain, and the readout gives the distance, the offsets, the bearing, the
// running total and the area. Loaded on demand, the first time someone measures.
//
// Clicks are read on the drawing container rather than on an overlay that
// swallows them, so panning and zooming keep working while measuring: a drag
// pans as usual, and only a press that does not travel counts as a pick.
import {
  angleOf,
  buildSnapIndex,
  chainStats,
  drawMeasure,
  formatAngle,
  formatArea,
  formatLength,
  friendlyLength,
  snapAt,
  suffixOf,
  UNIT_CHOICES,
  UNITLESS,
  unitsOf,
  type DrawingUnits,
  type Point,
  type SnapIndex,
  type SnapKind,
  type SnapPoint
} from './measure'
import type { PlotGeometry } from './plot'
import type { Engine } from './types'

type Strings = Record<string, string>

export interface MeasureUi {
  toggle(): void
  close(): void
  /** Drop every measurement: the drawing they were taken on is gone. */
  reset(): void
  isOpen(): boolean
}

/** How far a press may travel and still count as a pick, not a pan. A finger
 *  never holds still, so it gets more room than a mouse. */
const CLICK_SLOP_PX = 5
const CLICK_SLOP_PX_TOUCH = 12
const SNAP_PX = 14
const SNAP_PX_TOUCH = 22

export function mountMeasureUi(root: HTMLElement, t: Strings, engineOf: () => Engine | null): MeasureUi {
  const $ = <T extends HTMLElement>(role: string) => root.querySelector<T>(`[data-role="${role}"]`)!
  const container = $('canvas')
  const canvas = $<HTMLCanvasElement>('measure-canvas')
  const panel = $('measure')
  const readout = $('measure-readout')
  const hint = $('measure-hint')
  const unitsSelect = $<HTMLSelectElement>('measure-units')
  const toggleButton = $<HTMLButtonElement>('measure-toggle')

  const locale = document.documentElement.lang || 'en'
  const coarse = matchMedia('(pointer: coarse)').matches
  const snapPixels = coarse ? SNAP_PX_TOUCH : SNAP_PX
  const clickSlop = coarse ? CLICK_SLOP_PX_TOUCH : CLICK_SLOP_PX

  let open = false
  let chains: Point[][] = []
  let active: Point[] = []
  let preview: Point | null = null
  let snap: SnapPoint | null = null
  let index: SnapIndex | null = null
  let indexFor: PlotGeometry | null = null
  let fileUnits: DrawingUnits = UNITLESS
  let units: DrawingUnits = UNITLESS
  let dirty = true
  let viewKey = ''
  let frame = 0

  const length = (value: number) => formatLength(value, units, locale)

  // INSUNITS is a header variable nobody has to set in order to draw, and
  // plenty of drawings carry the wrong one (a plan drawn in centimetres that
  // calls itself millimetres is common). The file's answer is the default; the
  // person reading the drawing gets to overrule it.
  function fillUnits(): void {
    const chosen = unitsSelect.value || 'file'
    const option = (value: string, label: string) => {
      const element = document.createElement('option')
      element.value = value
      element.textContent = label
      return element
    }
    unitsSelect.replaceChildren(
      option('file', fileUnits.suffix ? `${t.mUnitsFile} (${fileUnits.suffix})` : t.mUnitsFile),
      ...UNIT_CHOICES.map((code) => option(String(code), suffixOf(code)))
    )
    unitsSelect.value = chosen
    if (!unitsSelect.value) unitsSelect.value = 'file'
    applyUnits()
  }

  function applyUnits(): void {
    units = unitsSelect.value === 'file' ? fileUnits : unitsOf(Number(unitsSelect.value), null)
  }

  /** The snapping index, rebuilt whenever the drawing's geometry changed. */
  function ensureIndex(): SnapIndex | null {
    const engine = engineOf()
    if (!engine?.hasDrawing()) return null
    try {
      const geometry = engine.plotGeometry()
      if (!index || indexFor !== geometry) {
        const started = performance.now()
        index = buildSnapIndex(geometry)
        indexFor = geometry
        if (import.meta.env.DEV) {
          console.debug(`[measure] ${index.count} segments indexed in ${Math.round(performance.now() - started)} ms`)
        }
      }
      return index
    } catch (err) {
      console.error(err)
      return null
    }
  }

  /** One screen pixel in drawing units. */
  function pixelSize(engine: Engine): number {
    const view = engine.viewBox()
    const rect = container.getBoundingClientRect()
    if (!view || !rect.width) return 0
    return (view.maxX - view.minX) / rect.width
  }

  function pointAt(clientX: number, clientY: number): { point: Point; snapped: SnapPoint | null } | null {
    const engine = engineOf()
    if (!engine) return null
    const world = engine.screenToWorld(clientX, clientY)
    if (!world) return null
    const radius = pixelSize(engine) * snapPixels
    const snapIndex = radius > 0 ? ensureIndex() : null
    const found = snapIndex ? snapAt(snapIndex, world.x, world.y, radius) : null
    return { point: found ? { x: found.x, y: found.y } : world, snapped: found }
  }

  function addPoint(clientX: number, clientY: number): void {
    const hit = pointAt(clientX, clientY)
    if (!hit) return
    const last = active[active.length - 1]
    // The second click of a double-click lands on the point just placed; a
    // zero-length segment is not a measurement.
    if (last && Math.hypot(last.x - hit.point.x, last.y - hit.point.y) < 1e-9) return
    active.push(hit.point)
    preview = null
    dirty = true
    render()
  }

  function finish(): void {
    if (active.length >= 2) chains.push(active)
    active = []
    preview = null
    dirty = true
    render()
  }

  function clear(): void {
    chains = []
    active = []
    preview = null
    dirty = true
    render()
  }

  /* ------------------------------------------------------------- pointers */

  let pressedAt: { x: number; y: number } | null = null

  const onDown = (event: PointerEvent) => {
    if (open && event.button === 0) pressedAt = { x: event.clientX, y: event.clientY }
  }
  const onUp = (event: PointerEvent) => {
    const start = pressedAt
    pressedAt = null
    if (!open || event.button !== 0 || !start) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > clickSlop) return
    addPoint(event.clientX, event.clientY)
  }
  const onMove = (event: PointerEvent) => {
    if (!open) return
    const hit = pointAt(event.clientX, event.clientY)
    snap = hit?.snapped ?? null
    preview = active.length ? hit?.point ?? null : null
    dirty = true
    render()
  }
  const onLeave = () => {
    if (!open) return
    snap = null
    preview = null
    dirty = true
  }
  const onContextMenu = (event: MouseEvent) => {
    if (!open || !active.length) return
    event.preventDefault()
    finish()
  }
  const onKey = (event: KeyboardEvent) => {
    if (!open) return
    if (event.key === 'Escape') {
      if (active.length) finish()
      else setOpen(false)
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      if (!active.length) return
      event.preventDefault()
      active.pop()
      dirty = true
      render()
    }
  }

  container.addEventListener('pointerdown', onDown, { capture: true })
  container.addEventListener('pointerup', onUp, { capture: true })
  container.addEventListener('pointermove', onMove, { capture: true, passive: true })
  container.addEventListener('pointerleave', onLeave)
  container.addEventListener('dblclick', () => open && finish())
  container.addEventListener('contextmenu', onContextMenu)
  addEventListener('keydown', onKey)

  /* -------------------------------------------------------------- readout */

  function render(): void {
    const shown = active.length && preview ? [...active, preview] : active.length ? active : chains[chains.length - 1] ?? []
    const stats = chainStats(shown)
    const lines: { text: string; main?: boolean }[] = []
    if (stats.segments.length) {
      const last = stats.segments[stats.segments.length - 1]
      const a = shown[shown.length - 2]
      const b = shown[shown.length - 1]
      const friendly = friendlyLength(last, units, locale)
      lines.push({ text: friendly ? `${length(last)} · ${friendly}` : length(last), main: true })
      lines.push({
        text: `dx ${length(Math.abs(b.x - a.x))} · dy ${length(Math.abs(b.y - a.y))} · ${formatAngle(angleOf(a, b), locale)}`
      })
      if (stats.segments.length > 1) lines.push({ text: `${t.mTotal} ${length(stats.total)}` })
      if (shown.length >= 3) lines.push({ text: `${t.mArea} ${formatArea(stats.area, units, locale)}` })
    } else {
      lines.push({ text: t.mNothing })
    }

    readout.replaceChildren(
      ...lines.map(({ text, main }) => {
        const row = document.createElement('div')
        if (main) row.className = 'measure-main'
        row.textContent = text
        return row
      })
    )

    const notes: string[] = []
    notes.push(active.length ? t.mHintMore : t.mHint)
    if (!units.metres) notes.push(t.mUnitless)
    hint.replaceChildren()
    if (snap) {
      const caught = document.createElement('span')
      caught.className = 'measure-snap'
      caught.textContent = `● ${snapName(snap.kind)}`
      hint.append(caught, document.createTextNode(' · '))
    }
    hint.append(document.createTextNode(notes.join(' · ')))
  }

  function snapName(kind: SnapKind): string {
    return kind === 'end' ? t.mSnapEnd : kind === 'mid' ? t.mSnapMid : kind === 'cross' ? t.mSnapCross : t.mSnapEdge
  }

  /* --------------------------------------------------------------- canvas */

  function loop(): void {
    frame = requestAnimationFrame(loop)
    const engine = engineOf()
    const view = engine?.viewBox()
    if (!view) return
    const rect = container.getBoundingClientRect()
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    const dpr = Math.min(devicePixelRatio || 1, 2)
    // Redraw when the drawing moved under the overlay, or when a point changed.
    const key = `${width}x${height}@${dpr}:${view.minX},${view.minY},${view.maxX},${view.maxY}`
    if (!dirty && key === viewKey) return
    viewKey = key
    dirty = false
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const scaleX = width / (view.maxX - view.minX)
    const scaleY = height / (view.maxY - view.minY)
    drawMeasure(
      ctx,
      {
        width,
        height,
        toScreen: (p) => ({ x: (p.x - view.minX) * scaleX, y: (view.maxY - p.y) * scaleY })
      },
      { chains, active, preview, snap, label: length }
    )
  }

  function setOpen(value: boolean): void {
    if (open === value) return
    open = value
    panel.hidden = !value
    canvas.hidden = !value
    toggleButton.setAttribute('aria-expanded', String(value))
    if (value) {
      root.dataset.measure = '1'
      fileUnits = engineOf()?.units() ?? UNITLESS
      fillUnits()
      // Build the index now, while the panel is appearing, rather than on the
      // first pointer move: a large drawing takes a moment.
      requestAnimationFrame(() => ensureIndex())
      dirty = true
      render()
      if (!frame) frame = requestAnimationFrame(loop)
    } else {
      delete root.dataset.measure
      cancelAnimationFrame(frame)
      frame = 0
      snap = null
      preview = null
    }
  }

  unitsSelect.addEventListener('change', () => {
    applyUnits()
    dirty = true
    render()
  })
  $('measure-close').addEventListener('click', () => setOpen(false))
  $('measure-clear').addEventListener('click', clear)

  return {
    toggle: () => setOpen(panel.hidden !== false),
    close: () => setOpen(false),
    reset: () => {
      index = null
      indexFor = null
      fileUnits = engineOf()?.units() ?? UNITLESS
      unitsSelect.value = 'file'
      fillUnits()
      clear()
    },
    isOpen: () => open
  }
}

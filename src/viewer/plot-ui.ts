// The export panel: area, sheet, orientation, scale, colours, and a preview
// drawn from the very geometry that goes into the PDF, so what you see is what
// gets written. Loaded on demand, the first time someone opens the panel.
import {
  drawPreview,
  isEmptyBox,
  planLayout,
  plotToPdf,
  type Orientation,
  type PaperName,
  type PlotBox,
  type PlotGeometry,
  type PlotView
} from './plot'
import type { Engine } from './types'

type Strings = Record<string, string>

export interface PlotUi {
  toggle(): void
  close(): void
  isOpen(): boolean
}

const MARGIN_MM = 10
const PREVIEW_MAX_W = 240
const PREVIEW_MAX_H = 260

export function mountPlotUi(root: HTMLElement, t: Strings, engineOf: () => Engine | null, fileNameOf: () => string): PlotUi {
  const $ = <T extends HTMLElement>(role: string) => root.querySelector<T>(`[data-role="${role}"]`)!
  const panel = $('plot')
  const toggleButton = $<HTMLButtonElement>('plot-toggle')
  const canvas = $<HTMLCanvasElement>('plot-canvas')
  const note = $('plot-note')
  const areaSelect = $<HTMLSelectElement>('plot-area')
  const paperSelect = $<HTMLSelectElement>('plot-paper')
  const orientationSelect = $<HTMLSelectElement>('plot-orientation')
  const scaleSelect = $<HTMLSelectElement>('plot-scale')
  const colorsSelect = $<HTMLSelectElement>('plot-colors')
  const widthSelect = $<HTMLSelectElement>('plot-width')
  const saveButton = $<HTMLButtonElement>('plot-save')
  const pick = $('pick')
  const pickRect = $('pick-rect')

  let windowBox: PlotBox | null = null
  let ready: { geometry: PlotGeometry; view: PlotView } | null = null
  let pending = 0

  const say = (text: string) => {
    note.textContent = text
  }

  function areaBox(engine: Engine): PlotBox | null {
    if (areaSelect.value === 'window' && windowBox) return windowBox
    if (areaSelect.value === 'view') return engine.viewBox()
    return engine.extents()
  }

  function scaleLabel(scale: number): string {
    // One drawing unit is taken to be one millimetre, as it is in every
    // architectural DWG we have seen; the note under the preview says so.
    const round = (n: number) => String(n >= 10 ? Math.round(n) : Math.round(n * 10) / 10)
    const ratio = 1 / scale
    return ratio >= 1 ? `1:${round(ratio)}` : `${round(scale)}:1`
  }

  function refresh(): void {
    const engine = engineOf()
    if (!engine?.hasDrawing()) return
    const run = ++pending
    saveButton.disabled = true
    say(t.pWorking)
    // Let the panel paint before reading the scene, which takes a moment on a
    // drawing with a few hundred thousand segments.
    requestAnimationFrame(() => {
      if (run !== pending) return
      try {
        const geometry = engine.plotGeometry()
        const area = areaBox(engine)
        if (!area || isEmptyBox(area)) {
          ready = null
          say(t.pEmpty)
          clearPreview()
          return
        }
        const fixed = scaleSelect.value === 'fit' ? null : 1 / Number(scaleSelect.value)
        const layout = planLayout(area, paperSelect.value as PaperName, orientationSelect.value as Orientation, MARGIN_MM, fixed)
        const view: PlotView = {
          area,
          layout,
          mono: colorsSelect.value === 'mono',
          lineWidthMm: Number(widthSelect.value)
        }
        ready = { geometry, view }
        preview(view)
        const width = Math.round(area.maxX - area.minX)
        const height = Math.round(area.maxY - area.minY)
        say(
          [
            `${scaleLabel(layout.scale)} · ${t.pSize} ${width} × ${height}`,
            layout.clipped ? t.pClipped : t.pUnits
          ].join(' · ')
        )
        saveButton.disabled = false
      } catch (err) {
        console.error(err)
        ready = null
        say(t.pFailed)
      }
    })
  }

  function clearPreview(): void {
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  function preview(view: PlotView): void {
    const { widthMm, heightMm } = view.layout
    // Fit the sheet to whatever room the panel has: a phone panel is narrower
    // than a desktop one, and a stretched canvas would lie about the aspect.
    const maxWidth = Math.max(120, Math.min(PREVIEW_MAX_W, (panel.clientWidth || 300) - 42))
    const maxHeight = Math.max(120, Math.min(PREVIEW_MAX_H, Math.round(innerHeight * 0.32)))
    const pxPerMm = Math.min(maxWidth / widthMm, maxHeight / heightMm)
    const dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = Math.round(widthMm * pxPerMm * dpr)
    canvas.height = Math.round(heightMm * pxPerMm * dpr)
    canvas.style.width = `${Math.round(widthMm * pxPerMm)}px`
    canvas.style.height = `${Math.round(heightMm * pxPerMm)}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawPreview(ready!.geometry, view, ctx, pxPerMm * dpr)
  }

  async function save(): Promise<void> {
    if (!ready) return
    saveButton.disabled = true
    const previous = note.textContent ?? ''
    say(t.pWriting)
    try {
      const name = fileNameOf().replace(/\.[^.]+$/, '') || 'drawing'
      const blob = await plotToPdf(ready.geometry, ready.view, {
        title: name,
        subject: scaleLabel(ready.view.layout.scale)
      })
      const url = URL.createObjectURL(blob)
      const link = Object.assign(document.createElement('a'), { href: url, download: `${name}.pdf` })
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      say(previous)
    } catch (err) {
      console.error(err)
      say(t.pFailed)
    } finally {
      saveButton.disabled = false
    }
  }

  function startPicking(): void {
    const engine = engineOf()
    if (!engine) return
    panel.hidden = true
    pick.hidden = false
    say(t.pPicking)
    let from: { x: number; y: number } | null = null
    const rect = () => pick.getBoundingClientRect()

    const down = (event: PointerEvent) => {
      from = { x: event.clientX, y: event.clientY }
      pickRect.hidden = false
      move(event)
      pick.setPointerCapture(event.pointerId)
    }
    const move = (event: PointerEvent) => {
      if (!from) return
      const box = rect()
      const left = Math.min(from.x, event.clientX) - box.left
      const top = Math.min(from.y, event.clientY) - box.top
      pickRect.style.left = `${left}px`
      pickRect.style.top = `${top}px`
      pickRect.style.width = `${Math.abs(event.clientX - from.x)}px`
      pickRect.style.height = `${Math.abs(event.clientY - from.y)}px`
    }
    const up = (event: PointerEvent) => {
      const start = from
      const wide = start && Math.abs(event.clientX - start.x) >= 8 && Math.abs(event.clientY - start.y) >= 8
      const a = wide ? engine.screenToWorld(start!.x, start!.y) : null
      const b = wide ? engine.screenToWorld(event.clientX, event.clientY) : null
      if (a && b) {
        windowBox = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) }
        areaSelect.value = 'window'
      }
      stop()
    }
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stop()
    }
    function stop() {
      from = null
      pick.hidden = true
      pickRect.hidden = true
      panel.hidden = false
      pick.removeEventListener('pointerdown', down)
      pick.removeEventListener('pointermove', move)
      pick.removeEventListener('pointerup', up)
      removeEventListener('keydown', cancel)
      refresh()
    }
    pick.addEventListener('pointerdown', down)
    pick.addEventListener('pointermove', move)
    pick.addEventListener('pointerup', up)
    addEventListener('keydown', cancel)
  }

  const setOpen = (open: boolean) => {
    panel.hidden = !open
    toggleButton.setAttribute('aria-expanded', String(open))
    if (open) refresh()
  }

  for (const select of [areaSelect, paperSelect, orientationSelect, scaleSelect, colorsSelect, widthSelect]) {
    select.addEventListener('change', refresh)
  }
  $('plot-window').addEventListener('click', startPicking)
  $('plot-close').addEventListener('click', () => setOpen(false))
  saveButton.addEventListener('click', () => void save())

  return {
    toggle: () => setOpen(panel.hidden !== false),
    close: () => setOpen(false),
    isOpen: () => !panel.hidden
  }
}

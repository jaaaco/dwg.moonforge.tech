// The CAD engine: mlightcad's viewer (MIT) with LibreDWG compiled to WebAssembly
// (GPL-3.0) for DWG. Loaded lazily from app.ts, so none of this weighs on the
// landing page until a drawing is opened.
import {
  AcApDocManager,
  AcApOpenViewMode,
  AcEdOpenMode,
  LIBREDWG_PARSER_WORKER_FILE,
  MTEXT_RENDERER_WORKER_FILE
} from '@mlightcad/cad-simple-viewer'
import { AcDbDatabaseConverterManager, AcDbFileType, AcGeBox2d, AcGePoint2d } from '@mlightcad/data-model'
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter'
import { buildPlotGeometry, isEmptyBox, type PlotBox, type PlotGeometry } from './plot'
import type { DrawingLayer, Engine } from './types'
// Everything the engine fetches at runtime is served from this site under a
// content-hashed path (see scripts/prepare-cad.mjs); its defaults would call a
// CDN instead.
import { CAD_BASE, WORKER_BASE } from './cad-assets'
const DWG_PARSER = `${WORKER_BASE}${LIBREDWG_PARSER_WORKER_FILE}`
const MTEXT_RENDER = `${WORKER_BASE}${MTEXT_RENDERER_WORKER_FILE}`
const CANVAS_BACKGROUND = 0x0c0c0e

// Zoom-to-extents is at the mercy of one stray object: a block inserted at 0,0
// next to a plan drawn at 12 000, 3 000 shrinks the plan to a corner (seen in a
// real installation drawing). Fit to where the drawing actually is instead:
// keep entities whose centre lies near the 2nd to 98th percentile band, then
// fit their union. Returns null when the plain extents are good enough.
function drawingBox(manager: AcApDocManager): AcGeBox2d | null {
  const boxes: { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number }[] = []
  const entities = manager.curDocument.database.tables.blockTable.modelSpace.newIterator()
  // A sample is plenty to find where the drawing is, and keeps huge files quick.
  const step = Math.max(1, Math.ceil(entities.count / 20_000))
  let index = 0
  for (const entity of entities) {
    if (index++ % step !== 0) continue
    let ext
    try {
      ext = entity.geometricExtents
    } catch {
      continue
    }
    const { min, max } = ext
    if (![min.x, min.y, max.x, max.y].every(Number.isFinite) || min.x > max.x || min.y > max.y) continue
    boxes.push({ minX: min.x, minY: min.y, maxX: max.x, maxY: max.y, cx: (min.x + max.x) / 2, cy: (min.y + max.y) / 2 })
  }
  if (boxes.length < 20) return null

  const band = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    const lo = sorted[Math.floor(sorted.length * 0.02)]
    const hi = sorted[Math.ceil(sorted.length * 0.98) - 1]
    const pad = Math.max(hi - lo, 1e-9) * 0.5
    return [lo - pad, hi + pad]
  }
  const [x0, x1] = band(boxes.map((b) => b.cx))
  const [y0, y1] = band(boxes.map((b) => b.cy))
  const kept = boxes.filter((b) => b.cx >= x0 && b.cx <= x1 && b.cy >= y0 && b.cy <= y1)
  if (kept.length === boxes.length || kept.length === 0) return null

  const union = (list: typeof boxes) => ({
    minX: Math.min(...list.map((b) => b.minX)), minY: Math.min(...list.map((b) => b.minY)),
    maxX: Math.max(...list.map((b) => b.maxX)), maxY: Math.max(...list.map((b) => b.maxY))
  })
  const all = union(boxes)
  const core = union(kept)
  const diagonal = (b: typeof all) => Math.hypot(b.maxX - b.minX, b.maxY - b.minY)
  // Only override when the stragglers really distort the view.
  if (diagonal(core) > diagonal(all) * 0.7) return null
  const margin = diagonal(core) * 0.03
  return new AcGeBox2d(new AcGePoint2d(core.minX - margin, core.minY - margin), new AcGePoint2d(core.maxX + margin, core.maxY + margin))
}

// Navigation. The engine pans with the middle button and zooms on every wheel
// event, which leaves a laptop without a way to pan. We want what a map gives
// you: drag with the primary button, and two fingers on the trackpad.
const THREE_MOUSE_PAN = 2
// AcEdViewMode.PAN. The enum is not exported from @mlightcad/cad-simple-viewer,
// but the view's `mode` setter takes it: left button pans, selection is off.
const VIEW_MODE_PAN = 1

/** Camera controls of the layout currently on screen, if reachable. */
function activeControls(manager: AcApDocManager) {
  // No public accessor for these; guarded so a package update degrades to
  // "the extra gestures stop working" instead of a broken viewer.
  const layoutView = (manager.curView as any)?._layoutViewManager?.activeLayoutView
  const controls = layoutView?._cameraControls
  return controls?.object?.isOrthographicCamera ? controls : undefined
}

/** Drag with the primary button pans. Called after every open: the layout view,
 *  and with it the button map, is rebuilt when a document opens. */
function applyPanMode(manager: AcApDocManager): void {
  const view = manager.curView
  if (!view) return
  view.mode = VIEW_MODE_PAN
  // PAN mode replaces the button map with LEFT only; keep the middle button too,
  // since that is what people coming from AutoCAD reach for.
  const controls = activeControls(manager)
  if (controls) controls.mouseButtons = { LEFT: THREE_MOUSE_PAN, MIDDLE: THREE_MOUSE_PAN }
}

/** Two fingers on a trackpad pan; pinch and a mouse wheel keep zooming.
 *
 * There is no API that says which device sent a wheel event, so we look at the
 * numbers: a trackpad swipe drifts sideways and sends fractional pixel deltas,
 * a wheel notch is a round number with no horizontal component. A wheel that
 * happens to look like a trackpad still zooms, which is the safer mistake;
 * once a real trackpad gesture is recognised, its momentum tail (integer,
 * vertical-only events) keeps panning for a moment.
 */
function attachTrackpadPan(container: HTMLElement, manager: AcApDocManager): void {
  const GESTURE_TAIL_MS = 400
  let lastTrackpadAt = 0

  container.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      // Pinch-to-zoom arrives as a wheel event with ctrlKey set; leave that to
      // the engine's zoom, along with anything measured in lines or pages.
      if (event.ctrlKey || event.metaKey || event.deltaMode !== 0) return
      const sideways = event.deltaX !== 0
      const fractional = !Number.isInteger(event.deltaY) || !Number.isInteger(event.deltaX)
      const now = event.timeStamp
      if (sideways || fractional) lastTrackpadAt = now
      else if (Math.abs(event.deltaY) >= 40 || now - lastTrackpadAt > GESTURE_TAIL_MS) return

      const controls = activeControls(manager)
      const camera = controls?.object
      if (!camera) return
      const height = container.clientHeight || 1
      const worldPerPixel = (camera.top - camera.bottom) / camera.zoom / height
      // Same direction as scrolling a page: the view follows the gesture.
      const dx = event.deltaX * worldPerPixel
      const dy = -event.deltaY * worldPerPixel
      camera.position.x += dx
      camera.position.y += dy
      controls.target.x += dx
      controls.target.y += dy
      controls.update()
      controls.dispatchEvent({ type: 'change' })
      event.preventDefault()
      event.stopPropagation()
    },
    { capture: true, passive: false }
  )
}

/** The three.js scene the active layout draws, if reachable. */
function activeScene(manager: AcApDocManager): any {
  const holder = (manager.curView as any)?._scene
  if (holder?.isScene) return holder
  if (holder?._scene?.isScene) return holder._scene
  // Guarded fallback: a package update may move it, and plotting is optional.
  const seen = new Set<any>()
  const find = (node: any, depth: number): any => {
    if (!node || depth > 6 || typeof node !== 'object' || seen.has(node)) return null
    seen.add(node)
    if (node.isScene) return node
    for (const key of Object.keys(node)) {
      try {
        const hit = find(node[key], depth + 1)
        if (hit) return hit
      } catch {
        /* getters on the view can throw before a document is open */
      }
    }
    return null
  }
  return find(manager.curView, 0)
}

/** What the canvas currently shows, in drawing units. */
function cameraBox(manager: AcApDocManager): PlotBox | null {
  const camera = activeControls(manager)?.object
  if (!camera) return null
  const width = (camera.right - camera.left) / camera.zoom
  const height = (camera.top - camera.bottom) / camera.zoom
  return {
    minX: camera.position.x - width / 2,
    minY: camera.position.y - height / 2,
    maxX: camera.position.x + width / 2,
    maxY: camera.position.y + height / 2
  }
}

export async function createEngine(container: HTMLElement): Promise<Engine> {
  AcDbDatabaseConverterManager.instance.register(
    AcDbFileType.DWG,
    new AcDbLibreDwgConverter({ convertByEntityType: false, useWorker: true, parserWorkerUrl: DWG_PARSER })
  )

  const manager = AcApDocManager.createInstance({
    container,
    autoResize: true,
    baseUrl: CAD_BASE,
    webworkerFileUrls: { dwgParser: DWG_PARSER, mtextRender: MTEXT_RENDER }
  })
  if (!manager) throw new Error('CAD engine failed to start')
  manager.curView.backgroundColor = CANVAS_BACKGROUND
  attachTrackpadPan(container, manager)
  if (import.meta.env.DEV) {
    // Handles for the local end-to-end checks (zooming to a known region).
    Object.assign(window, { __cad: manager, __cadModel: await import('@mlightcad/data-model') })
  }

  let open = false
  // Reading the geometry back out of the scene costs about a second on a large
  // drawing, so it is kept until something on screen changes.
  let plot: PlotGeometry | null = null
  const dropPlot = () => {
    plot = null
  }

  const fit = () => {
    const box = drawingBox(manager)
    if (box) manager.curView.zoomTo(box)
    else manager.curView.zoomToFitDrawing()
  }

  const plotGeometry = (): PlotGeometry => {
    if (plot) return plot
    const scene = activeScene(manager)
    if (!scene) throw new Error('renderer scene not reachable')
    plot = buildPlotGeometry(scene)
    return plot
  }

  return {
    async open(bytes, fileName, onStage) {
      if (open) {
        await manager.closeDocument()
        open = false
      }
      dropPlot()
      onStage('reading')
      // Copy: the parser worker takes ownership of the buffer it receives.
      const buffer = bytes.slice().buffer
      // Saved view, not Extents: the engine's own extents fit runs asynchronously
      // after open and would overwrite the outlier-proof fit below.
      const ok = await manager.openDocument(fileName, buffer, { mode: AcEdOpenMode.Read, openViewMode: AcApOpenViewMode.Saved })
      if (!ok) throw new Error(`openDocument returned false for ${fileName}`)
      open = true
      manager.curView.backgroundColor = CANVAS_BACKGROUND
      applyPanMode(manager)

      onStage('rendering')
      const view = manager.curView
      const deadline = performance.now() + 120_000
      while (view.isProcessingEntities && performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 80))
      }
      fit()

      const layers: DrawingLayer[] = manager.curDocument.layerStore
        .getLayers()
        .map((l) => ({ name: l.name, color: l.cssColor, visible: l.isOn && !l.isFrozen }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      return { layers }
    },

    setLayerVisible(name, visible) {
      const store = manager.curDocument.layerStore
      // Drawings often ship with layers frozen, not just off (dimensions,
      // HVAC, plumbing). Turning one on in the panel has to thaw it too.
      if (visible) store.setLayerFrozen(name, false)
      store.setLayerOn(name, visible)
      dropPlot()
    },

    fit,

    close() {
      if (!open) return
      open = false
      dropPlot()
      void manager.closeDocument()
    },

    hasDrawing() {
      return open
    },

    plotGeometry,

    viewBox() {
      return cameraBox(manager)
    },

    screenToWorld(clientX, clientY) {
      const box = cameraBox(manager)
      if (!box) return null
      const rect = container.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      return {
        x: box.minX + ((clientX - rect.left) / rect.width) * (box.maxX - box.minX),
        y: box.maxY - ((clientY - rect.top) / rect.height) * (box.maxY - box.minY)
      }
    },

    extents() {
      // Same outlier-proof box the on-screen fit uses, so "whole drawing" plots
      // what Fit shows instead of a speck next to a stray block at 0,0.
      const box = drawingBox(manager)
      if (box) return { minX: box.min.x, minY: box.min.y, maxX: box.max.x, maxY: box.max.y }
      const geometry = plotGeometry()
      return isEmptyBox(geometry.box) ? null : geometry.box
    }
  }
}

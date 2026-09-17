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
import type { DrawingLayer, Engine } from './types'

// Everything the engine fetches at runtime lives under /cad on this site
// (see scripts/prepare-cad.mjs); its defaults would call a CDN instead.
const CAD_BASE = '/cad/'
const DWG_PARSER = `${CAD_BASE}workers/${LIBREDWG_PARSER_WORKER_FILE}`
const MTEXT_RENDER = `${CAD_BASE}workers/${MTEXT_RENDERER_WORKER_FILE}`
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
  if (import.meta.env.DEV) {
    // Handles for the local end-to-end checks (zooming to a known region).
    Object.assign(window, { __cad: manager, __cadModel: await import('@mlightcad/data-model') })
  }

  let open = false

  const fit = () => {
    const box = drawingBox(manager)
    if (box) manager.curView.zoomTo(box)
    else manager.curView.zoomToFitDrawing()
  }

  return {
    async open(bytes, fileName, onStage) {
      if (open) {
        await manager.closeDocument()
        open = false
      }
      onStage('reading')
      // Copy: the parser worker takes ownership of the buffer it receives.
      const buffer = bytes.slice().buffer
      // Saved view, not Extents: the engine's own extents fit runs asynchronously
      // after open and would overwrite the outlier-proof fit below.
      const ok = await manager.openDocument(fileName, buffer, { mode: AcEdOpenMode.Read, openViewMode: AcApOpenViewMode.Saved })
      if (!ok) throw new Error(`openDocument returned false for ${fileName}`)
      open = true
      manager.curView.backgroundColor = CANVAS_BACKGROUND

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
    },

    fit,

    close() {
      if (!open) return
      open = false
      void manager.closeDocument()
    },

    hasDrawing() {
      return open
    }
  }
}

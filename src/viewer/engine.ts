// The CAD engine: mlightcad's viewer (MIT) with LibreDWG compiled to WebAssembly
// (GPL-3.0) for DWG. Loaded lazily from app.ts, so none of this weighs on the
// landing page until a drawing is opened.
import {
  AcApDocManager,
  AcEdOpenMode,
  LIBREDWG_PARSER_WORKER_FILE,
  MTEXT_RENDERER_WORKER_FILE
} from '@mlightcad/cad-simple-viewer'
import { AcDbDatabaseConverterManager, AcDbFileType } from '@mlightcad/data-model'
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter'
import type { DrawingLayer, Engine } from './types'

// Everything the engine fetches at runtime lives under /cad on this site
// (see scripts/prepare-cad.mjs); its defaults would call a CDN instead.
const CAD_BASE = '/cad/'
const DWG_PARSER = `${CAD_BASE}workers/${LIBREDWG_PARSER_WORKER_FILE}`
const MTEXT_RENDER = `${CAD_BASE}workers/${MTEXT_RENDERER_WORKER_FILE}`
const CANVAS_BACKGROUND = 0x0c0c0e

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

  return {
    async open(bytes, fileName, onStage) {
      if (open) {
        await manager.closeDocument()
        open = false
      }
      onStage('reading')
      // Copy: the parser worker takes ownership of the buffer it receives.
      const buffer = bytes.slice().buffer
      const ok = await manager.openDocument(fileName, buffer, { mode: AcEdOpenMode.Read })
      if (!ok) throw new Error(`openDocument returned false for ${fileName}`)
      open = true
      manager.curView.backgroundColor = CANVAS_BACKGROUND

      onStage('rendering')
      const view = manager.curView
      const deadline = performance.now() + 120_000
      while (view.isProcessingEntities && performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 80))
      }
      view.zoomToFitDrawing()

      const layers: DrawingLayer[] = manager.curDocument.layerStore
        .getLayers()
        .map((l) => ({ name: l.name, color: l.cssColor, visible: l.isOn && !l.isFrozen }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      return { layers }
    },

    setLayerVisible(name, visible) {
      manager.curDocument.layerStore.setLayerOn(name, visible)
    },

    fit() {
      manager.curView.zoomToFitDrawing()
    },

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

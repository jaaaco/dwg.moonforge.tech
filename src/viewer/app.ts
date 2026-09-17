import type { DrawingLayer, Engine } from './types'

type Strings = Record<string, string>

const MAX_COMFORTABLE_BYTES = 25 * 1024 * 1024

export function mountViewer(root: HTMLElement): void {
  const t: Strings = JSON.parse(root.dataset.strings ?? '{}')
  const $ = <T extends HTMLElement>(role: string) => root.querySelector<T>(`[data-role="${role}"]`)!

  const fileInput = $<HTMLInputElement>('file')
  const status = $('status')
  const canvas = $('canvas')
  const actions = $('actions')
  const layersPanel = $('layers')
  const layerList = $('layer-list')
  const layersToggle = $<HTMLButtonElement>('layers-toggle')

  const plotToggle = $<HTMLButtonElement>('plot-toggle')

  let engine: Engine | null = null
  let enginePromise: Promise<Engine> | null = null
  let plotUi: { toggle(): void; close(): void } | null = null
  let busy = false

  const setState = (s: 'empty' | 'loading' | 'open') => { root.dataset.state = s }
  const say = (msg: string) => { status.textContent = msg }

  // The engine (WASM + renderer, several MB) is only fetched once someone
  // actually opens a drawing, so the landing page itself stays light.
  function getEngine(): Promise<Engine> {
    enginePromise ??= import('./engine').then((m) => m.createEngine(canvas))
    return enginePromise
  }

  async function open(bytes: Uint8Array, name: string) {
    if (busy) return
    const ext = name.toLowerCase().split('.').pop()
    if (ext !== 'dwg' && ext !== 'dxf') { say(t.vUnsupported); return }
    busy = true
    setState('loading')
    closeLayers()
    plotUi?.close()
    fileName = name
    const started = performance.now()
    try {
      say(t.vLoadingEngine)
      engine = await getEngine()
      if (bytes.byteLength > MAX_COMFORTABLE_BYTES) say(t.vTooBig)
      const result = await engine.open(bytes, name, (stage) => say(stage === 'reading' ? t.vReading : t.vRendering))
      renderLayers(result.layers)
      setState('open')
      actions.hidden = false
      const secs = ((performance.now() - started) / 1000).toFixed(1)
      say(`${name} · ${formatBytes(bytes.byteLength)} · ${secs} s`)
      document.title = `${name} · ${document.title.replace(/^.* · /, '')}`
    } catch (err) {
      console.error(err)
      setState(engine?.hasDrawing() ? 'open' : 'empty')
      say(`${t.vError}: ${name}. ${t.vErrorHint}`)
    } finally {
      busy = false
    }
  }

  async function openFile(file: File) {
    await open(new Uint8Array(await file.arrayBuffer()), file.name)
  }

  function renderLayers(layers: DrawingLayer[]) {
    layerList.replaceChildren(
      ...layers.map((layer) => {
        const li = document.createElement('li')
        const label = document.createElement('label')
        const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: layer.visible })
        cb.addEventListener('change', () => engine?.setLayerVisible(layer.name, cb.checked))
        const swatch = Object.assign(document.createElement('span'), { className: 'swatch' })
        swatch.style.background = layer.color
        label.append(cb, swatch, document.createTextNode(layer.name))
        li.append(label)
        return li
      })
    )
    layersToggle.textContent = `${t.vLayers} (${layers.length})`
  }

  function closeLayers() {
    layersPanel.hidden = true
    layersToggle.setAttribute('aria-expanded', 'false')
  }

  let fileName = ''

  // The export panel is only fetched when someone asks for it.
  plotToggle.addEventListener('click', async () => {
    plotUi ??= (await import('./plot-ui')).mountPlotUi(root, t, () => engine, () => fileName)
    closeLayers()
    plotUi.toggle()
  })

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0]
    if (f) openFile(f)
    fileInput.value = ''
  })

  $('sample').addEventListener('click', async () => {
    say(t.vReading)
    const res = await fetch('/samples/sample-house.dxf')
    await open(new Uint8Array(await res.arrayBuffer()), 'sample-house.dxf')
  })

  $('fit').addEventListener('click', () => engine?.fit())
  $('close').addEventListener('click', () => {
    engine?.close()
    actions.hidden = true
    closeLayers()
    plotUi?.close()
    setState('empty')
    say('')
  })
  layersToggle.addEventListener('click', () => {
    const show = layersPanel.hidden
    layersPanel.hidden = !show
    layersToggle.setAttribute('aria-expanded', String(show))
    if (show) plotUi?.close()
  })
  $('layers-all').addEventListener('click', () => {
    layerList.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((cb) => {
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')) }
    })
  })

  // Drop anywhere on the page, not only on the canvas: people aim badly.
  let depth = 0
  addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; root.dataset.drag = '1' } })
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; delete root.dataset.drag } })
  addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault() })
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth = 0
    delete root.dataset.drag
    const f = e.dataTransfer?.files[0]
    if (f) {
      root.scrollIntoView({ behavior: 'smooth', block: 'start' })
      openFile(f)
    }
  })
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

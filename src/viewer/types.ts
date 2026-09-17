import type { PlotBox, PlotGeometry } from './plot'

export interface DrawingLayer {
  name: string
  /** CSS colour of the layer, already adjusted for the canvas background. */
  color: string
  visible: boolean
}

export interface OpenResult {
  layers: DrawingLayer[]
}

export interface Engine {
  open(bytes: Uint8Array, fileName: string, onStage: (stage: 'reading' | 'rendering') => void): Promise<OpenResult>
  setLayerVisible(name: string, visible: boolean): void
  fit(): void
  close(): void
  hasDrawing(): boolean
  /** Vector geometry of everything on screen, for plotting. Cached. */
  plotGeometry(): PlotGeometry
  /** What the canvas shows right now, in drawing units. */
  viewBox(): PlotBox | null
  /** Everything visible, in drawing units. */
  extents(): PlotBox | null
  screenToWorld(clientX: number, clientY: number): { x: number; y: number } | null
}

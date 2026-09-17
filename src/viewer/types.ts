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
}

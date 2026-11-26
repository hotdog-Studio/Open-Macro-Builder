import type { Rgba } from '../core/icons/rgba'

/** What a picture without a size of its own (an SVG with only a viewBox) is drawn at, and the least an SVG is drawn at. */
const VECTOR_SIDE = 512

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The browser could not read this picture.'))
    img.src = url
  })
}

/** The size to draw a picture at: its own, and for an SVG at least 512 px on its longer side. */
function drawSize(img: HTMLImageElement, vector: boolean): { width: number; height: number } {
  const w = img.naturalWidth || VECTOR_SIDE
  const h = img.naturalHeight || VECTOR_SIDE
  if (!vector) return { width: w, height: h }
  const scale = Math.max(1, VECTOR_SIDE / Math.max(w, h))
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

/**
 * A picture the browser can decode (PNG, JPG, SVG, GIF, WebP, …) as plain RGBA. This and `encodePng` are the
 * only places the Icons tab touches the canvas: the preview and the written files both go through them.
 */
export async function decodePicture(data: Blob): Promise<Rgba> {
  const url = URL.createObjectURL(data)
  try {
    const img = await loadImage(url)
    const { width, height } = drawSize(img, data.type === 'image/svg+xml')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The browser has no canvas to read the picture with.')
    context.drawImage(img, 0, 0, width, height)
    const { data: pixels } = context.getImageData(0, 0, width, height)
    return { width, height, data: pixels }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The bytes of a PNG file as RGBA. */
export function decodePng(bytes: Uint8Array): Promise<Rgba> {
  return decodePicture(new Blob([bytes as BlobPart], { type: 'image/png' }))
}

/** A picture as the bytes of a PNG file. */
export async function encodePng(image: Rgba): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The browser has no canvas to write the picture with.')
  context.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The browser could not make a PNG of the picture.')
  return new Uint8Array(await blob.arrayBuffer())
}

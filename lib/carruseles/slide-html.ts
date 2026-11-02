import type { AspectRatio } from './types'
import { DIMENSIONS } from './types'
import { CSS_NATIVO } from './historias/estilo-nativo'

/**
 * Extrae nombres de fuentes de Google desde el HTML de una slide.
 */
export function extractFontFamilies(html: string): string[] {
  const families = new Set<string>()
  const regex = /font-family:\s*['"]?([^;'"}\n]+?)['"]?\s*[;}"]/g
  let match
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim()
    const generics = new Set([
      'serif',
      'sans-serif',
      'monospace',
      'cursive',
      'fantasy',
      'system-ui',
      'inherit',
      'initial',
      'unset',
    ])
    for (const part of raw.split(',')) {
      const name = part.trim().replace(/['"]/g, '')
      if (name && !generics.has(name.toLowerCase())) families.add(name)
    }
  }
  return Array.from(families)
}

/**
 * Envuelve el HTML body de una slide en un documento HTML completo con las
 * dimensiones correctas. Es el contrato de render compartido entre preview
 * (iframe) y export (html-to-image).
 */
export function wrapSlideHtml(slideHtml: string, aspectRatio: AspectRatio): string {
  const { width, height } = DIMENSIONS[aspectRatio]
  const fontFamilies = extractFontFamilies(slideHtml)

  let fontBlock = ''
  if (fontFamilies.length > 0) {
    const params = fontFamilies.map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800;900`).join('&')
    fontBlock = `<link href="https://fonts.googleapis.com/css2?${params}&display=swap" rel="stylesheet">`
  }

  // Historias (9:16): el estilo «editor nativo» y sus fuentes van siempre cargados, de modo que el agente
  // solo usa clases `ig-*`. Cada familia pide solo los pesos que existen (Google responde 400 si no).
  const esHistoria = aspectRatio === '9:16'
  const fuentesNativas = esHistoria
    ? '<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Anton&family=Newsreader:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">'
    : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${width}, initial-scale=1">
  ${fontBlock}
  ${fuentesNativas}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
    ${esHistoria ? CSS_NATIVO : ''}
  </style>
</head>
<body>
  ${slideHtml}
</body>
</html>`
}

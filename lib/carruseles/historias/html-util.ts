import type { Pedido } from './pedidos'

// Piezas de HTML compartidas por las plantillas (`layouts.ts`) y por el editor libre por capas (`capas.ts`).
// Todo texto se escapa; nada de aquí ejecuta ni inyecta HTML del usuario.

export const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )

export const corta = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

export type StickerPregunta = { tipo: 'pregunta' | 'escribe'; cabecera?: string; texto?: string }

export function stickerHtml(s: StickerPregunta): string {
  const cab = esc(s.cabecera ?? 'HABLEMOS CLARO')
  return s.tipo === 'pregunta'
    ? `<div class="ig-sticker-pregunta"><div class="ig-sp-cab">${cab}</div><div class="ig-sp-cuerpo">${esc(s.texto ?? '')}</div></div>`
    : `<div class="ig-sticker-escribe">${cab}<div>Escribe algo…</div></div>`
}

/** La imagen real subida o, si falta, un hueco marcado que la pantalla convierte en «Falta material». */
export function capturaHtml(p: Pedido, url: string | undefined): string {
  if (url) return `<div class="ig-captura-real"><img src="${esc(url)}" alt="${esc(p.titulo)}"></div>`
  return `<div class="ig-pedido" data-pedido="${esc(p.clave)}" data-tipo="${esc(p.tipo)}" data-titulo="${esc(p.titulo)}"><span class="ig-emoji">📎</span><b>FALTA</b>${esc(p.titulo)}</div>`
}

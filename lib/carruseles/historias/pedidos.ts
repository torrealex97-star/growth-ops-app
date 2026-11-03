import { leerSpec, type HistoriaSpec } from './layouts'

// MATERIAL REAL que la app pide cuando una historia necesita autoridad: capturas de pagos, testimonios, resultados,
// fotos de alumnas. La IA lo pide con la plantilla «captura» y un `pedido`; si aún no hay imagen subida, la historia
// lleva un hueco marcado (data-pedido) que la pantalla convierte en una tarjeta «Falta material». Nunca se inventa.

export const TIPOS_PEDIDO = {
  captura_pago: {
    etiqueta: 'Captura de un pago',
    ayuda: 'Una captura real del cobro o la transferencia. Tapa nombres y datos bancarios.',
  },
  testimonio: { etiqueta: 'Testimonio', ayuda: 'Captura de un mensaje o comentario real de una alumna o cliente.' },
  resultado: { etiqueta: 'Resultado', ayuda: 'Captura de analíticas, ventas o el resultado que se quiere demostrar.' },
  alumna: { etiqueta: 'Foto de una alumna', ayuda: 'Una foto de la alumna (con su permiso).' },
  otro: { etiqueta: 'Otro material real', ayuda: 'La imagen real que pide la historia.' },
} as const

export type TipoPedido = keyof typeof TIPOS_PEDIDO
export type Pedido = { clave: string; tipo: TipoPedido; titulo: string }
export type PedidoPendiente = Pedido & { slideId: string }

export const esTipoPedido = (v: unknown): v is TipoPedido => typeof v === 'string' && v in TIPOS_PEDIDO

/** Clave estable de un pedido: minúsculas, números y guiones. */
export const limpiarClave = (v: unknown): string =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)

const decodificar = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** Los huecos de material que siguen sin imagen en las historias del proyecto. */
export function pedidosPendientes(slides: { id: string; html: string }[]): PedidoPendiente[] {
  const salida: PedidoPendiente[] = []
  for (const s of slides) {
    for (const m of s.html.matchAll(/data-pedido="([^"]*)" data-tipo="([^"]*)" data-titulo="([^"]*)"/g)) {
      const tipo = decodificar(m[2])
      if (esTipoPedido(tipo)) salida.push({ clave: decodificar(m[1]), tipo, titulo: decodificar(m[3]), slideId: s.id })
    }
  }
  return salida
}

/** La especificación con la que se compuso una historia (va incrustada en su HTML), para recomponerla sin IA. */
export function leerSpecDeHtml(html: string): { spec: HistoriaSpec; estilo: string; hoy: Date } | null {
  const m = /data-spec="([^"]*)"/.exec(html)
  if (!m) return null
  try {
    const o = JSON.parse(decodificar(m[1])) as { spec?: unknown; estilo?: unknown; hoy?: unknown }
    const r = leerSpec(o.spec)
    const hoy = new Date(String(o.hoy ?? ''))
    return r.ok
      ? { spec: r.spec, estilo: String(o.estilo ?? 'nativo'), hoy: Number.isNaN(hoy.getTime()) ? new Date() : hoy }
      : null
  } catch {
    return null
  }
}

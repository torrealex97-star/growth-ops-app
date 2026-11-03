import type { AspectRatio, ProjectKind } from './types'

// Historias, carruseles y flyers son productos distintos aunque compartan almacén: lo que cambia es el formato.
export type TipoProducto = 'historias' | 'carrusel' | 'flyer'

export const tipoDeProyecto = (p: { kind: ProjectKind; aspectRatio: AspectRatio }): TipoProducto =>
  p.kind === 'flyer' ? 'flyer' : p.aspectRatio === '9:16' ? 'historias' : 'carrusel'

export const ETIQUETA_TIPO: Record<TipoProducto, string> = {
  historias: 'Historias',
  carrusel: 'Carruseles',
  flyer: 'Flyers',
}

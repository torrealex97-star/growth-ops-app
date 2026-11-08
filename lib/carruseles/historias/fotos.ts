import { elegirMedio, type ContextoRender, type HistoriaSpec } from './layouts'

// Fotos de fondo de las historias: qué foto usa cada una y cómo se intercambian dos historias entre sí.
// El encuadre (`fondoPos`) pertenece a la foto, así que viaja con ella.

export type FondoDeHistoria = { foto?: number; fondo: 'foto' | 'liso'; fondoPos?: HistoriaSpec['fondoPos'] }

/** Qué fondo tiene la historia: el número de su foto (aunque lo haya elegido el sistema), o liso. `null` si no hay fotos. */
export function fondoDe(spec: HistoriaSpec, ctx: ContextoRender): FondoDeHistoria | null {
  if (spec.fondo === 'liso') return { fondo: 'liso' }
  const medio = elegirMedio(spec, ctx)
  if (!medio) return null
  const i = ctx.media.findIndex((m) => m.url === medio.url)
  return i < 0 ? null : { foto: i + 1, fondo: 'foto', fondoPos: spec.fondoPos }
}

const conFondo = (spec: HistoriaSpec, f: FondoDeHistoria): HistoriaSpec => ({
  ...spec,
  fondo: f.fondo,
  foto: f.foto,
  fondoPos: f.fondo === 'foto' ? f.fondoPos : undefined,
})

/** Intercambia el fondo de dos historias. `null` si alguna no tiene fondo que intercambiar (sin fotos). */
export function intercambiarFondos(
  a: { spec: HistoriaSpec; ctx: ContextoRender },
  b: { spec: HistoriaSpec; ctx: ContextoRender }
): [HistoriaSpec, HistoriaSpec] | null {
  const fa = fondoDe(a.spec, a.ctx)
  const fb = fondoDe(b.spec, b.ctx)
  if (!fa || !fb) return null
  return [conFondo(a.spec, fb), conFondo(b.spec, fa)]
}

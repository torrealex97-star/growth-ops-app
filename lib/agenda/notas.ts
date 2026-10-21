/**
 * Añade el motivo de descualificación a las notas de la agenda SIN borrar lo que el closer ya escribió.
 * Antes el motivo sustituía las notas enteras: el closer las guardaba y, al mover la oportunidad a
 * «descualificado», desaparecían.
 */
export function anexarMotivoDescualificacion(notasActuales: string | null | undefined, motivo: string): string {
  const m = motivo.trim()
  const previas = (notasActuales ?? '').trim()
  if (!m) return previas
  const linea = `Descualificado: ${m}`
  if (previas.includes(linea)) return previas
  return previas ? `${previas}\n\n${linea}` : linea
}

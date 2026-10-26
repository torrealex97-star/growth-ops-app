// Helper PURO del experimento A/B de VSL (sin dependencias de Node ni de red): se testea
// con node:test y se consume desde la página de embed. Solo parsea el par `?ab=` y deja
// la elección de variante con una moneda inyectable, para que el reparto sea comprobable.

// Mismo tope que slugify() y el mismo alfabeto: un slug de variante es un slug de vsl_video.
const SLUG_MAX = 60
const SLUG_RE = /^[a-z0-9-]+$/

export interface AbPair {
  varianteA: string
  varianteB: string
}

/**
 * Parsea el valor de `?ab=`. Debe traer EXACTAMENTE dos slugs distintos y válidos;
 * ante cualquier otra cosa devuelve null y el embed sigue funcionando como siempre.
 * Un slug con caracteres raros nunca alcanza la pantalla: se degrada, no se arriesga.
 */
export function parseAbPair(raw: string | null | undefined): AbPair | null {
  if (!raw || typeof raw !== 'string') return null
  const partes = raw.split(',').map((s) => s.trim())
  if (partes.length !== 2) return null
  const formaSegura = (s: string) => s.length > 0 && s.length <= SLUG_MAX && SLUG_RE.test(s)
  if (!formaSegura(partes[0]) || !formaSegura(partes[1]) || partes[0] === partes[1]) return null
  return { varianteA: partes[0], varianteB: partes[1] }
}

/**
 * Moneda del reparto: 50/50. `random` es inyectable (0..1) para tests deterministas.
 * El limite 0.5 exacto va a B: el intervalo es [0, 0.5) → A.
 */
export function elegirVarianteAb(pair: AbPair, random: number): string {
  return random < 0.5 ? pair.varianteA : pair.varianteB
}

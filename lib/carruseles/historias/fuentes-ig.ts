// Tipografías del editor de texto de Instagram (equivalentes de Google Fonts). Módulo aparte para que
// `layouts.ts` y `capas.ts` lo compartan sin importarse entre sí.
export const FUENTES_IG = ['classic', 'modern', 'neon', 'typewriter', 'strong', 'serif'] as const
export type FuenteIg = (typeof FUENTES_IG)[number]

// Tema visual de un formulario: color de acento, fondo, tipografía y redondeo. Por defecto hereda el
// branding de la subcuenta (rampa `--brand-*` de app/globals.css); un formulario puede sobrescribirlo.
// Todo son funciones puras: de un hex salen las variables CSS que el motor aplica a su contenedor.

import type { FormTheme } from './types'

export const HEX = /^#[0-9a-fA-F]{6}$/

export const FONT_STACKS: Record<NonNullable<FormTheme['font']>, string> = {
  sans: 'var(--font-sans), ui-sans-serif, system-ui, sans-serif',
  display: 'var(--font-display), var(--font-sans), ui-sans-serif, system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", ui-serif, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

export const RADIUS: Record<NonNullable<FormTheme['radius']>, { card: string; button: string }> = {
  sm: { card: '0.375rem', button: '0.375rem' },
  md: { card: '0.75rem', button: '0.75rem' },
  lg: { card: '1rem', button: '1.25rem' },
  full: { card: '1rem', button: '9999px' },
}

export function hexToRgb(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Luminancia relativa WCAG (0 negro … 1 blanco). */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Texto sobre el acento: blanco o casi negro, el que dé más contraste (los botones deben leerse). */
export function textOn(hex: string): '#ffffff' | '#0a0a0b' {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#0a0a0b') ? '#ffffff' : '#0a0a0b'
}

export function hexToHslTriplet(hex: string): { h: number; s: number; l: number } | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) }
}

export type ThemeVars = Record<string, string>

/**
 * Variables CSS para el contenedor del formulario. Sin acento propio no toca la rampa: se hereda la
 * de la subcuenta. El acento elegido se coloca como 500 y se derivan 400/600 para estados hover.
 */
export function themeVars(theme: FormTheme | undefined): ThemeVars {
  const vars: ThemeVars = {}
  if (!theme) return vars
  const acc = theme.accent ? hexToHslTriplet(theme.accent) : null
  if (acc && theme.accent) {
    const clamp = (n: number) => Math.min(95, Math.max(8, n))
    vars['--brand-400'] = `${acc.h} ${acc.s}% ${clamp(acc.l + 8)}%`
    vars['--brand-500'] = `${acc.h} ${acc.s}% ${acc.l}%`
    vars['--brand-600'] = `${acc.h} ${acc.s}% ${clamp(acc.l - 6)}%`
    vars['--form-on-accent'] = textOn(theme.accent)
  }
  if (theme.background) {
    const bg = hexToHslTriplet(theme.background)
    if (bg) vars['--background'] = `${bg.h} ${bg.s}% ${bg.l}%`
  }
  const r = RADIUS[theme.radius ?? 'md']
  vars['--form-radius'] = r.card
  vars['--form-button-radius'] = r.button
  vars['--form-font'] = FONT_STACKS[theme.font ?? 'display']
  return vars
}

/** ¿El fondo propio es oscuro? Decide si el formulario usa la paleta oscura (texto claro). */
export function isDarkTheme(theme: FormTheme | undefined, prefersDark: boolean): boolean {
  if (theme?.background && HEX.test(theme.background)) return luminance(theme.background) < 0.4
  if (theme?.mode === 'dark') return true
  if (theme?.mode === 'light') return false
  return prefersDark
}

// Paletas explícitas. Un formulario NO puede fiarse de la clase `dark` de sus ancestros: las páginas
// públicas se pintan dentro de un contenedor oscuro, así que "claro" tiene que declararse a mano
// (las variables CSS se heredan y el claro heredaría el oscuro). Mismos valores que app/globals.css.
export const PALETTE_LIGHT: ThemeVars = {
  '--background': '210 40% 99%',
  '--foreground': '222 47% 11%',
  '--card': '0 0% 100%',
  '--card-foreground': '222 47% 11%',
  '--muted': '210 40% 96%',
  '--muted-foreground': '215 16% 40%',
  '--border': '214 32% 88%',
  '--input': '214 32% 88%',
}
export const PALETTE_DARK: ThemeVars = {
  '--background': '240 5% 4%',
  '--foreground': '0 0% 100%',
  '--card': '240 4% 8%',
  '--card-foreground': '0 0% 100%',
  '--muted': '240 4% 12%',
  '--muted-foreground': '240 5% 63%',
  '--border': '240 5% 16%',
  '--input': '240 5% 16%',
}

/** Variables completas del contenedor: paleta (claro/oscuro, explícita) + tema propio encima. */
export function formVars(theme: FormTheme | undefined, prefersDark: boolean): ThemeVars {
  const dark = isDarkTheme(theme, prefersDark)
  return { ...(dark ? PALETTE_DARK : PALETTE_LIGHT), ...themeVars(theme) }
}

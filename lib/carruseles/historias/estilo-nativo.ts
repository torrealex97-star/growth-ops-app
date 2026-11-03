// ESTILO «EDITOR NATIVO» de Instagram/TikTok para historias (1080×1920).
//
// Objetivo: que una historia generada parezca hecha por una persona en el editor de la propia red, no
// un diseño externo de IA. Los rasgos que lo producen (observados en secuencias reales de creadores):
//   · el texto va en CAJAS de fondo (blanca o negra semitransparente) o con MARCADOR sobre una palabra,
//     no flotando sobre la foto;
//   · UN solo color de acento y UNA palabra marcada por historia;
//   · la foto es textura: oscurecida (60-80 %) cuando manda el texto, limpia en el gancho y el cierre;
//   · pequeñas «imperfecciones» de creador: flechas a mano, emojis grandes, etiqueta de fecha, chip
//     numerado, stickers de pregunta;
//   · el texto respeta la zona segura (la interfaz de la red tapa arriba y abajo).
// Todo son clases CSS con prefijo `ig-`; el agente las usa en vez de inventar estilos y `wrapSlideHtml`
// las inyecta en el documento de las historias.

export const ZONA_SEGURA = { arriba: 250, abajo: 340 } as const

/** Zonas libres de la interfaz de cada red (px sobre 1080×1920). Valores aproximados: ambas redes cambian su interfaz. */
export const SEGURA_POR_PLATAFORMA = {
  instagram: { arriba: 250, abajo: 340, derecha: 70 },
  // Arriba se reserva igual que en Instagram porque ahí van la fecha y el logo de la cabecera.
  tiktok: { arriba: 250, abajo: 480, derecha: 150 },
} as const
export type Plataforma = keyof typeof SEGURA_POR_PLATAFORMA

/** Familias de Google Fonts que usa el estilo (se cargan solo si la slide las nombra en font-family). */
export const FUENTES_NATIVAS = {
  titulo: 'DM Serif Display',
  cuerpo: 'Newsreader',
  impacto: 'Anton',
  maquina: 'Space Mono',
  // Parecidas a las del editor de texto de Instagram (Instagram no publica las suyas): se afinan con los ejemplos del tenant.
  classic: 'Inter',
  modern: 'Montserrat',
  neon: 'Quicksand',
  typewriter: 'Courier Prime',
} as const

/** Nombres de las familias nativas, para incrustarlas al exportar. */
export const FAMILIAS_NATIVAS: string[] = Object.values(FUENTES_NATIVAS)

/** Tipografías del editor de texto de Instagram: una clase `ig-f-*` en la zona de texto las aplica a todo su contenido. */
const SELECTOR_TEXTO =
  ':is(.ig-titulo,.ig-texto,.ig-texto-pequeno,.ig-caja,.ig-caja-negra,.ig-caja-acento,.ig-caja-solida-negra,.ig-caja-vidrio,.ig-recuadro,.ig-recuadro b,.ig-cifra)'
const CSS_TIPOGRAFIAS_IG = [
  ['classic', `'${FUENTES_NATIVAS.classic}',system-ui,sans-serif;font-weight:700`],
  ['modern', `'${FUENTES_NATIVAS.modern}',system-ui,sans-serif;font-weight:600`],
  [
    'neon',
    `'${FUENTES_NATIVAS.neon}',system-ui,sans-serif;font-weight:700;text-shadow:0 0 14px var(--ig-acento),0 0 3px var(--ig-acento)`,
  ],
  ['typewriter', `'${FUENTES_NATIVAS.typewriter}',monospace;font-weight:700`],
  ['strong', `'${FUENTES_NATIVAS.impacto}',Impact,sans-serif;font-weight:400;text-transform:uppercase`],
  ['serif', `var(--ig-f-titulo,'${FUENTES_NATIVAS.titulo}'),Georgia,serif;font-weight:400`],
]
  .map(([n, css]) => `.ig-f-${n} ${SELECTOR_TEXTO}{font-family:${css}}`)
  .join('\n')

/**
 * CSS de los componentes. Las plantillas nuevas (layouts.ts) usan solo una parte; el resto se conserva porque las historias
 * guardadas antes de las plantillas llevan HTML propio con esas clases (ig-impacto, ig-chip, ig-flecha…).
 * `--ig-acento` y `--ig-acento-texto` se fijan por proyecto (color de marca) y
 * `--ig-f-titulo` / `--ig-f-cuerpo` con las tipografías de la marca (si no las hay, las del estilo nativo).
 * Dimensiones pensadas para un lienzo de 1080×1920.
 */
export const CSS_NATIVO = `
:root{--ig-acento:#c026d3;--ig-acento-texto:#ffffff;--ig-negro:#0b0b0d;--ig-blanco:#ffffff}
.ig-historia{position:relative;width:1080px;height:1920px;overflow:hidden;background:#111;color:#fff;font-family:var(--ig-f-cuerpo,'${FUENTES_NATIVAS.cuerpo}'),Georgia,serif}
.ig-foto{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ig-velo{position:absolute;inset:0;background:#000}
.ig-velo-0{opacity:0}.ig-velo-20{opacity:.2}.ig-velo-40{opacity:.4}.ig-velo-60{opacity:.6}.ig-velo-75{opacity:.75}
.ig-zona{position:absolute;left:70px;right:var(--ig-seg-derecha,70px);display:flex;flex-direction:column;gap:34px}
.ig-zona-arriba{top:var(--ig-seg-arriba,${ZONA_SEGURA.arriba}px)}
.ig-zona-centro{top:50%;transform:translateY(-50%)}

.ig-zona-abajo{bottom:var(--ig-seg-abajo,${ZONA_SEGURA.abajo}px)}
.ig-centrado{align-items:center;text-align:center}
.ig-titulo{font-family:var(--ig-f-titulo,'${FUENTES_NATIVAS.titulo}'),Georgia,serif;font-weight:400;font-size:112px;line-height:1.04;letter-spacing:-.02em;color:#fff}
.ig-impacto{font-family:'${FUENTES_NATIVAS.impacto}',Impact,sans-serif;text-transform:uppercase;font-size:124px;line-height:1.0;letter-spacing:.005em;color:#fff}
.ig-maquina{font-family:'${FUENTES_NATIVAS.maquina}',monospace;font-size:64px;line-height:1.2;color:#fff}
.ig-texto{font-size:58px;line-height:1.3;color:#fff}
.ig-texto-pequeno{font-size:42px;line-height:1.35;color:#fff;opacity:.92}
.ig-acento{color:var(--ig-acento)}
.ig-marcador{background:linear-gradient(transparent 10%,var(--ig-acento) 10% 90%,transparent 90%);color:var(--ig-acento-texto);padding:0 14px;border-radius:8px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ig-caja{display:inline;background:rgba(255,255,255,.95);color:#111;padding:6px 24px;border-radius:12px;font-size:56px;line-height:1.7;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ig-caja-negra{display:inline;background:rgba(0,0,0,.72);color:#fff;padding:6px 24px;border-radius:12px;font-size:56px;line-height:1.7;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ig-caja-acento{display:inline;background:var(--ig-acento);color:var(--ig-acento-texto);padding:6px 24px;border-radius:12px;font-size:56px;line-height:1.7;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ig-chip{display:inline-flex;align-items:center;justify-content:center;width:104px;height:104px;border-radius:26px;background:rgba(255,255,255,.92);color:#111;font-family:var(--ig-f-titulo,'${FUENTES_NATIVAS.titulo}'),Georgia,serif;font-size:72px}
.ig-recuadro{border:7px solid var(--ig-acento);border-radius:64px;padding:36px 44px;text-align:center;font-size:52px;line-height:1.3;color:#fff;background:rgba(0,0,0,.18)}
.ig-recuadro b{display:block;font-family:var(--ig-f-titulo,'${FUENTES_NATIVAS.titulo}'),Georgia,serif;font-weight:400;font-size:64px;margin-bottom:10px}
.ig-etiqueta-fecha{position:absolute;top:104px;left:54px;display:flex;flex-direction:column;align-items:center;background:#fff;color:#111;border-radius:14px;padding:8px 18px;font-family:system-ui,sans-serif;font-size:26px;line-height:1.1;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.ig-sticker-pregunta{width:760px;border-radius:30px;overflow:hidden;background:#fff;color:#111;font-family:system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.28)}
.ig-sticker-pregunta .ig-sp-cab{background:#1c1c1e;color:#fff;text-align:center;font-size:30px;font-weight:700;padding:20px}
.ig-sticker-pregunta .ig-sp-cuerpo{padding:34px 36px;font-size:46px;line-height:1.3;text-align:center;font-weight:500}
.ig-sticker-escribe{width:640px;border-radius:30px;background:rgba(0,0,0,.82);color:#fff;font-family:system-ui,sans-serif;padding:26px 30px;font-size:36px}
.ig-sticker-escribe div{margin-top:16px;border-radius:18px;background:rgba(255,255,255,.16);padding:22px 26px;color:rgba(255,255,255,.6);font-size:32px}
.ig-partida{position:absolute;inset:0;display:grid;grid-template-rows:1fr 1fr}
.ig-partida>div{position:relative;overflow:hidden}
.ig-flecha{position:absolute;width:210px;height:150px;pointer-events:none}
.ig-captura{background:#fff;color:#111;border-radius:26px;padding:26px 30px;box-shadow:0 4px 18px rgba(0,0,0,.3);font-family:system-ui,sans-serif;font-size:40px}
.ig-emoji{font-size:84px;line-height:1}
${CSS_TIPOGRAFIAS_IG}
.ig-caja-solida-negra{display:inline;background:#000;color:#fff;padding:6px 24px;border-radius:12px;font-size:56px;line-height:1.7;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ig-caja-vidrio{display:inline;background:rgba(255,255,255,.55);color:#111;padding:6px 24px;border-radius:12px;font-size:56px;line-height:1.7;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ig-captura-real{background:#fff;border-radius:26px;padding:14px;box-shadow:0 4px 18px rgba(0,0,0,.3)}
.ig-captura-real img{display:block;max-width:100%;max-height:820px;border-radius:16px;object-fit:contain}
.ig-pedido{width:720px;border:6px dashed var(--ig-acento);border-radius:32px;padding:44px;text-align:center;color:#fff;font-family:system-ui,sans-serif;font-size:42px;line-height:1.3;background:rgba(0,0,0,.35)}
.ig-pedido b{display:block;font-size:30px;letter-spacing:.12em;color:var(--ig-acento);margin:8px 0}
.ig-zona.ig-zona-libre{top:var(--ig-top);max-height:calc(1920px - var(--ig-seg-abajo,${ZONA_SEGURA.abajo}px) - var(--ig-top))}
.ig-fondo{position:absolute;inset:0;overflow:hidden}
.ig-zona{max-height:calc(1920px - var(--ig-seg-arriba,${ZONA_SEGURA.arriba}px) - var(--ig-seg-abajo,${ZONA_SEGURA.abajo}px));overflow:hidden}
.ig-cabecera{position:absolute;top:104px;left:54px;right:54px;display:flex;justify-content:space-between;align-items:flex-start}
.ig-cabecera .ig-etiqueta-fecha{position:static}
.ig-logo{height:64px;max-width:260px;object-fit:contain;margin-left:auto}
.ig-cifra{font-family:var(--ig-f-titulo,'${FUENTES_NATIVAS.titulo}'),Georgia,serif;font-size:230px;line-height:1;color:var(--ig-acento)}
.ig-franja{background:rgba(0,0,0,.5);padding:28px 40px}
`

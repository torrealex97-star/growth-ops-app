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

/** Familias de Google Fonts que usa el estilo (se cargan solo si la slide las nombra en font-family). */
export const FUENTES_NATIVAS = {
  titulo: 'DM Serif Display',
  cuerpo: 'Newsreader',
  impacto: 'Anton',
  maquina: 'Space Mono',
} as const

/**
 * CSS de los componentes. `--ig-acento` y `--ig-acento-texto` se fijan por proyecto (color de marca).
 * Dimensiones pensadas para un lienzo de 1080×1920.
 */
export const CSS_NATIVO = `
:root{--ig-acento:#c026d3;--ig-acento-texto:#ffffff;--ig-negro:#0b0b0d;--ig-blanco:#ffffff}
.ig-historia{position:relative;width:1080px;height:1920px;overflow:hidden;background:#111;color:#fff;font-family:'${FUENTES_NATIVAS.cuerpo}',Georgia,serif}
.ig-foto{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ig-velo{position:absolute;inset:0;background:#000}
.ig-velo-0{opacity:0}.ig-velo-20{opacity:.2}.ig-velo-40{opacity:.4}.ig-velo-60{opacity:.6}.ig-velo-75{opacity:.75}
.ig-zona{position:absolute;left:70px;right:70px;display:flex;flex-direction:column;gap:34px}
.ig-zona-arriba{top:${ZONA_SEGURA.arriba}px}
.ig-zona-centro{top:50%;transform:translateY(-50%)}
.ig-zona-abajo{bottom:${ZONA_SEGURA.abajo}px}
.ig-centrado{align-items:center;text-align:center}
.ig-titulo{font-family:'${FUENTES_NATIVAS.titulo}',Georgia,serif;font-weight:400;font-size:112px;line-height:1.04;letter-spacing:-.02em;color:#fff}
.ig-impacto{font-family:'${FUENTES_NATIVAS.impacto}',Impact,sans-serif;text-transform:uppercase;font-size:124px;line-height:1.0;letter-spacing:.005em;color:#fff}
.ig-maquina{font-family:'${FUENTES_NATIVAS.maquina}',monospace;font-size:64px;line-height:1.2;color:#fff}
.ig-texto{font-size:58px;line-height:1.3;color:#fff}
.ig-texto-pequeno{font-size:42px;line-height:1.35;color:#fff;opacity:.92}
.ig-acento{color:var(--ig-acento)}
.ig-marcador{background:linear-gradient(transparent 10%,var(--ig-acento) 10% 90%,transparent 90%);color:var(--ig-acento-texto);padding:0 14px;border-radius:8px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ig-caja{display:inline;background:rgba(255,255,255,.95);color:#111;padding:6px 24px;border-radius:12px;font-size:56px;line-height:1.7;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ig-caja-negra{display:inline;background:rgba(0,0,0,.72);color:#fff;padding:6px 24px;border-radius:12px;font-size:56px;line-height:1.7;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ig-caja-acento{display:inline;background:var(--ig-acento);color:var(--ig-acento-texto);padding:6px 24px;border-radius:12px;font-size:56px;line-height:1.7;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.ig-chip{display:inline-flex;align-items:center;justify-content:center;width:104px;height:104px;border-radius:26px;background:rgba(255,255,255,.92);color:#111;font-family:'${FUENTES_NATIVAS.titulo}',Georgia,serif;font-size:72px}
.ig-recuadro{border:7px solid var(--ig-acento);border-radius:64px;padding:36px 44px;text-align:center;font-size:52px;line-height:1.3;color:#fff;background:rgba(0,0,0,.18)}
.ig-recuadro b{display:block;font-family:'${FUENTES_NATIVAS.titulo}',Georgia,serif;font-weight:400;font-size:64px;margin-bottom:10px}
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
`

/** Flecha dibujada a mano (SVG inline) para señalar algo, con rotación opcional en grados. */
export function flechaSvg(rotacion = 0, color = '#ffffff'): string {
  return `<svg class="ig-flecha" viewBox="0 0 210 150" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${Math.round(rotacion)}deg)"><path d="M8 118 C 40 30, 120 20, 186 52"/><path d="M158 24 L 188 54 L 152 76"/></svg>`
}

/** Documentación de los componentes para el agente (nombres de clase y cuándo usarlos). */
export const GUIA_COMPONENTES = `Componentes del editor nativo (clases CSS ya cargadas; NO redefinas su estilo):
- Contenedor: <div class="ig-historia"> con <img class="ig-foto" src="URL"> y <div class="ig-velo ig-velo-60"></div> (velos: 0, 20, 40, 60, 75).
- Zonas de texto (respeta la zona segura: ~${ZONA_SEGURA.arriba}px arriba y ~${ZONA_SEGURA.abajo}px abajo libres): ig-zona ig-zona-arriba | ig-zona-centro | ig-zona-abajo (+ ig-centrado).
- Titulares: ig-titulo (serif grande), ig-impacto (condensado en mayúsculas), ig-maquina (tipo máquina de escribir). Cuerpo: ig-texto, ig-texto-pequeno.
- Acento: <span class="ig-acento">palabra</span> o <span class="ig-marcador">palabra</span> (marcador tipo rotulador). UNA sola palabra de acento por historia.
- Cajas de texto como en el editor: <span class="ig-caja">…</span> (blanca), ig-caja-negra, ig-caja-acento. Úsalas para frases largas sobre foto. Envuelve SIEMPRE la caja en su propio <div> (<div><span class="ig-caja-negra">texto</span></div>): así se ajusta al texto línea a línea como en el editor; directamente dentro de ig-zona se estira a todo el ancho.
- Número de paso: <span class="ig-chip">1</span>. Comparaciones: <div class="ig-recuadro"><b>2025</b>texto</div>.
- Etiqueta de fecha en la primera historia: <div class="ig-etiqueta-fecha"><span>8</span><span>ene.</span><span>2026</span></div>.
- Stickers: <div class="ig-sticker-pregunta"><div class="ig-sp-cab">HABLEMOS CLARO 🤩</div><div class="ig-sp-cuerpo">Pregunta…</div></div>; <div class="ig-sticker-escribe">HABLEMOS CLARO<div>Escribe algo…</div></div>.
- Pantalla partida: <div class="ig-partida"><div>foto arriba</div><div>foto abajo</div></div>.
- Captura de pantalla / prueba: <div class="ig-captura">…</div> con cifras reales.
- Emojis grandes (ig-emoji) como adorno funcional (⚠️ ✅ ❌ ☠️), nunca decorativo.
- Flecha a mano: pega el SVG que devuelve la guía de la tool o escribe <svg class="ig-flecha" …> con trazo blanco.`

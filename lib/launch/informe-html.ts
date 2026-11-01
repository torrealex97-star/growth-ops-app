import type { PasoEmbudo } from './informe'

// Exportación del informe a HTML autocontenido (se abre en cualquier navegador y se imprime a PDF).
// Todo texto que llega del informe se ESCAPA: contiene nombres de anuncios y frases de personas,
// es decir, texto que no controlamos. Sin scripts, sin recursos externos.

export type InformeExportable = {
  lanzamiento: { label: string; fecha: string }
  registrados: number
  conEncuesta: number
  embudo: PasoEmbudo[]
  anuncios: {
    anuncio: string
    totalLeads: number
    conEncuesta: number
    pctBuenos: number
    citas: number
    veredicto: string
  }[]
  frenos: { base: number; items: { texto: string; n: number; pct: number }[] }
  frases: { base: number; items: { frase: string; personas: number; pct: number }[] }
  faltan: { mensaje: string; solucion: string }[]
  acciones: { area: string; texto: string; dato: string }[]
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )

const VEREDICTO: Record<string, string> = {
  escalar: 'Escalar',
  mantener: 'Mantener',
  apagar: 'Apagar',
  muestra_corta: 'Muestra corta',
}

export function informeAHtml(
  i: InformeExportable,
  meta: { momento: 'intermedio' | 'final'; generadoAt: string }
): string {
  const lista = (items: string[]) => (items.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : '')
  const embudo = i.embudo
    .map(
      (p) =>
        `<tr><td>${esc(p.etiqueta)}</td><td class="n">${
          p.n === null ? '<em>Dato no disponible</em>' : esc(p.n.toLocaleString('es-ES'))
        }</td><td class="n">${p.pctSobreAnterior === null ? '—' : `${esc(p.pctSobreAnterior)}%`}</td></tr>`
    )
    .join('')
  const anuncios = i.anuncios.length
    ? `<table><thead><tr><th>Anuncio</th><th class="n">Leads</th><th class="n">Buenos (n)</th><th class="n">Con cita</th><th>Veredicto</th></tr></thead><tbody>${i.anuncios
        .map(
          (a) =>
            `<tr><td>${esc(a.anuncio)}</td><td class="n">${esc(a.totalLeads)}</td><td class="n">${
              a.conEncuesta > 0 ? `${esc(a.pctBuenos)}% (${esc(a.conEncuesta)})` : '—'
            }</td><td class="n">${esc(a.citas)}</td><td>${esc(VEREDICTO[a.veredicto] ?? a.veredicto)}</td></tr>`
        )
        .join('')}</tbody></table>`
    : '<p><em>Ningún anuncio llega al mínimo de leads para compararse.</em></p>'
  const fecha = new Date(meta.generadoAt)
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Informe ${esc(meta.momento)} · ${esc(i.lanzamiento.label)}</title>
<style>
body{font:16px/1.5 system-ui,-apple-system,sans-serif;color:#111;max-width:860px;margin:2rem auto;padding:0 1rem}
h1{font-size:1.8rem;letter-spacing:-.02em;margin:0}h2{font-size:1.15rem;letter-spacing:-.015em;margin:2rem 0 .5rem;border-bottom:1px solid #ddd;padding-bottom:.25rem}
.sub{color:#666;font-size:.9rem}table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid #eee}
.n{text-align:right;font-variant-numeric:tabular-nums}li{margin:.25rem 0}.d{color:#666;font-size:.85rem}
@media print{body{margin:0}h2{break-after:avoid}}
</style></head><body>
<h1>Informe ${meta.momento === 'final' ? 'final' : 'intermedio'} del lanzamiento</h1>
<p class="sub">${esc(i.lanzamiento.label)} · evento ${esc(i.lanzamiento.fecha)} · generado el ${esc(
    fecha.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })
  )} · ${esc(i.registrados.toLocaleString('es-ES'))} registrados</p>
<h2>Embudo</h2><table><thead><tr><th>Paso</th><th class="n">Personas</th><th class="n">Del paso anterior</th></tr></thead><tbody>${embudo}</tbody></table>
<h2>Anuncios</h2>${anuncios}
<h2>Qué les frena</h2>${
    i.frenos.base
      ? lista(i.frenos.items.map((f) => `${esc(f.texto)} — ${esc(f.pct)}% (${esc(f.n)})`)) +
        `<p class="d">Sobre ${esc(i.frenos.base)} respuestas.</p>`
      : '<p><em>Dato no disponible: nadie ha contestado esa pregunta.</em></p>'
  }
<h2>Sus frases</h2>${
    i.frases.items.length
      ? lista(i.frases.items.map((f) => `«${esc(f.frase)}» — ${esc(f.personas)} personas (${esc(f.pct)}%)`)) +
        `<p class="d">Sobre ${esc(i.frases.base)} respuestas.</p>`
      : '<p><em>Sin frases repetidas por al menos 3 personas.</em></p>'
  }
<h2>Acciones</h2>${
    i.acciones.length
      ? lista(
          i.acciones.map(
            (a) => `<strong>${esc(a.area)}:</strong> ${esc(a.texto)}<br><span class="d">${esc(a.dato)}</span>`
          )
        )
      : '<p><em>Con los datos actuales no hay ningún cambio que se justifique con una cifra.</em></p>'
  }
${
  i.faltan.length
    ? `<h2>Datos que faltan</h2>${lista(i.faltan.map((f) => `${esc(f.mensaje)}<br><span class="d">${esc(f.solucion)}</span>`))}`
    : ''
}
</body></html>`
}

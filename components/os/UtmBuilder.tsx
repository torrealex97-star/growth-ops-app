'use client'

import { useMemo, useState } from 'react'
import { Link2 } from 'lucide-react'
import { construirUrlUtm, parametrosMeta, validarUrlUtm } from '@/lib/tracking/utm'

const inputCls =
  'h-9 w-full rounded-lg border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand-500 focus:outline-none'

async function copiar(texto: string, avisar: (m: string) => void) {
  try {
    await navigator.clipboard.writeText(texto)
    avisar('Copiado')
  } catch {
    avisar('No se pudo copiar: selecciónalo a mano')
  }
}

/**
 * Generador y revisor de enlaces con UTMs. Sin UTMs en los enlaces de anuncios y landings el tracker
 * no tiene nada que capturar y el lead queda sin origen: esta es la causa más común de atribución vacía.
 */
export function UtmBuilder() {
  const [base, setBase] = useState('')
  const [source, setSource] = useState('')
  const [medium, setMedium] = useState('')
  const [campaign, setCampaign] = useState('')
  const [content, setContent] = useState('')
  const [revisar, setRevisar] = useState('')
  const [aviso, setAviso] = useState('')

  const generado = useMemo(
    () => (base ? construirUrlUtm(base, { source, medium, campaign, content }) : null),
    [base, source, medium, campaign, content]
  )
  const avisos = useMemo(() => (revisar.trim() ? validarUrlUtm(revisar) : []), [revisar])

  return (
    <div className="dashboard-card space-y-5 p-5">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Link2 className="h-4 w-4 text-brand-400" /> Enlaces con UTMs
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Sin UTMs en el enlace, el lead llega sin origen. Genera el enlace o pega uno para revisarlo.
        </p>
      </div>

      <div className="space-y-3">
        <input
          className={inputCls}
          placeholder="URL de destino (https://…)"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          aria-label="URL de destino"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className={inputCls}
            placeholder="Origen (instagram)"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Origen"
          />
          <input
            className={inputCls}
            placeholder="Medio (paid_social)"
            value={medium}
            onChange={(e) => setMedium(e.target.value)}
            aria-label="Medio"
          />
          <input
            className={inputCls}
            placeholder="Campaña"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            aria-label="Campaña"
          />
          <input
            className={inputCls}
            placeholder="Contenido / anuncio"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            aria-label="Contenido"
          />
        </div>
        {generado && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            {generado.ok ? (
              <div className="flex flex-wrap items-center gap-3">
                <code className="min-w-0 flex-1 break-all text-xs text-foreground">{generado.url}</code>
                <button
                  type="button"
                  className="text-xs font-medium text-brand-400 hover:underline"
                  onClick={() => copiar(generado.url, setAviso)}
                >
                  Copiar
                </button>
              </div>
            ) : (
              <p className="text-muted-foreground">{generado.error}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-xs font-medium text-foreground">Anuncios de Meta (parámetros de URL del anuncio)</p>
        <p className="text-xs text-muted-foreground">
          Pega esto en «Parámetros de URL» al crear el anuncio. Meta sustituye cada {'{{macro}}'} por el nombre y el ID
          reales, así el Dashboard sabrá campaña y anuncio exactos.
        </p>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <code className="min-w-0 flex-1 break-all text-xs text-foreground">{parametrosMeta()}</code>
          <button
            type="button"
            className="text-xs font-medium text-brand-400 hover:underline"
            onClick={() => copiar(parametrosMeta(), setAviso)}
          >
            Copiar
          </button>
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-xs font-medium text-foreground">Revisar un enlace existente</p>
        <input
          className={inputCls}
          placeholder="Pega aquí un enlace de anuncio o landing"
          value={revisar}
          onChange={(e) => setRevisar(e.target.value)}
          aria-label="Enlace a revisar"
        />
        {revisar.trim() && (
          <ul className="space-y-1 text-xs" aria-live="polite">
            {avisos.length === 0 ? (
              <li className="text-emerald-400">Correcto: tiene origen, medio, campaña y anuncio.</li>
            ) : (
              avisos.map((a, i) => (
                <li key={i} className="text-muted-foreground">
                  <span className="font-medium text-foreground">{a.nivel === 'error' ? 'Falta · ' : 'Ojo · '}</span>
                  {a.mensaje}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {aviso && (
        <p role="status" className="text-xs text-muted-foreground">
          {aviso}
        </p>
      )}
    </div>
  )
}

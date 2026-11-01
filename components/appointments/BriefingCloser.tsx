import { construirBriefing, type EntradaBriefing } from '@/lib/closer/briefing'

// Briefing de la llamada: de dónde viene, qué contestó, qué le preocupa y qué palancas tocar. Se
// calcula solo con lo que ya hay en la cita (sin consultas nuevas); si no hay nada, no se pinta.

const NIVEL: Record<string, string> = { alto: 'Lead alto', medio: 'Lead medio', bajo: 'Lead bajo' }

export function BriefingCloser({ entrada }: { entrada: EntradaBriefing }) {
  const b = construirBriefing(entrada)
  if (!b.conDatos) return null
  return (
    <section aria-label="Briefing de la llamada" className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Briefing de la llamada</h3>
        {b.leadNivel && NIVEL[b.leadNivel] && (
          <span className="text-xs text-muted-foreground">{NIVEL[b.leadNivel]}</span>
        )}
      </div>

      {(b.angulo.anuncio || b.angulo.campana) && (
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Ángulo con el que entró:</span>{' '}
          {[b.angulo.anuncio, b.angulo.campana].filter(Boolean).join(' · ')}
        </p>
      )}

      {b.palancas.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Palancas a tocar</h4>
          <ul className="mt-1 space-y-2">
            {b.palancas.map((p) => (
              <li key={p.temaId} className="text-sm">
                <p className="font-medium text-foreground">{p.tema}</p>
                <p className="text-muted-foreground">{p.palanca}</p>
                <p className="text-xs text-muted-foreground">{p.porQue}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {b.objeccionesPrevias.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Objeciones en llamadas anteriores
          </h4>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
            {b.objeccionesPrevias.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      )}

      {b.situacion.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Lo que contestó ({b.situacion.length})
          </summary>
          <dl className="mt-2 space-y-1.5">
            {b.situacion.map((r, i) => (
              <div key={i}>
                <dt className="text-xs text-muted-foreground">{r.pregunta}</dt>
                <dd className="text-foreground">{r.respuesta}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  )
}

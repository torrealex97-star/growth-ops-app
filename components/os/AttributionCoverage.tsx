'use client'

// COBERTURA DE ATRIBUCIÓN (§21 de la spec del dashboard global): parte del negocio con origen
// conocido. Vive en Marketing › Atribución — junto al resto del diagnóstico de atribución — no en
// el dashboard de Métricas y KPIs, donde solo confundía la lectura del negocio.
// Presentación pura: los porcentajes llegan calculados (coveragePct de lib/canonical/dedup).

export type AttributionCoverageData = {
  leads: number | null
  sales: number | null
  revenue: number | null
  /** Recuentos absolutos del lado «sin origen» (lo que la RPC reporta como «Directo / Sin atribuir»):
   *  con ellos la pantalla declara el hueco con la MISMA redacción que Anuncios y Embudo CRM.
   *  Opcional: sin ellos no hay nota (p. ej. error global de carga). */
  sinOrigen?: { leads: number; leadsTotal: number; sales: number; salesTotal: number }
}

export function AttributionCoverage({ coverage }: { coverage: AttributionCoverageData }) {
  const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n)}%`)
  const sinOrigen = coverage.sinOrigen
  const hueco = sinOrigen && sinOrigen.leadsTotal > 0 ? sinOrigen.leads : null
  return (
    <div className="dashboard-card p-5">
      <h3 className="font-display text-lg font-semibold">Cobertura de atribución</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Parte del negocio con canal conocido. La fuente de importación no acredita atribución publicitaria.
      </p>
      {/* Misma nota de hueco que Anuncios/Embudo CRM (los «no llegan a un X concreto»: no se
          reparten ni se inventan), con la entidad correcta de esta pantalla: aquí el hueco son
          leads sin canal conocido, no agendas sin anuncio. */}
      {hueco !== null && hueco > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {sinOrigen?.leads} de {sinOrigen?.leadsTotal} leads del periodo no llegan a un canal conocido (origen
          directo/sin UTM): no se reparten ni se inventan; quedan en la fila «Directo / Sin atribuir» del desglose por
          fuente.
        </p>
      )}
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        {(
          [
            ['Leads', coverage.leads],
            ['Ventas', coverage.sales],
            ['Facturación', coverage.revenue],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 font-display text-xl font-semibold tabular-nums">{pct(v)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

'use client'

import { Megaphone } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/utils'
import type { CampaignAdFunnelRow } from '@/lib/analytics'

/**
 * Hermana de AttributionTable, un nivel más abajo: esa agrupa por CANAL (Meta/Instagram/
 * Orgánico), esta por CAMPAÑA Y ANUNCIO exactos — lo que de verdad hace falta para decidir qué
 * creativo escalar o cortar, no solo que "Meta funciona". Nunca inventa un nombre: si no hay
 * campaña/anuncio resuelto contra el catálogo sincronizado, se dice explícitamente en vez de
 * enseñar el UTM crudo como si fuera el nombre real.
 */
export function CampaignAdAttributionTable({ rows }: { rows: CampaignAdFunnelRow[] }) {
  const withData = rows.filter((r) => r.leads > 0 || r.sales > 0)
  return (
    <div className="dashboard-card p-5">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Megaphone className="w-4 h-4 text-brand-400" />
        <h3 className="text-sm font-semibold text-foreground">Campaña y anuncio exactos</h3>
        <span className="text-xs text-muted-foreground">
          de dónde viene cada lead, no solo de qué canal — leads y ventas del periodo
        </span>
      </div>
      {withData.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Sin leads atribuidos a Meta todavía.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-2xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left font-medium py-2">Campaña</th>
                <th className="text-left font-medium py-2">Anuncio</th>
                <th className="text-right font-medium py-2">Leads</th>
                <th className="text-right font-medium py-2">Ventas</th>
                <th className="text-right font-medium py-2">Facturación</th>
              </tr>
            </thead>
            <tbody>
              {withData.map((r, i) => (
                <tr
                  key={`${r.campaignExternalId ?? 'sc'}-${r.adExternalId ?? 'sa'}-${i}`}
                  className="border-b border-border/50 last:border-0"
                >
                  <td className="py-2.5 text-foreground max-w-[220px] truncate">
                    {r.campaignName ?? <span className="text-muted-foreground italic">Sin campaña identificada</span>}
                  </td>
                  <td className="py-2.5 text-foreground max-w-[220px] truncate">
                    {r.adName ?? (
                      <span className="text-muted-foreground italic">
                        {r.campaignName ? 'Anuncio no identificado' : '—'}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right text-foreground">{formatNumber(r.leads)}</td>
                  <td className="py-2.5 text-right text-foreground">{formatNumber(r.sales)}</td>
                  <td className="py-2.5 text-right font-semibold text-foreground">{formatCurrency(r.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

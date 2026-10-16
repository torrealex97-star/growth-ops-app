'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { contactIdsDeScope, resolverScopeColaborador } from '@/lib/collaborators/scope'
import { embudoSimple, type EmbudoSimple } from '@/lib/collaborators/embudo-simple'
import { formatPercent } from '@/lib/utils'

const LOTE = 80

/**
 * Embudo sencillo para colaboradoras: de SUS personas, cuántas agendaron, asistieron y cerraron.
 * Solo lee lo atribuido a su perfil (scope de datos + RLS como respaldo).
 */
export default function EmbudoColaboradora({ tenantId, userId }: { tenantId: string; userId: string }) {
  const [datos, setDatos] = useState<EmbudoSimple | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const sb = createClient()
        const scope = await resolverScopeColaborador(sb, userId, tenantId)
        const ids = (await contactIdsDeScope(sb, tenantId, scope)) ?? []
        const contactos: { id: string; full_name: string | null }[] = []
        const citas: { contact_id: string | null; status: string | null }[] = []
        const ventas: {
          contact_id: string | null
          status: string
          gross_amount: number
          sale_date: string | null
        }[] = []
        for (let i = 0; i < ids.length; i += LOTE) {
          const lote = ids.slice(i, i + LOTE)
          const [c, a, v] = await Promise.all([
            sb.from('contacts').select('id, full_name').eq('tenant_id', tenantId).in('id', lote),
            sb.from('appointments').select('contact_id, status').eq('tenant_id', tenantId).in('contact_id', lote),
            sb
              .from('sales')
              .select('contact_id, status, gross_amount, sale_date, reservation_completed_at, payment_plans(method)')
              .eq('tenant_id', tenantId)
              .in('contact_id', lote),
          ])
          if (c.error || a.error || v.error) throw new Error('lectura')
          contactos.push(...((c.data ?? []) as typeof contactos))
          citas.push(...((a.data ?? []) as typeof citas))
          ventas.push(...((v.data ?? []) as unknown as typeof ventas))
        }
        if (!vivo) return
        setDatos(embudoSimple(contactos, citas, ventas as never))
      } catch {
        if (vivo) setError(true)
      }
    })()
    return () => {
      vivo = false
    }
  }, [tenantId, userId])

  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
        No se pudo cargar tu embudo. Recarga la página.
      </p>
    )
  }
  if (!datos) return <p className="text-sm text-muted-foreground">Cargando tu embudo…</p>

  const tarjetas: [string, number][] = [
    ['Personas que has traído', datos.personas],
    ['Agendaron', datos.agendaron],
    ['Asistieron', datos.asistieron],
    ['Cerraron', datos.cerraron],
  ]
  return (
    <section aria-label="Mi embudo" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tarjetas.map(([t, n]) => (
          <div key={t} className="rounded-lg border border-border bg-card/50 p-4">
            <p className="text-xs text-muted-foreground">{t}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{n}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {datos.cierre === null
          ? 'Aún no hay llamadas con asistencia para calcular el cierre.'
          : `Cierre: ${formatPercent(datos.cierre, 0)} de quienes asistieron.`}
      </p>
      {datos.lista.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="p-2 font-medium">Persona</th>
                <th className="p-2 font-medium">Agendó</th>
                <th className="p-2 font-medium">Asistió</th>
                <th className="p-2 font-medium">Cerró</th>
              </tr>
            </thead>
            <tbody>
              {datos.lista.map((p) => (
                <tr key={p.id} className="border-t border-border/60">
                  <td className="p-2 text-foreground">{p.nombre ?? 'Sin nombre'}</td>
                  <td className="p-2">{p.agendo ? 'Sí' : '—'}</td>
                  <td className="p-2">{p.asistio ? 'Sí' : '—'}</td>
                  <td className="p-2">
                    {p.cerro ? 'Sí' : p.devuelto ? <span className="text-red-400">Devuelto</span> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

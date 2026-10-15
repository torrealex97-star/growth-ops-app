'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, CheckCircle2, ClipboardCheck, CalendarDays } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { columnaDeMisCitas, resumenMiDia, type CitaMiDia } from '@/lib/dashboard/mi-dia'
import { cuentaComoVenta } from '@/lib/analytics'
import { metodoDePlan } from '@/lib/metrics/agregados'
import { formatCurrency } from '@/lib/utils'

type FilaCita = {
  id: string
  appointment_datetime: string
  status: string | null
  contacts: { full_name: string | null } | { full_name: string | null }[] | null
}
type FilaVenta = {
  id: string
  gross_amount: number | string | null
  status: string
  sale_date: string | null
  reservation_completed_at?: string | null
  payment_plans?: unknown
}

const hora = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(
    new Date(iso)
  )
const fechaCorta = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', timeZone: 'Europe/Madrid' }).format(new Date(iso))

function nombre(c: FilaCita['contacts']): string | null {
  const x = Array.isArray(c) ? c[0] : c
  return x?.full_name ?? null
}

/**
 * Bloque «Mi día» para closers, setters y cold callers: lo que tengo hoy, lo que me falta por marcar y
 * mis ventas del mes. Solo lee SUS filas (filtra por su id y la RLS lo respalda).
 */
export default function MiDia({
  tenant,
  tenantId,
  userId,
  rol,
}: {
  tenant: string
  tenantId: string
  userId: string
  rol: string
}) {
  const columna = columnaDeMisCitas(rol)
  const [citas, setCitas] = useState<CitaMiDia[] | null>(null)
  const [ventas, setVentas] = useState<FilaVenta[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!columna) return
    let vivo = true
    const sb = createClient()
    const desde = new Date(Date.now() - 45 * 86_400_000).toISOString()
    const hasta = new Date(Date.now() + 8 * 86_400_000).toISOString()
    const inicioMes = new Date()
    inicioMes.setDate(1)
    const ymd = inicioMes.toISOString().slice(0, 10)
    ;(async () => {
      const [c, v] = await Promise.all([
        sb
          .from('appointments')
          .select('id, appointment_datetime, status, contacts(full_name)')
          .eq('tenant_id', tenantId)
          .eq(columna, userId)
          .gte('appointment_datetime', desde)
          .lte('appointment_datetime', hasta)
          .order('appointment_datetime', { ascending: true })
          .limit(500),
        sb
          .from('sales')
          .select('id, gross_amount, status, sale_date, reservation_completed_at, payment_plans(method)')
          .eq('tenant_id', tenantId)
          .eq(rol === 'closer' ? 'closer_id' : 'setter_id', userId)
          .gte('sale_date', ymd)
          .limit(500),
      ])
      if (!vivo) return
      if (c.error || v.error) {
        setError(true)
        return
      }
      setCitas(
        ((c.data ?? []) as unknown as FilaCita[]).map((x) => ({
          id: x.id,
          appointment_datetime: x.appointment_datetime,
          status: x.status,
          contacto: nombre(x.contacts),
        }))
      )
      setVentas((v.data ?? []) as unknown as FilaVenta[])
    })()
    return () => {
      vivo = false
    }
  }, [columna, rol, tenantId, userId])

  const resumen = useMemo(() => (citas ? resumenMiDia(citas) : null), [citas])
  const misVentas = useMemo(
    () =>
      (ventas ?? []).filter((s) =>
        cuentaComoVenta({ ...s, payment_plan_method: metodoDePlan(s as { payment_plans?: unknown }) } as never)
      ),
    [ventas]
  )

  if (!columna) return null
  if (error) {
    return (
      <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
        No se pudo cargar «Mi día». Recarga la página; tus datos no se han perdido.
      </p>
    )
  }

  const agendas = `/${tenant}/crm/agendas`
  const total = misVentas.reduce((a, s) => a + Number(s.gross_amount ?? 0), 0)
  const cargando = resumen === null

  return (
    <section aria-label="Mi día" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tarjeta
          icono={CalendarClock}
          titulo="Hoy"
          valor={cargando ? '—' : String(resumen.hoy.length)}
          nota="llamadas agendadas"
        />
        <Tarjeta
          icono={ClipboardCheck}
          titulo="Por marcar"
          valor={cargando ? '—' : String(resumen.porMarcar.length)}
          nota="ya pasadas, sin asistencia"
          alerta={!cargando && resumen.porMarcar.length > 0}
        />
        <Tarjeta
          icono={CalendarDays}
          titulo="Próximos 7 días"
          valor={cargando ? '—' : String(resumen.proximas7.length)}
          nota="llamadas"
        />
        <Tarjeta
          icono={CheckCircle2}
          titulo="Mis ventas del mes"
          valor={ventas === null ? '—' : String(misVentas.length)}
          nota={ventas === null ? '' : formatCurrency(total)}
        />
      </div>

      {resumen && resumen.porMarcar.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Te faltan {resumen.porMarcar.length} por marcar (asistió / no asistió)
            </h3>
            <Link href={agendas} className="text-xs font-medium text-brand-400 underline-offset-2 hover:underline">
              Abrir Agendas
            </Link>
          </div>
          <ul className="mt-2 divide-y divide-border/60 text-sm">
            {resumen.porMarcar.slice(0, 6).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="truncate text-foreground">{c.contacto ?? 'Sin nombre'}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {fechaCorta(c.appointment_datetime)} · {hora(c.appointment_datetime)}
                </span>
              </li>
            ))}
          </ul>
          {resumen.porMarcar.length > 6 && (
            <p className="mt-2 text-xs text-muted-foreground">y {resumen.porMarcar.length - 6} más en Agendas.</p>
          )}
        </div>
      )}

      {resumen && (
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">Hoy</h3>
          {resumen.hoy.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No tienes llamadas agendadas hoy.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border/60 text-sm">
              {resumen.hoy.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate text-foreground">{c.contacto ?? 'Sin nombre'}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {hora(c.appointment_datetime)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function Tarjeta({
  icono: Icono,
  titulo,
  valor,
  nota,
  alerta,
}: {
  icono: React.ElementType
  titulo: string
  valor: string
  nota: string
  alerta?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${alerta ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-card/50'}`}
    >
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icono className="h-4 w-4" aria-hidden="true" /> {titulo}
      </p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{valor}</p>
      <p className="text-xs text-muted-foreground">{nota}</p>
    </div>
  )
}

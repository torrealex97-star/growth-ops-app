'use client'

// DASHBOARD DEL COLABORADOR (§23-25) — un MODO del dashboard real, no un portal aparte (§16).
//
// Cuando el usuario logueado tiene un collaborator_profiles ACTIVO en esta subcuenta,
// DashboardPage hace early-return a ESTE componente: mismo login, misma ruta, mismos
// componentes (KPICard, PeriodFilterBar) y cero selectores de rol/persona ni widgets
// de empresa (§51) — solo SUS datos.
//
// Reutilización estricta (nada de fórmulas nuevas):
//   · Filtro de periodo GLOBAL: PeriodFilterBar + getPeriodRange/inPeriod (default 'Este mes', §25),
//     SOLO para el embudo (contactos/citas/ventas). Las COMISIONES van MES A MES (tabla tipo Excel,
//     CommissionMonthlyStatement): un colaborador quiere saber cuánto cobra cada mes, no en «30 días».
//   · Definiciones canónicas de métrica: isActiveSale (lib/analytics), isAttended/isNoShow
//     (lib/appointments/status), vocabulario pending/approved/liquidated de comisiones.
//   · SCOPE de datos (§55-57): contactIdsDeScope acota contacts→appointments→sales; las
//     comisiones van por user_id (SU ledger). Fail-closed: sin contactos, todo a cero.
//
// Patrón de carga: se leen UNA VEZ las filas del scope (RLS ya escopa por tenant) y el
// filtro de periodo se aplica en memoria — cambiar de periodo no dispara refetch.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { DEFAULT_PERIOD, getPeriodRange, inPeriod, type PeriodPreset } from '@/lib/filters/period'
import { isActiveSale } from '@/lib/analytics'
import { isAttended, isNoShow } from '@/lib/appointments/status'
import { formatCurrency } from '@/lib/utils'
import { KPICard } from '@/components/os/DashboardKPICard'
import { contactIdsDeScope, type ScopeColaborador } from '@/lib/collaborators/scope'
import { interpretarRespuestaFuturas, type FilaFutura } from '@/lib/commissions/future-response'
import { CommissionMonthlyStatement } from '@/components/commissions/CommissionMonthlyStatement'
import { impagosVencidos } from '@/lib/commissions/mensual'
import type { CommissionDashboardRow } from '@/lib/commissions/dashboard'
import { useTenant, useTenantId, type SesionTenant } from '@/lib/tenant-context'
import { Users, CalendarCheck, PhoneCall, Trophy } from 'lucide-react'

type ContactoRow = { id: string; full_name: string | null; lead_status: string | null; created_at: string | null }
type CitaRow = {
  id: string
  contact_id: string | null
  appointment_datetime: string | null
  status: string | null
  qualification: Record<string, unknown> | null
}
type VentaRow = {
  id: string
  contact_id: string | null
  gross_amount: number | string | null
  status: string | null
  created_at: string | null
}

type Actividad = {
  id: string
  tipo: 'contacto' | 'cita' | 'venta'
  titulo: string
  fecha: string | null
  detalle: string
}

const num = (x: number | string | null | undefined) => Number(x ?? 0)
// Formato canónico de dinero (lib/utils.formatCurrency): 2 decimales siempre, igual que el resto
// de paneles de dinero de la app. Antes este panel redondeaba a entero (maximumFractionDigits: 0),
// así que un cobro de 1.234,50 € se veía distinto aquí que en cualquier otra pantalla de comisiones.
const eur = (n: number) => formatCurrency(n)

const TIPO_STYLE: Record<Actividad['tipo'], string> = {
  contacto: 'bg-sky-500/10 text-sky-400',
  cita: 'bg-brand-400/15 text-brand-300',
  venta: 'bg-emerald-500/10 text-emerald-400',
}

export default function ColaboradorDashboard({
  sesion,
  scope,
}: {
  sesion: SesionTenant
  scope: Extract<ScopeColaborador, { tipo: 'collaborator' }>
}) {
  const tenantId = useTenantId()
  const tenant = useTenant()
  const sb = useMemo(() => createClient(), [])

  // Filtro de periodo GLOBAL (§25): mismos presets y custom que el resto de la app.
  const [preset, setPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const [contactos, setContactos] = useState<ContactoRow[]>([])
  const [citas, setCitas] = useState<CitaRow[]>([])
  const [ventas, setVentas] = useState<VentaRow[]>([])
  const [comisiones, setComisiones] = useState<CommissionDashboardRow[]>([])
  const [futuras, setFuturas] = useState<FilaFutura[]>([])
  // UN ERROR DE CARGA NO ES UN ESTADO VACÍO: la proyección/impagos del colaborador no debe
  // pintarse a 0 cuando /commissions/future falla — se anuncia la fuente ilegible, con reintentar.
  const [futurasError, setFuturasError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // UNA carga por scope; el periodo filtra en memoria (ver cabecera).
  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    setFuturasError(null)
    ;(async () => {
      // Scope del colaborador, fail-closed: [] si aún no tiene nadie atribuido.
      const contactIds = await contactIdsDeScope(sb, tenantId, scope)
      if (!vivo) return
      if (!contactIds || contactIds.length === 0) {
        setContactos([])
        setCitas([])
        setVentas([])
        setComisiones([])
        setCargando(false)
        return
      }

      // Citas y ventas de SUS contactos; su bolsa de comisiones por user_id (§24-25).
      const [resC, resA, resV, resCom] = await Promise.all([
        sb
          .from('contacts')
          .select('id, full_name, lead_status, created_at')
          .eq('tenant_id', tenantId)
          .in('id', contactIds),
        sb
          .from('appointments')
          .select('id, contact_id, appointment_datetime, status, qualification')
          .eq('tenant_id', tenantId)
          .in('contact_id', contactIds),
        sb
          .from('sales')
          .select('id, contact_id, gross_amount, status, created_at')
          .eq('tenant_id', tenantId)
          .in('contact_id', contactIds),
        // Ledger del propio colaborador (user_id = él). Lleva el cliente y el cobro de origen para poder
        // decir, mes a mes, cuánto es VENTA NUEVA y cuánto RECURRENCIA y de qué clientes viene.
        sb
          .from('commissions')
          .select(
            `id, sale_id, collection_id, user_id, participant_type, commission_amount, direction, status,
             liquidation_month, created_at,
             users!commissions_user_id_fkey(id, full_name, pays_commissions),
             sales(id, contacts(full_name)),
             collections(id, collected_at)`
          )
          .eq('tenant_id', tenantId)
          .eq('user_id', sesion.userId),
      ])

      if (!vivo) return
      const primerError = resC.error || resA.error || resV.error || resCom.error
      if (primerError) {
        setError(primerError.message)
        setCargando(false)
        return
      }
      setContactos((resC.data ?? []) as ContactoRow[])
      setCitas((resA.data ?? []) as CitaRow[])
      setVentas((resV.data ?? []) as VentaRow[])
      // D9 (docs/MONEY.md): quien tenga pays_commissions=false no comisiona, tampoco en lectura.
      setComisiones(
        ((resCom.data ?? []) as unknown as CommissionDashboardRow[]).filter(
          (c) => (c.users as { pays_commissions?: boolean } | null)?.pays_commissions !== false
        )
      )
      setCargando(false)

      // COBROS (§25): qué tiene por cobrar (cuotas pendientes/vencidas de SUS
      // ventas). La ruta /commissions/future ya filtra SU lane y su scope; de
      // ahí salen la proyección del próximo mes y los impagos (overdue).
      const resF = await fetch(`/api/${tenant}/evergreen/commissions/future`).catch(() => null)
      if (!vivo) return
      if (!resF) {
        setFuturasError('no se pudo contactar con el servidor')
      } else {
        const res = interpretarRespuestaFuturas(await resF.json().catch(() => null))
        if ('rows' in res) {
          setFuturas(res.rows)
          setFuturasError(null)
        } else {
          setFuturasError(res.error)
        }
      }
    })()
    return () => {
      vivo = false
    }
  }, [sb, tenantId, tenant, scope, sesion.userId])

  // Reintento manual del aviso de fuente ilegible: solo la proyección, sin recargar todo el panel.
  const reintentarFuturas = useCallback(() => {
    setFuturasError(null)
    fetch(`/api/${tenant}/evergreen/commissions/future`)
      .then((r) => r.json())
      .then((d) => {
        const res = interpretarRespuestaFuturas(d)
        if ('rows' in res) setFuturas(res.rows)
        else setFuturasError(res.error)
      })
      .catch(() => setFuturasError('no se pudo contactar con el servidor'))
  }, [tenant])

  const rango = useMemo(() => getPeriodRange(preset, customFrom, customTo), [preset, customFrom, customTo])

  // KPIs del periodo (§23-24) con las definiciones canónicas — sin fórmulas locales nuevas.
  const kpi = useMemo(() => {
    const contactosP = contactos.filter((c) => inPeriod(c.created_at, rango))
    const citasP = citas.filter((c) => inPeriod(c.appointment_datetime, rango))
    const asistidasP = citasP.filter((c) => isAttended(c.status))
    const noShowP = citasP.filter((c) => isNoShow(c.status))
    const ventasActivasP = ventas.filter(
      (v) => isActiveSale({ status: v.status ?? '' }) && inPeriod(v.created_at, rango)
    )
    const revenueP = ventasActivasP.reduce((acc, v) => acc + num(v.gross_amount), 0)
    return {
      contactos: contactosP.length,
      citas: citasP.length,
      asistidas: asistidasP.length,
      noShow: noShowP.length,
      ventas: ventasActivasP.length,
      revenue: revenueP,
    }
  }, [contactos, citas, ventas, rango])

  // Comisión de cuotas VENCIDAS sin cobrar al cliente (impagos): no llega hasta que paguen y NO suma en ningún mes.
  const impagos = useMemo(() => impagosVencidos(futuras), [futuras])

  // CUALIFICACIÓN (§23): lo que respondieron SUS leads en el formulario de agendar
  // (appointments.qualification, escrito por el webhook de GHL/Calendly), agregado
  // por pregunta — así sabe CÓMO de cualificados llegan, no solo cuántos.
  const cualificacionAgregada = useMemo(() => {
    const porPregunta = new Map<string, Map<string, number>>()
    for (const c of citas) {
      const respuestas = c.qualification?.respuestas
      if (!Array.isArray(respuestas)) continue
      for (const { q, a } of respuestas as { q?: string; a?: string }[]) {
        if (!q) continue
        const opciones = porPregunta.get(String(q)) ?? new Map<string, number>()
        const respuesta = (a ?? '').trim() || '(sin respuesta)'
        opciones.set(respuesta, (opciones.get(respuesta) ?? 0) + 1)
        porPregunta.set(String(q), opciones)
      }
    }
    return [...porPregunta.entries()]
      .map(([pregunta, opciones]) => ({
        pregunta,
        total: [...opciones.values()].reduce((acc, n) => acc + n, 0),
        opciones: [...opciones.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5),
      }))
      .sort((x, y) => y.total - x.total)
      .slice(0, 6)
  }, [citas])

  // Embudo §24: conversiones entre etapas canónicas (ratios de KPIs ya definidos).
  const embudo = useMemo(() => {
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
    return {
      citaSobreContacto: pct(kpi.citas, kpi.contactos),
      asistenciaSobreCita: pct(kpi.asistidas, kpi.citas),
      ventaSobreAsistencia: pct(kpi.ventas, kpi.asistidas),
    }
  }, [kpi])

  // Actividad reciente del scope (fuera del filtro de periodo: lo último, siempre).
  const actividad = useMemo<Actividad[]>(() => {
    const nombreDe = new Map(contactos.map((c) => [c.id, c.full_name || 'Contacto']))
    const eventos: Actividad[] = [
      ...contactos.map((c) => ({
        id: `c-${c.id}`,
        tipo: 'contacto' as const,
        titulo: c.full_name || 'Contacto',
        fecha: c.created_at,
        detalle: c.lead_status || 'Nuevo contacto',
      })),
      ...citas
        .slice()
        .sort((a, b) => ((a.appointment_datetime ?? '') < (b.appointment_datetime ?? '') ? 1 : -1))
        .slice(0, 10)
        .map((c) => ({
          id: `a-${c.id}`,
          tipo: 'cita' as const,
          titulo: nombreDe.get(c.contact_id ?? '') ?? 'Cita',
          fecha: c.appointment_datetime,
          detalle: c.status || 'Programada',
        })),
      ...ventas
        .filter((v) => isActiveSale({ status: v.status ?? '' }))
        .sort((a, b) => ((a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1))
        .slice(0, 10)
        .map((v) => ({
          id: `v-${v.id}`,
          tipo: 'venta' as const,
          titulo: nombreDe.get(v.contact_id ?? '') ?? 'Venta',
          fecha: v.created_at,
          detalle: eur(num(v.gross_amount)),
        })),
    ]
    return eventos.sort((a, b) => ((a.fecha ?? '') < (b.fecha ?? '') ? 1 : -1)).slice(0, 12)
  }, [contactos, citas, ventas])

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-foreground">Mi actividad</h1>
        <p className="text-sm text-muted-foreground">Tus comisiones, contactos, citas y ventas · código {scope.code}</p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400" role="alert">
          No se pudieron cargar tus datos: {error}
        </div>
      )}

      {contactos.length === 0 && !cargando && !error && (
        <div className="dashboard-card p-8 text-center">
          <p className="font-medium text-foreground">Aún no tienes contactos atribuidos</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Comparte tu código <span className="font-mono text-brand-300">{scope.code}</span>: todo contacto que llegue
            con él aparecerá aquí automáticamente.
          </p>
        </div>
      )}

      {/* LO PRIMERO, lo que más le importa: cuánto cobra cada mes (tabla tipo Excel), venta nueva vs
          recurrencia y de qué clientes viene. Sin selector de «30 días»: aquí el eje es el MES. */}
      <CommissionMonthlyStatement
        personal
        rows={comisiones}
        basis={comisiones}
        future={futuras}
        futureError={futurasError}
        loading={cargando}
        impagos={impagos}
        personas={[]}
        selectedMemberId="all"
        esEquipo={false}
        onSelectMember={() => {}}
        onRetryFuture={reintentarFuturas}
      />

      {/* §23-24: embudo del colaborador — contactos → citas → asistencia → venta. Este SÍ se mide por periodo. */}
      <section className="space-y-4" aria-labelledby="embudo-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="embudo-heading" className="font-display text-lg font-semibold text-foreground">
              Mi embudo
            </h2>
            <p className="text-sm text-muted-foreground">De tus contactos a tus ventas, en el periodo que elijas.</p>
          </div>
          <PeriodFilterBar
            preset={preset}
            onPresetChange={setPreset}
            customFrom={customFrom}
            customTo={customTo}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            title="Contactos nuevos"
            value={kpi.contactos}
            icon={Users}
            loading={cargando}
            description="Atribuidos a ti en el periodo"
          />
          <KPICard
            title="Citas"
            value={kpi.citas}
            icon={CalendarCheck}
            loading={cargando}
            description={`${kpi.asistidas} asistidas · ${embudo.citaSobreContacto}% de contactos`}
          />
          <KPICard
            title="Asistencia"
            value={kpi.asistidas}
            icon={PhoneCall}
            loading={cargando}
            description={`${embudo.asistenciaSobreCita}% de citas · ${kpi.noShow} no asistieron · ${kpi.citas - kpi.asistidas - kpi.noShow} canceladas`}
          />
          <KPICard
            title="Ventas"
            value={kpi.ventas}
            icon={Trophy}
            loading={cargando}
            description={`${eur(kpi.revenue)} · ${embudo.ventaSobreAsistencia}% de asistidas`}
          />
        </div>
      </section>

      {/* CUALIFICACIÓN: respuestas de SUS leads al formulario de agendar */}
      {cualificacionAgregada.length > 0 && (
        <section className="dashboard-card">
          <h2 className="text-sm font-medium text-muted-foreground mb-1">Cualificación de tus leads</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Lo que respondieron al formulario de agendar — cómo de cualificados llegan
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {cualificacionAgregada.map(({ pregunta, total, opciones }) => (
              <div key={pregunta}>
                <div className="text-xs font-medium text-foreground mb-1.5">
                  {pregunta} <span className="text-muted-foreground">({total})</span>
                </div>
                {opciones.map(([respuesta, n]) => (
                  <div key={respuesta} className="flex items-center gap-2 text-xs mb-1">
                    <div
                      className="h-1.5 rounded bg-brand-400/50"
                      style={{ width: `${Math.max(6, (n / total) * 90)}px` }}
                    />
                    <span className="text-muted-foreground truncate">{respuesta}</span>
                    <span className="text-foreground font-medium">{n}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="dashboard-card">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">Actividad reciente</h2>
        {!cargando && actividad.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividad todavía.</p>
        ) : (
          <ul className="divide-y divide-border">
            {actividad.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`inline-flex w-20 shrink-0 justify-center rounded px-1.5 py-0.5 text-2xs font-medium ${TIPO_STYLE[a.tipo]}`}
                  >
                    {a.tipo}
                  </span>
                  <span className="truncate text-foreground">{a.titulo}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span>{a.detalle}</span>
                  {a.fecha && (
                    <span>{new Date(a.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

'use client'

// DASHBOARD DEL COLABORADOR (§23-25) — un MODO del dashboard real, no un portal aparte (§16).
//
// Cuando el usuario logueado tiene un collaborator_profiles ACTIVO en esta subcuenta, DashboardPage hace
// early-return a ESTE componente: mismo login, misma ruta, cero selectores de rol/persona ni widgets de empresa
// (§51) — solo SUS datos.
//
// UN SOLO SELECTOR DE MES arriba rige TODO (comisiones, factura, embudo). Por defecto, el MES VENCIDO: el mes que
// acaba de cerrar y que realmente está por cobrar (lo que sus clientes pagan en octubre lo cobra en noviembre).
// Se puede pasar al mes actual y a los anteriores. Estructura de arriba abajo:
//   1. mes elegido (grande) con venta nueva / recurrencia y quién la genera;
//   2. clientes con pagos pendientes y por qué (estado real en Stripe);
//   3. su factura de ese mes (misma IA que Gastos);
//   4. gráfico de 12 meses + registro de meses con facturas y total generado desde el inicio;
//   5. previsión (aparte: no es dinero cobrado);
//   6. embudo del mes, que EMPIEZA en las agendas.
//
// Lógica de dinero y de embudo: lib/collaborators/panel.ts y lib/commissions/mensual.ts (puras y con tests).
// SCOPE (§55-57): contactIdsDeScope acota contacts→appointments→sales; las comisiones van por user_id (SU ledger).
// Fail-closed: sin contactos, todo a cero.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { isActiveSale } from '@/lib/analytics'
import { contactIdsDeScope, type ScopeColaborador } from '@/lib/collaborators/scope'
import { interpretarRespuestaFuturas, type FilaFutura } from '@/lib/commissions/future-response'
import { CommissionMonthlyStatement } from '@/components/commissions/CommissionMonthlyStatement'
import { CommissionInvoicePanel } from '@/components/commissions/CommissionInvoicePanel'
import { construirResumenMensual } from '@/lib/commissions/mensual'
import type { CommissionDashboardRow } from '@/lib/commissions/dashboard'
import { SelectorMes } from '@/components/collaborators/SelectorMes'
import { useMesColaborador } from '@/components/collaborators/useMesColaborador'
import {
  ClientesConImpago,
  EmbudoAgendas,
  GraficoMeses,
  PrevisionPanel,
  RegistroMeses,
  type ImpagoVista,
} from '@/components/collaborators/PanelVisual'
import {
  embudoDelMes,
  historialMensual,
  previsionFutura,
  serieMensual,
  totalGenerado,
  type CitaPanel,
  type EstadoImpago,
  type FacturaMes,
  type VentaPanel,
} from '@/lib/collaborators/panel'
import { openSignedStorageFile } from '@/lib/storage/signed-url'
import { useTenant, useTenantId, type SesionTenant } from '@/lib/tenant-context'

// `.in()` con muchos UUID revienta el límite de URL de PostgREST: se lee en lotes.
const LOTE = 60
async function enLotes<T>(
  ids: string[],
  leer: (lote: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
) {
  const filas: T[] = []
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await leer(ids.slice(i, i + LOTE))
    if (error) throw new Error(error.message)
    filas.push(...(data ?? []))
  }
  return filas
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
  const [mes, setMes] = useMesColaborador(tenant)

  const [citas, setCitas] = useState<CitaPanel[]>([])
  const [ventas, setVentas] = useState<VentaPanel[]>([])
  const [comisiones, setComisiones] = useState<CommissionDashboardRow[]>([])
  const [facturas, setFacturas] = useState<FacturaMes[]>([])
  const [futuras, setFuturas] = useState<FilaFutura[]>([])
  // UN ERROR DE CARGA NO ES UN ESTADO VACÍO: la previsión no se pinta a 0 si /commissions/future falla.
  const [futurasError, setFuturasError] = useState<string | null>(null)
  const [estados, setEstados] = useState<Record<string, EstadoImpago>>({})
  const [consultandoStripe, setConsultandoStripe] = useState(false)
  const [sinContactos, setSinContactos] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargarFacturas = useCallback(async () => {
    const { data } = await sb
      .from('commission_invoices')
      .select('id, period_month, invoice_url, amount, status')
      .eq('tenant_id', tenantId)
      .eq('user_id', sesion.userId)
      .order('period_month', { ascending: false })
    setFacturas(
      ((data ?? []) as FacturaMes[]).map((f) => ({ ...f, amount: f.amount == null ? null : Number(f.amount) }))
    )
  }, [sb, tenantId, sesion.userId])

  const cargarFuturas = useCallback(async () => {
    setFuturasError(null)
    try {
      const res = interpretarRespuestaFuturas(
        await fetch(`/api/${tenant}/evergreen/commissions/future`).then((r) => r.json())
      )
      if ('rows' in res) setFuturas(res.rows)
      else setFuturasError(res.error)
    } catch {
      setFuturasError('no se pudo contactar con el servidor')
    }
  }, [tenant])

  // UNA carga por scope; el mes filtra en memoria (cambiar de mes no dispara refetch).
  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    ;(async () => {
      try {
        const contactIds = await contactIdsDeScope(sb, tenantId, scope)
        if (!vivo) return
        const hayContactos = !!contactIds && contactIds.length > 0
        setSinContactos(!hayContactos)

        const [citasData, ventasData, comData] = await Promise.all([
          hayContactos
            ? enLotes<CitaPanel>(contactIds!, (l) =>
                sb
                  .from('appointments')
                  .select('id, contact_id, appointment_datetime, status')
                  .eq('tenant_id', tenantId)
                  .in('contact_id', l)
              )
            : Promise.resolve([] as CitaPanel[]),
          hayContactos
            ? enLotes<VentaPanel>(contactIds!, (l) =>
                sb
                  .from('sales')
                  .select('id, contact_id, gross_amount, status, created_at')
                  .eq('tenant_id', tenantId)
                  .in('contact_id', l)
              )
            : Promise.resolve([] as VentaPanel[]),
          // Ledger del propio colaborador (user_id = él), con cliente y cobro de origen.
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
        if (comData.error) throw new Error(comData.error.message)
        setCitas(citasData)
        setVentas(ventasData)
        // D9 (docs/MONEY.md): quien tenga pays_commissions=false no comisiona, tampoco en lectura.
        setComisiones(
          ((comData.data ?? []) as unknown as CommissionDashboardRow[]).filter(
            (c) => (c.users as { pays_commissions?: boolean } | null)?.pays_commissions !== false
          )
        )
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : 'error desconocido')
      } finally {
        if (vivo) setCargando(false)
      }
      if (!vivo) return
      void cargarFacturas()
      void cargarFuturas()
    })()
    return () => {
      vivo = false
    }
  }, [sb, tenantId, scope, sesion.userId, cargarFacturas, cargarFuturas])

  // Cuotas vencidas sin cobrar (impagos), solo las que cuentan (no exentas D9).
  const vencidas = useMemo(
    () => futuras.filter((f) => f.estado === 'overdue' && !f.exento && f.source === 'installment'),
    [futuras]
  )
  const clavesVencidas = vencidas.map((f) => f.installmentId).join(',')

  // Estado en Stripe de cada impago (cobrado sin registrar / rechazado y por qué / sin intento).
  useEffect(() => {
    if (!clavesVencidas) {
      setEstados({})
      return
    }
    const ac = new AbortController()
    setConsultandoStripe(true)
    fetch(`/api/${tenant}/evergreen/commissions/impagos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installmentIds: clavesVencidas.split(',') }),
      signal: ac.signal,
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; estados?: Record<string, EstadoImpago> }) =>
        setEstados(d?.ok && d.estados ? d.estados : {})
      )
      .catch(() => {})
      .finally(() => {
        if (!ac.signal.aborted) setConsultandoStripe(false)
      })
    return () => ac.abort()
  }, [tenant, clavesVencidas])

  const impagos = useMemo<ImpagoVista[]>(
    () =>
      vencidas
        .map((f) => ({
          installmentId: f.installmentId,
          cliente: f.contact,
          vencimiento: f.dueDate,
          comision: f.amount,
          estado: estados[f.installmentId] ?? null,
        }))
        .sort((a, b) => a.vencimiento.localeCompare(b.vencimiento)),
    [vencidas, estados]
  )

  // Resumen mensual en base «cobro» (mes de la actividad), ya sin los impagos (van aparte).
  const meses = useMemo(
    () => construirResumenMensual(comisiones, futuras, comisiones, new Date(), { base: 'cobro', incluir: [mes] }),
    [comisiones, futuras, mes]
  )
  const historial = useMemo(() => historialMensual(meses, facturas), [meses, facturas])
  const total = useMemo(() => totalGenerado(historial), [historial])
  const prevision = useMemo(() => previsionFutura(meses), [meses])
  const serie = useMemo(() => serieMensual(meses), [meses])
  const embudo = useMemo(
    () => embudoDelMes(citas, ventas, mes, (v) => isActiveSale({ status: v.status ?? '' })),
    [citas, ventas, mes]
  )

  // Importe sugerido para la factura de cada mes: lo ya generado (sin previsión).
  const sugerenciasFactura = useMemo(() => {
    const out: Record<string, number> = {}
    for (const f of historial) if (f.generado > 0) out[f.month] = f.generado
    return out
  }, [historial])

  const abrirFactura = (ruta: string) =>
    openSignedStorageFile('facturas', ruta, (message) =>
      toast.error('No se pudo abrir la factura', { description: message })
    )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Mis comisiones</h1>
          <p className="text-sm text-muted-foreground">Tu código {scope.code}</p>
        </div>
        <SelectorMes value={mes} onChange={setMes} />
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400" role="alert">
          No se pudieron cargar tus datos: {error}
        </div>
      )}

      {sinContactos && !cargando && !error && (
        <div className="dashboard-card p-8 text-center">
          <p className="font-medium text-foreground">Aún no tienes contactos atribuidos</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Comparte tu código <span className="font-mono text-brand-300">{scope.code}</span>: todo contacto que llegue
            con él aparecerá aquí automáticamente.
          </p>
        </div>
      )}

      {/* 1. El mes elegido, grande: venta nueva vs recurrencia y de qué clientes viene. */}
      <CommissionMonthlyStatement
        personal
        base="cobro"
        mesElegido={mes}
        onMesChange={setMes}
        soloDetalle
        rows={comisiones}
        basis={comisiones}
        future={futuras}
        futureError={futurasError}
        loading={cargando}
        impagos={0}
        personas={[]}
        selectedMemberId="all"
        esEquipo={false}
        onSelectMember={() => {}}
        onRetryFuture={cargarFuturas}
      />

      {/* 2. Clientes con pagos pendientes, con su estado en Stripe (sustituye a «Ajustes y devoluciones»). */}
      <ClientesConImpago filas={impagos} cargando={consultandoStripe} />

      {/* 3. Su factura del mes elegido: se sube aquí, la lee la IA y llega a Gastos. */}
      <CommissionInvoicePanel
        currentUserId={sesion.userId}
        currentUserRole={sesion.rol ?? 'affiliate'}
        members={[{ id: sesion.userId, full_name: String(sesion.user.full_name ?? '') }]}
        sugerencias={sugerenciasFactura}
        mes={mes}
        onSubida={() => void cargarFacturas()}
      />

      {/* 4. Visión de conjunto: 12 meses + registro con facturas y total desde el inicio. */}
      <GraficoMeses serie={serie} mes={mes} onMes={setMes} />
      <RegistroMeses filas={historial} total={total} mes={mes} onMes={setMes} onAbrirFactura={abrirFactura} />

      {/* 5. Previsión, aparte de lo generado. */}
      <PrevisionPanel filas={prevision} error={futurasError} onReintentar={cargarFuturas} />

      {/* 6. Embudo del mes elegido, desde las agendas. */}
      <EmbudoAgendas embudo={embudo} mes={mes} cargando={cargando} />
    </div>
  )
}

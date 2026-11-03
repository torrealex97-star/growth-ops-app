'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FileText, Upload, Loader2, CheckCircle2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant, useTenantId } from '@/lib/tenant-context'
import { formatCurrency } from '@/lib/utils'
import { openSignedStorageFile } from '@/lib/storage/signed-url'

type SimpleMember = { id: string; full_name: string }

type CommissionInvoice = {
  id: string
  user_id: string
  period_month: string
  invoice_url: string | null
  amount: number | null
  status: string
  created_at: string
}

// Primer día del mes en formato YYYY-MM-DD.
function monthStart(year: number, monthIdx0: number): string {
  const m = String(monthIdx0 + 1).padStart(2, '0')
  return `${year}-${m}-01`
}

// Solo la inicial en mayúscula («Octubre de 2026»): el `capitalize` de CSS pondría también «De».
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function monthLabel(period: string): string {
  const d = new Date(period)
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}

// Últimos 6 meses (incluido el actual) como opciones de periodo.
function recentMonths(): { value: string; label: string }[] {
  const now = new Date()
  const out: { value: string; label: string }[] = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = monthStart(d.getFullYear(), d.getMonth())
    out.push({ value, label: monthLabel(value) })
  }
  return out
}

export function CommissionInvoicePanel({
  currentUserId,
  currentUserRole,
  members,
  focusUserId,
  sugerencias,
  mes,
  onSubida,
}: {
  currentUserId: string
  currentUserRole: string
  members: SimpleMember[]
  focusUserId?: string
  /** Importe sugerido por mes (clave YYYY-MM): lo ya generado de comisión ese mes, para no teclearlo. */
  sugerencias?: Record<string, number>
  /**
   * Mes (YYYY-MM) elegido en el selector ÚNICO de la pantalla. Si se pasa, el panel NO tiene selector propio: factura
   * ese mes. Sin él (p. ej. admin), mantiene su selector de «Mes facturado».
   */
  mes?: string
  /** Aviso al subir una factura con éxito (el padre refresca su registro). */
  onSubida?: () => void
}) {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const isAdmin = ['admin', 'director'].includes(currentUserRole)
  const months = useMemo(() => recentMonths(), [])
  // Por defecto, el mes anterior (el que se cierra el día 15).
  const defaultMonth = months[1]?.value ?? months[0]?.value ?? ''

  const [invoices, setInvoices] = useState<CommissionInvoice[]>([])
  // null = aún no comprobado; false = la tabla no existe todavía (migración v35 pendiente).
  const [available, setAvailable] = useState<boolean | null>(null)
  const [periodoPropio, setPeriod] = useState<string>(defaultMonth)
  const period = mes ? `${mes}-01` : periodoPropio
  const [amount, setAmount] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const memberName = (id: string) => members.find((m) => m.id === id)?.full_name ?? '—'

  const fetchInvoices = async () => {
    const supabase = createClient()
    // RLS: el comercial solo recibe las suyas; admin/director las de todos.
    const { data, error } = await supabase
      .from('commission_invoices')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('period_month', { ascending: false })
    if (error) {
      // Tabla inexistente (migración v35 pendiente) → ocultamos el panel.
      setAvailable(false)
      return
    }
    setAvailable(true)
    setInvoices((data as CommissionInvoice[]) ?? [])
  }

  useEffect(() => {
    fetchInvoices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  const myInvoiceForPeriod = invoices.find(
    (inv) => inv.user_id === currentUserId && inv.period_month.slice(0, 7) === period.slice(0, 7)
  )
  const focusedMember = focusUserId ? (members.find((member) => member.id === focusUserId) ?? null) : null
  const visibleTeamInvoices = focusUserId ? invoices.filter((invoice) => invoice.user_id === focusUserId) : invoices
  const showOwnUploader = !isAdmin || !focusUserId || focusUserId === currentUserId
  const misFacturas = invoices.filter((inv) => inv.user_id === currentUserId)
  const sugerido = sugerencias?.[period.slice(0, 7)]

  const openInvoice = (path: string) =>
    openSignedStorageFile('facturas', path, (message) =>
      toast.error('No se pudo abrir la factura', { description: message })
    )

  const handleUpload = async (file: File) => {
    if (!file) return
    // El importe es OPCIONAL: si lo dejas vacío lo lee la IA de la factura (igual que en Gastos); si lo escribes,
    // se contrasta con lo que dice la factura.
    const texto = amount.trim()
    const importe = texto ? parseFloat(texto.replace(',', '.')) : undefined
    if (importe !== undefined && (!Number.isFinite(importe) || importe <= 0)) {
      toast.error('El importe no es válido', { description: 'Debe ser mayor que 0, o déjalo vacío.' })
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setUploading(true)
    const supabase = createClient()
    try {
      const ext = file.name.split('.').pop() || 'pdf'
      const stamp = `${Date.now()}`
      // Prefijo tenant_id/: es lo que permite que una política de Storage compruebe pertenencia a
      // la subcuenta a partir de la propia ruta del objeto.
      const path = `${tenantId}/comisiones/${currentUserId}/${period.slice(0, 7)}-${stamp}.${ext}`
      const { error: upErr } = await supabase.storage.from('facturas').upload(path, file, { upsert: true })
      if (upErr) {
        toast.error('No se pudo subir la factura', { description: upErr.message })
        return
      }
      // El registro (factura + gasto en finanzas) lo hace el servidor: el colaborador no puede escribir en
      // Gastos, y así la factura queda en un solo paso tanto aquí como en la sección de gastos.
      const res = await fetch(`/api/${tenant}/evergreen/commissions/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, ...(importe !== undefined ? { amount: importe } : {}), path }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        importe?: number
        analizadaConIa?: boolean
        avisoIa?: string | null
      }
      if (!res.ok) {
        toast.error('No se pudo registrar la factura', { description: data.error })
        return
      }
      toast.success('Factura enviada', {
        description: data.analizadaConIa
          ? `Leída con IA${data.importe != null ? ` (${formatCurrency(data.importe)})` : ''}. Finanzas ya la tiene en Gastos.`
          : `Finanzas ya la tiene en Gastos${data.avisoIa ? ` (sin lectura automática: ${data.avisoIa})` : ''}.`,
      })
      setAmount('')
      if (fileRef.current) fileRef.current.value = ''
      fetchInvoices()
      onSubida?.()
    } finally {
      setUploading(false)
    }
  }

  const togglePaid = async (inv: CommissionInvoice) => {
    const supabase = createClient()
    const next = inv.status === 'pagada' ? 'recibida' : 'pagada'
    const { error } = await supabase
      .from('commission_invoices')
      .update({ status: next })
      .eq('id', inv.id)
      .eq('tenant_id', tenantId)
    if (error) {
      toast.error('No se pudo actualizar', { description: error.message })
      return
    }
    fetchInvoices()
  }

  if (available === false) return null

  return (
    <div className="space-y-4">
      {/* Panel del comercial: subir la factura del mes */}
      {showOwnUploader && (
        <div className="rounded-xl border border-border bg-card/50 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-brand-400" />
            <h3 className="text-sm font-semibold text-foreground">Mi factura de comisiones</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Adjunta tu factura del mes cerrado. Se analiza con IA y llega directamente al departamento financiero
            (aparece en Gastos); el resto del equipo no la ve.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Mes facturado</Label>
              {mes ? (
                <div className="flex h-9 items-center rounded-md border border-border bg-muted px-3 text-sm text-foreground">
                  {mayuscula(monthLabel(period))}
                  <span className="ml-2 text-xs text-muted-foreground">(se cambia arriba)</span>
                </div>
              ) : (
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Importe de tu factura (€) — opcional</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="bg-muted border-border"
              />
              {sugerido != null && sugerido > 0 && !amount.trim() && (
                <button
                  type="button"
                  onClick={() => setAmount(String(sugerido))}
                  className="text-xs text-brand-400 hover:text-brand-300"
                >
                  Usar {formatCurrency(sugerido)} (tus comisiones de ese mes)
                </button>
              )}
              {!amount.trim() && (
                <p className="text-xs text-muted-foreground">Si lo dejas vacío, lo lee la IA de la factura.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-xs">Archivo (PDF/imagen)</Label>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleUpload(f)
                }}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="w-full"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Subiendo y analizando…
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Adjuntar factura
                  </>
                )}
              </Button>
            </div>
          </div>

          {myInvoiceForPeriod && (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              Factura de {monthLabel(myInvoiceForPeriod.period_month)} enviada
              {myInvoiceForPeriod.status === 'pagada' && ' · pagada'}
              {myInvoiceForPeriod.invoice_url && (
                <button
                  type="button"
                  onClick={() => void openInvoice(myInvoiceForPeriod.invoice_url!)}
                  className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300 ml-2"
                >
                  Ver <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mis facturas, mes a mes (quien no administra no ve la tabla del equipo) */}
      {/* Con el selector único de mes, el registro de facturas vive en el historial del panel */}
      {!mes && showOwnUploader && !isAdmin && misFacturas.length > 0 && (
        <div className="rounded-xl border border-border bg-card/50 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Mis facturas</h3>
          <ul className="divide-y divide-border">
            {misFacturas.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="text-foreground">{mayuscula(monthLabel(inv.period_month))}</span>
                <span className="flex items-center gap-4">
                  <span className="tabular-nums text-foreground">{formatCurrency(inv.amount)}</span>
                  <span className={inv.status === 'pagada' ? 'text-emerald-400' : 'text-amber-400'}>
                    {inv.status === 'pagada' ? 'Pagada' : 'Recibida'}
                  </span>
                  {inv.invoice_url && (
                    <button
                      type="button"
                      onClick={() => void openInvoice(inv.invoice_url!)}
                      className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300"
                    >
                      Ver <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Panel admin/director: facturas de todo el equipo */}
      {isAdmin && (
        <div className="rounded-xl border border-border bg-card/50 p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {focusedMember ? `Facturas de ${focusedMember.full_name}` : 'Facturas de comisiones del equipo'}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">Evidencia documental por periodo y estado de pago.</p>
          </div>
          {visibleTeamInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {focusedMember ? 'Esta persona aún no ha subido facturas.' : 'Aún no hay facturas subidas.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3 font-medium">Miembro</th>
                    <th className="py-2 pr-3 font-medium">Mes</th>
                    <th className="py-2 pr-3 font-medium">Importe</th>
                    <th className="py-2 pr-3 font-medium">Estado</th>
                    <th className="py-2 pr-3 font-medium">Factura</th>
                    <th className="py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTeamInvoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 text-foreground">{memberName(inv.user_id)}</td>
                      <td className="py-2 pr-3 text-foreground">{monthLabel(inv.period_month)}</td>
                      <td className="py-2 pr-3 text-foreground">{formatCurrency(inv.amount)}</td>
                      <td className="py-2 pr-3">
                        <span className={inv.status === 'pagada' ? 'text-emerald-400' : 'text-amber-400'}>
                          {inv.status === 'pagada' ? 'Pagada' : 'Recibida'}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        {inv.invoice_url ? (
                          <button
                            type="button"
                            onClick={() => void openInvoice(inv.invoice_url!)}
                            className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300"
                          >
                            Ver <ExternalLink className="w-3 h-3" />
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => togglePaid(inv)}>
                          {inv.status === 'pagada' ? 'Marcar recibida' : 'Marcar pagada'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

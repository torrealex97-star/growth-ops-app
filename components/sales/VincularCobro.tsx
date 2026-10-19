'use client'

import { useState } from 'react'
import { Link2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SugerenciaContacto } from '@/lib/sales/identidad-pago'

type Resultado = { id: string; full_name: string | null; email: string | null }

/**
 * Cobro sin contacto: casi siempre es alguien que pagó con OTRO correo que el de la reunión. En vez de
 * mandar a CRM a editar el email a mano, se proponen candidatos (correo parecido, mismo nombre, llamada
 * reciente) y hay un buscador. Vincular recuerda el cliente de Stripe y el correo de pago, así que no hay
 * que repetirlo la próxima vez. Solo administración puede vincular (decide a quién se comisiona).
 */
export function VincularCobro({
  tenant,
  paymentId,
  pagador,
  sugerencias,
  puedeVincular,
  onVinculado,
}: {
  tenant: string
  paymentId: string
  pagador: string
  sugerencias: SugerenciaContacto[]
  puedeVincular: boolean
  onVinculado: () => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<Resultado[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [vinculando, setVinculando] = useState<string | null>(null)

  async function buscar() {
    setBuscando(true)
    try {
      const res = await fetch(
        `/api/${tenant}/evergreen/sales/payment-inbox?buscar=${encodeURIComponent(busqueda.trim())}`
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setResultados(body.resultados ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo buscar')
    } finally {
      setBuscando(false)
    }
  }

  async function vincular(contactId: string) {
    setVinculando(contactId)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/sales/payment-inbox/vincular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, contactId }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      toast.success('Cobro vinculado. La próxima vez que pague con este correo encajará solo.')
      onVinculado()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo vincular')
    } finally {
      setVinculando(null)
    }
  }

  if (!puedeVincular) {
    return (
      <p className="text-sm">
        Este cobro no encaja con ningún contacto. Pide a administración que lo vincule: el pago llegó desde{' '}
        <span className="text-foreground">{pagador}</span>.
      </p>
    )
  }

  const Fila = ({ id, nombre, detalle }: { id: string; nombre: string | null; detalle: string }) => (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-foreground truncate">{nombre ?? 'Sin nombre'}</p>
        <p className="text-xs text-muted-foreground">{detalle}</p>
      </div>
      <Button size="sm" variant="outline" disabled={vinculando !== null} onClick={() => vincular(id)}>
        <Link2 className="mr-1.5 h-3.5 w-3.5" />
        {vinculando === id ? 'Vinculando…' : 'Es esta persona'}
      </Button>
    </li>
  )

  return (
    <div className="space-y-4">
      <p className="text-sm">
        No hay un contacto con el correo <span className="text-foreground">{pagador}</span>. Suele ser alguien que pagó
        con otro correo que el de la reunión. Elige quién es y la app lo recordará para sus próximos pagos.
      </p>

      {sugerencias.length > 0 ? (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Posibles coincidencias</h4>
          <ul className="divide-y divide-border/60">
            {sugerencias.map((s) => (
              <Fila key={s.contactId} id={s.contactId} nombre={s.nombre} detalle={s.razones.join(' · ')} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No hay coincidencias claras: busca a la persona por nombre o email.
        </p>
      )}

      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Buscar a mano</h4>
        <form
          className="mt-1.5 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (busqueda.trim().length >= 3) void buscar()
          }}
        >
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre o email (mínimo 3 letras)"
            aria-label="Buscar contacto"
          />
          <Button type="submit" variant="outline" disabled={buscando || busqueda.trim().length < 3}>
            <Search className="mr-1.5 h-3.5 w-3.5" />
            Buscar
          </Button>
        </form>
        {resultados !== null &&
          (resultados.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Sin resultados.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {resultados.map((r) => (
                <Fila key={r.id} id={r.id} nombre={r.full_name} detalle={r.email ?? 'Sin email'} />
              ))}
            </ul>
          ))}
      </div>
    </div>
  )
}

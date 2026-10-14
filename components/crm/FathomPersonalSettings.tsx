'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Mic, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

type Estado = {
  conectada: boolean
  status: 'conectada' | 'error' | null
  ultimaSync: string | null
  ultimoError: string | null
  reunionesVistas: number
}

const fecha = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'

/**
 * Conexión PERSONAL de Fathom: cada closer pega SU clave y la app recupera SUS grabaciones y
 * transcripciones (Fathom graba Google Meet, Zoom y Teams). Se enlazan a la cita por contacto y hora; lo
 * dudoso va a la cola de revisión, nunca se asigna a ciegas.
 */
export function FathomPersonalSettings({ tenant }: { tenant: string }) {
  const [open, setOpen] = useState(false)
  const [estado, setEstado] = useState<Estado | null>(null)
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [clave, setClave] = useState('')
  const base = `/api/${tenant}/evergreen/fathom/mi-conexion`

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch(base, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'No se pudo leer la conexión')
      setEstado(j as Estado)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo leer la conexión de Fathom')
    } finally {
      setCargando(false)
    }
  }, [base])

  useEffect(() => {
    if (open) void cargar()
  }, [open, cargar])

  async function conectar() {
    setGuardando(true)
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: clave }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'No se pudo conectar')
      setClave('')
      setEstado(j as Estado)
      toast.success('Fathom conectado. Tus reuniones recientes ya se están importando.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo conectar Fathom')
    } finally {
      setGuardando(false)
    }
  }

  async function desconectar() {
    setGuardando(true)
    try {
      const res = await fetch(base, { method: 'DELETE' })
      if (!res.ok) throw new Error('No se pudo desconectar')
      setEstado(null)
      await cargar()
      toast.success('Fathom desconectado. Lo ya importado se conserva.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo desconectar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Mic className="h-4 w-4" aria-hidden="true" /> Mi Fathom
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Mi Fathom</SheetTitle>
          <SheetDescription>
            Conecta tu cuenta de Fathom (graba Google Meet, Zoom y Teams) para que tus llamadas aparezcan con su
            grabación, resumen y transcripción en cada cita.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {cargando && !estado ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando…
            </p>
          ) : estado?.conectada ? (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                <Check className="h-4 w-4" aria-hidden="true" /> Conectado
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Última sincronización</dt>
                <dd className="text-foreground">{fecha(estado.ultimaSync)}</dd>
                <dt className="text-muted-foreground">Reuniones revisadas</dt>
                <dd className="text-foreground">{estado.reunionesVistas}</dd>
              </dl>
              <Button variant="outline" size="sm" onClick={desconectar} disabled={guardando} className="gap-2">
                <Unplug className="h-4 w-4" aria-hidden="true" /> Desconectar
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {estado?.status === 'error' && (
                <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                  La última sincronización falló: {estado.ultimoError || 'error desconocido'}. Vuelve a pegar tu clave.
                </p>
              )}
              <label className="block text-sm font-medium text-foreground" htmlFor="fathom-clave">
                Clave de API de Fathom
              </label>
              <input
                id="fathom-clave"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                placeholder="Pégala aquí"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
              <p className="text-xs text-muted-foreground">
                La encuentras en Fathom › Settings › API Access. Se guarda cifrada y no se vuelve a mostrar.
              </p>
              <Button onClick={conectar} disabled={guardando || !clave.trim()} className="gap-2">
                {guardando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Conectar
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

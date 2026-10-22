'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ShieldAlert } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type Config = {
  activo: boolean
  permitirAutonomo: boolean
  maxSeguidosSinRespuesta: number
  maxEnviosDia: number
  horario: { desde: number; hasta: number; zona: string } | null
  repartoAutomatico: boolean
}
type Guion = {
  negocio: string
  tono: string
  pasos: { clave: string; objetivo: string; pregunta?: string }[]
  objeciones: { disparador: string; respuesta: string }[]
  enlaceAgenda: string | null
  hechosPermitidos: string[]
}

const campo = 'w-full rounded-lg border border-border bg-muted p-2 text-sm text-foreground'

export default function AgenteTab() {
  const tenant = useTenant()
  const [config, setConfig] = useState<Config | null>(null)
  const [guion, setGuion] = useState<Guion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [conHorario, setConHorario] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const res = await fetch(`/api/${tenant}/evergreen/conversaciones/agente`)
      const body = await res.json().catch(() => ({}))
      if (!vivo) return
      if (!res.ok) {
        setError(body.error ?? 'No se pudo cargar')
        return
      }
      setConfig(body.config)
      setGuion(body.guion)
      setConHorario(!!body.config.horario)
    })()
    return () => {
      vivo = false
    }
  }, [tenant])

  async function guardar() {
    if (!config || !guion) return
    setGuardando(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/conversaciones/agente`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          horario: conHorario ? (config.horario ?? { desde: 9, hasta: 21, zona: 'Europe/Madrid' }) : null,
          ...guion,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'No se pudo guardar')
      setConfig(body.config)
      setGuion(body.guion)
      toast.success('Configuración guardada')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (error) {
    return (
      <p role="alert" className="m-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
        {error}
      </p>
    )
  }
  if (!config || !guion) return <Skeleton className="m-6 h-96" />

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Agente de IA de setting</h2>
        <p className="text-sm text-muted-foreground">
          Responde por Instagram a los leads que escriben, cualifica con tu guion y pasa a una persona cuando hace
          falta.
        </p>
      </div>

      <section className="space-y-3 rounded-lg border border-border p-4" aria-label="Interruptores">
        <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-400">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          La IA nunca da precios, descuentos ni condiciones, nunca pide datos de pago, solo envía el enlace de agenda de
          abajo y solo responde dentro de las 24 h desde el último mensaje del lead. Si duda, pasa a una persona.
          Empieza en «borrador».
        </p>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={config.activo}
            onChange={(e) => setConfig({ ...config, activo: e.target.checked })}
          />
          Agente activo en esta subcuenta (apagado = no hace nada)
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={config.permitirAutonomo}
            onChange={(e) => setConfig({ ...config, permitirAutonomo: e.target.checked })}
          />
          Permitir modo autónomo (si no, siempre propone borradores para aprobar)
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={config.repartoAutomatico}
            onChange={(e) => setConfig({ ...config, repartoAutomatico: e.target.checked })}
          />
          Repartir automáticamente las conversaciones sin responsable entre los setters (round-robin)
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            Máximo de mensajes seguidos sin respuesta del lead
            <input
              type="number"
              min={1}
              max={5}
              value={config.maxSeguidosSinRespuesta}
              onChange={(e) => setConfig({ ...config, maxSeguidosSinRespuesta: Number(e.target.value) })}
              className={campo}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Máximo de envíos de la IA por día
            <input
              type="number"
              min={1}
              max={2000}
              value={config.maxEnviosDia}
              onChange={(e) => setConfig({ ...config, maxEnviosDia: Number(e.target.value) })}
              className={campo}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={conHorario} onChange={(e) => setConHorario(e.target.checked)} />
          Limitar a un horario de atención (hora de Madrid)
        </label>
        {conHorario ? (
          <div className="grid grid-cols-2 gap-3">
            {(['desde', 'hasta'] as const).map((k) => (
              <label key={k} className="text-xs text-muted-foreground capitalize">
                {k} (hora, 0-24)
                <input
                  type="number"
                  min={0}
                  max={24}
                  value={config.horario?.[k] ?? (k === 'desde' ? 9 : 21)}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      horario: {
                        desde: 9,
                        hasta: 21,
                        zona: 'Europe/Madrid',
                        ...config.horario,
                        [k]: Number(e.target.value),
                      },
                    })
                  }
                  className={campo}
                />
              </label>
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4" aria-label="Guion">
        <h2 className="text-sm font-semibold text-foreground">Guion</h2>
        <label className="block text-xs text-muted-foreground">
          Nombre del negocio
          <input
            value={guion.negocio}
            onChange={(e) => setGuion({ ...guion, negocio: e.target.value })}
            className={campo}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Tono
          <input value={guion.tono} onChange={(e) => setGuion({ ...guion, tono: e.target.value })} className={campo} />
        </label>
        <label className="block text-xs text-muted-foreground">
          Enlace de agenda (https). Es el ÚNICO enlace que la IA puede enviar
          <input
            value={guion.enlaceAgenda ?? ''}
            onChange={(e) => setGuion({ ...guion, enlaceAgenda: e.target.value || null })}
            placeholder="https://…"
            className={campo}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Qué quieres averiguar, un paso por línea con el formato «clave: objetivo» (p. ej. «ingresos: sus ingresos
          mensuales»)
          <textarea
            rows={4}
            value={guion.pasos.map((p) => `${p.clave}: ${p.objetivo}`).join('\n')}
            onChange={(e) =>
              setGuion({
                ...guion,
                pasos: e.target.value
                  .split('\n')
                  .map((l) => l.split(':'))
                  .filter((p) => p.length >= 2 && p[0].trim())
                  .map((p) => ({
                    clave: p[0].trim().toLowerCase().replace(/\s+/g, '_'),
                    objetivo: p.slice(1).join(':').trim(),
                  })),
              })
            }
            className={campo}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Objeciones, una por línea con el formato «cuando diga → qué responder»
          <textarea
            rows={3}
            value={guion.objeciones.map((o) => `${o.disparador} → ${o.respuesta}`).join('\n')}
            onChange={(e) =>
              setGuion({
                ...guion,
                objeciones: e.target.value
                  .split('\n')
                  .map((l) => l.split('→'))
                  .filter((p) => p.length >= 2 && p[0].trim())
                  .map((p) => ({ disparador: p[0].trim(), respuesta: p.slice(1).join('→').trim() })),
              })
            }
            className={campo}
          />
        </label>
        <label className="block text-xs text-muted-foreground">
          Hechos que puede repetir (uno por línea; sin precios)
          <textarea
            rows={3}
            value={guion.hechosPermitidos.join('\n')}
            onChange={(e) =>
              setGuion({
                ...guion,
                hechosPermitidos: e.target.value
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean),
              })
            }
            className={campo}
          />
        </label>
      </section>

      <Button onClick={guardar} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </Button>
    </div>
  )
}

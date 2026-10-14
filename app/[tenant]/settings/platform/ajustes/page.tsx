'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, KeyRound, TriangleAlert } from 'lucide-react'
import { EstadoPanel } from '@/components/ui/carga/EstadoPanel'
import { useSesion, useTenant } from '@/lib/tenant-context'

type Ajuste = {
  key: string
  label: string
  descripcion: string
  secret: boolean
  configurado: boolean
  origen: 'plataforma' | 'entorno' | 'ninguno'
  valor: string | null
  actualizado: string | null
  indescifrable: boolean
}
type Estado = { ajustes: Ajuste[]; tablaDisponible: boolean; googleRedirectUri: string }

const ORIGEN: Record<Ajuste['origen'], string> = {
  plataforma: 'Guardado aquí',
  entorno: 'Variable de entorno (Vercel)',
  ninguno: 'Sin configurar',
}

export default function AjustesGlobalesPage() {
  const tenant = useTenant()
  const sesion = useSesion()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setError(null)
    const res = await fetch(`/api/${tenant}/evergreen/platform/settings`, { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(j.error || 'No se pudieron leer los ajustes')
      return
    }
    setEstado(j as Estado)
  }, [tenant])

  useEffect(() => {
    if (sesion?.isSuperAdmin) void cargar()
  }, [sesion?.isSuperAdmin, cargar])

  async function enviar(key: string, action: 'guardar' | 'borrar') {
    setGuardando(key)
    setAviso(null)
    setError(null)
    const res = await fetch(`/api/${tenant}/evergreen/platform/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, action, value: valores[key] ?? '' }),
    })
    const j = await res.json().catch(() => ({}))
    setGuardando(null)
    if (!res.ok) {
      setError(j.error || 'No se pudo guardar')
      return
    }
    setValores((v) => ({ ...v, [key]: '' }))
    setAviso(action === 'borrar' ? 'Ajuste eliminado.' : 'Guardado. Ya está en uso, sin redesplegar.')
    await cargar()
  }

  if (!sesion) return <EstadoPanel estado="cargando" que="los ajustes globales" filasSkeleton={3} />
  if (!sesion.isSuperAdmin) return <EstadoPanel estado="sin_permiso" que="los ajustes globales de plataforma" />

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          href={`/${tenant}/settings/platform`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver al control de plataforma
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Ajustes globales</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Credenciales que usa toda la plataforma, no una subcuenta. Los secretos se guardan cifrados y no se vuelven a
          mostrar; guardar uno nuevo sustituye al anterior al instante, sin tocar Vercel.
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
      {aviso && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {aviso}
        </p>
      )}
      {estado && !estado.tablaDisponible && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
          La tabla de ajustes globales aún no existe en la base de datos (migración pendiente). Mientras tanto se usan
          las variables de entorno.
        </p>
      )}

      {!estado ? (
        <EstadoPanel estado="cargando" que="los ajustes" filasSkeleton={3} />
      ) : (
        <div className="space-y-4">
          {estado.ajustes.map((a) => (
            <section key={a.key} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 font-medium text-foreground">
                    <KeyRound className="h-4 w-4 text-brand-400" aria-hidden="true" /> {a.label}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">{a.descripcion}</p>
                  <p className="mt-1 text-2xs text-muted-foreground">
                    <code>{a.key}</code>
                  </p>
                </div>
                <span
                  className={`rounded px-2 py-1 text-2xs font-semibold uppercase tracking-wide ${
                    a.configurado ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                  }`}
                >
                  {a.configurado ? `Configurado · ${ORIGEN[a.origen]}` : 'Sin configurar'}
                </span>
              </div>
              {a.indescifrable && (
                <p className="mt-2 text-sm text-red-400">
                  El valor guardado no se puede descifrar con la llave actual: vuelve a guardarlo.
                </p>
              )}
              {!a.secret && a.valor && (
                <p className="mt-2 break-all text-sm text-foreground">
                  Valor actual: <code>{a.valor}</code>
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type={a.secret ? 'password' : 'text'}
                  autoComplete="off"
                  spellCheck={false}
                  value={valores[a.key] ?? ''}
                  onChange={(e) => setValores((v) => ({ ...v, [a.key]: e.target.value }))}
                  placeholder={
                    a.secret
                      ? a.configurado
                        ? '•••••••• (pega uno nuevo para cambiarlo)'
                        : 'Pega el secreto'
                      : 'Pega el valor'
                  }
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  aria-label={a.label}
                />
                <button
                  type="button"
                  disabled={guardando === a.key || !(valores[a.key] ?? '').trim()}
                  onClick={() => enviar(a.key, 'guardar')}
                  className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {guardando === a.key ? 'Guardando…' : 'Guardar'}
                </button>
                {a.origen === 'plataforma' && (
                  <button
                    type="button"
                    disabled={guardando === a.key}
                    onClick={() => enviar(a.key, 'borrar')}
                    className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    Quitar
                  </button>
                )}
              </div>
              {a.key === 'GOOGLE_OAUTH_CLIENT_ID' && (
                <p className="mt-3 text-sm text-muted-foreground">
                  URI de redirección autorizada que debes registrar en Google Cloud:{' '}
                  <code className="break-all text-foreground">{estado.googleRedirectUri}</code>
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

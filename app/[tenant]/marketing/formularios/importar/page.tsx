'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { PropuestaFormulario, type Propuesta } from '@/components/forms/PropuestaFormulario'
import { SearchBox, normalizeText } from '@/components/ui/search-box'

// IMPORTAR UN FORMULARIO DE TYPEFORM / CALENDLY / GOHIGHLEVEL con la credencial ya conectada en Integraciones.
// Tres pasos: de dónde → cuál → vista previa y crear (borrador). Ver lib/forms/importar.ts.

type Fuente = { id: string; nombre: string; elemento: string; nota: string; conectada: boolean }
type Item = { id: string; nombre: string; detalle?: string }

export default function ImportarFormularioPage() {
  const tenant = useTenant()
  const api = `/api/${tenant}/evergreen/forms/import`
  const [fuentes, setFuentes] = useState<Fuente[] | null>(null)
  const [fuente, setFuente] = useState<Fuente | null>(null)
  const [items, setItems] = useState<Item[] | null>(null)
  const [q, setQ] = useState('')
  const [importando, setImportando] = useState<string | null>(null)
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const ctl = new AbortController()
    fetch(api, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudieron cargar los orígenes')
        setFuentes(j.fuentes)
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      })
    return () => ctl.abort()
  }, [api])

  // Lista de lo importable de la fuente elegida (se cancela si se cambia de fuente o se sale).
  useEffect(() => {
    if (!fuente) return
    const ctl = new AbortController()
    fetch(`${api}?source=${fuente.id}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudo leer el origen')
        setItems(j.items)
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      })
    return () => ctl.abort()
  }, [api, fuente])

  const elegir = (f: Fuente) => {
    setError('')
    setItems(null)
    setQ('')
    setPropuesta(null)
    setFuente(f)
  }
  const volver = () => {
    setError('')
    if (propuesta) return setPropuesta(null)
    setFuente(null)
    setItems(null)
  }
  const importar = async (item: Item) => {
    if (!fuente) return
    setError('')
    setImportando(item.id)
    try {
      const r = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: fuente.id, id: item.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudo importar')
      setPropuesta(j)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setImportando(null)
    }
  }

  const nq = normalizeText(q.trim())
  const visibles = (items ?? []).filter((i) => !nq || normalizeText(`${i.nombre} ${i.detalle ?? ''}`).includes(nq))

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Importar formulario</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trae un formulario que ya tienes en otra herramienta. Se copia aquí como borrador; en la herramienta de origen
          no se toca nada.
        </p>
      </div>

      {fuente && (
        <button
          type="button"
          onClick={volver}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {propuesta ? `Elegir otro ${fuente.elemento}` : 'Elegir otro origen'}
        </button>
      )}
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {!fuente && !fuentes && !error && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      )}
      {!fuente && fuentes && (
        <div className="grid gap-4 sm:grid-cols-3">
          {fuentes.map((f) => (
            <div key={f.id} className="flex flex-col rounded-xl border border-border bg-card p-5">
              <h2 className="font-semibold text-foreground">{f.nombre}</h2>
              <p className="mt-2 flex-1 text-xs text-muted-foreground">{f.nota}</p>
              {f.conectada ? (
                <button
                  type="button"
                  onClick={() => elegir(f)}
                  className="mt-4 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500"
                >
                  Elegir {f.elemento}
                </button>
              ) : (
                <Link
                  href={`/${tenant}/settings/integraciones`}
                  className="mt-4 rounded-md border border-border px-3 py-2 text-center text-sm text-foreground hover:border-brand-500"
                >
                  Conectar {f.nombre}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {fuente && !propuesta && (
        <div className="space-y-3">
          {!items && !error && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Leyendo {fuente.nombre}…
            </p>
          )}
          {items && items.length === 0 && (
            <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {fuente.nombre} no devuelve ningún {fuente.elemento} con esta credencial.
            </p>
          )}
          {items && items.length > 0 && (
            <>
              {items.length > 8 && <SearchBox value={q} onChange={setQ} placeholder={`Buscar ${fuente.elemento}…`} />}
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {visibles.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{i.nombre}</p>
                      {i.detalle && <p className="truncate text-xs text-muted-foreground">{i.detalle}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void importar(i)}
                      disabled={importando !== null}
                      className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:border-brand-500 disabled:opacity-50"
                    >
                      {importando === i.id && <Loader2 className="h-4 w-4 animate-spin" />} Importar
                    </button>
                  </li>
                ))}
                {visibles.length === 0 && (
                  <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nada coincide con la búsqueda</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}

      {propuesta && (
        <PropuestaFormulario propuesta={propuesta} onNombre={(name) => setPropuesta({ ...propuesta, name })} />
      )}

      <p className="text-xs text-muted-foreground">
        ¿Está en otra herramienta? Copia sus preguntas y pégalas en{' '}
        <Link href={`/${tenant}/marketing/formularios/crear-ia`} className="text-brand-400 hover:text-brand-300">
          Crear con IA
        </Link>
        : las monta igual.
      </p>
    </div>
  )
}

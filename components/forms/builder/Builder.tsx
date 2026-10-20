'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  GitBranch,
  Loader2,
  Plus,
  Redo2,
  Rocket,
  Save,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Undo2,
  Flag,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { validateConfig } from '@/lib/forms/validation'
import {
  FIELD_TYPES,
  FORM_AUDIENCES,
  FORM_CATEGORIES,
  type Ending,
  type FieldType,
  type FormConfig,
  type Question,
} from '@/lib/forms/types'
import { FormEngine } from '../engine/FormEngine'
import { EndingPanel, LogicPanel, QuestionPanel, ScoringPanel, TYPE_LABELS, WelcomePanel, field } from './Panels'

type Sel =
  | { kind: 'welcome' }
  | { kind: 'question'; id: string }
  | { kind: 'ending'; id: string }
  | { kind: 'logic' }
  | { kind: 'scoring' }
  | { kind: 'settings' }

interface FormMeta {
  id: string
  slug: string
  name: string
  category: string
  audience: string
  status: string
  settings: { closeAt?: string; maxResponses?: number }
}

const CATEGORY_LABELS: Record<string, string> = {
  cualificacion_cliente: 'Cualificación de clientes',
  captacion: 'Captación',
  empleado_setter: 'Empleados · Setter',
  empleado_closer: 'Empleados · Closer',
  empleado_media_buyer: 'Empleados · Media buyer',
  feedback_clase: 'Feedback de clase',
  feedback_modulo: 'Feedback de módulo',
  feedback_cliente: 'Feedback de cliente',
  otro: 'Otro',
}
const AUDIENCE_LABELS: Record<string, string> = {
  captacion: 'Captación',
  cualificacion: 'Cualificación',
  empleados: 'Empleados',
  alumnos: 'Alumnos y clientes',
}

const newId = (prefix: string, used: string[]) => {
  let n = used.length + 1
  while (used.includes(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

export function Builder({ tenant, formId }: { tenant: string; formId: string }) {
  const api = `/api/${tenant}/evergreen/forms/${formId}`
  const [meta, setMeta] = useState<FormMeta | null>(null)
  const [cfg, setCfg] = useState<FormConfig | null>(null)
  const [sel, setSel] = useState<Sel>({ kind: 'welcome' })
  const [canWrite, setCanWrite] = useState(false)
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [device, setDevice] = useState<'mobile' | 'desktop'>('desktop')
  const [previewKey, setPreviewKey] = useState(0)
  const [error, setError] = useState('')
  const past = useRef<FormConfig[]>([])
  const future = useRef<FormConfig[]>([])
  const [history, setHistory] = useState({ undo: 0, redo: 0 })
  const syncHistory = () => setHistory({ undo: past.current.length, redo: future.current.length })

  useEffect(() => {
    const ctl = new AbortController()
    fetch(api, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudo cargar')
        setMeta({ ...j.form, settings: j.form.settings ?? {} })
        setCfg(j.form.draft_config as FormConfig)
        setCanWrite(!!j.canWrite)
        setPublishedVersion(j.publishedVersion ?? null)
      })
      .catch((e: Error) => e.name !== 'AbortError' && setError(e.message))
    return () => ctl.abort()
  }, [api])

  const commit = useCallback((next: FormConfig) => {
    setCfg((cur) => {
      if (cur) {
        past.current = [...past.current.slice(-49), cur]
        future.current = []
        setHistory({ undo: past.current.length, redo: 0 })
      }
      return next
    })
    setDirty(true)
  }, [])
  const undo = () => {
    const prev = past.current.pop()
    if (!prev || !cfg) return
    future.current.push(cfg)
    setCfg(prev)
    setDirty(true)
    syncHistory()
  }
  const redo = () => {
    const nxt = future.current.pop()
    if (!nxt || !cfg) return
    past.current.push(cfg)
    setCfg(nxt)
    setDirty(true)
    syncHistory()
  }

  const save = useCallback(
    async (silent = false) => {
      if (!cfg || !meta || !canWrite) return false
      setSaving(true)
      try {
        const r = await fetch(api, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: meta.name,
            category: meta.category,
            audience: meta.audience,
            draft_config: cfg,
            settings: { closeAt: meta.settings.closeAt || null, maxResponses: meta.settings.maxResponses || null },
          }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          toast.error(j.error || 'No se pudo guardar', {
            description: Array.isArray(j.detail) ? j.detail.join(' · ') : undefined,
          })
          return false
        }
        setDirty(false)
        if (!silent) toast.success('Borrador guardado')
        return true
      } finally {
        setSaving(false)
      }
    },
    [api, cfg, meta, canWrite]
  )

  // Autoguardado del borrador (no publica nada).
  useEffect(() => {
    if (!dirty || !canWrite) return
    const t = setTimeout(() => void save(true), 2000)
    return () => clearTimeout(t)
  }, [dirty, save, canWrite])

  const publish = async () => {
    if (!cfg) return
    const local = validateConfig(cfg)
    setProblems(local)
    if (local.length) return toast.error('Corrige los problemas antes de publicar')
    if (!(await save(true))) return
    setPublishing(true)
    try {
      const r = await fetch(`${api}/publish`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setProblems(j.problems ?? [])
        return toast.error(j.error || 'No se pudo publicar')
      }
      setPublishedVersion(j.version)
      setMeta((m) => (m ? { ...m, status: 'published' } : m))
      toast.success(`Publicado (versión ${j.version})`)
    } finally {
      setPublishing(false)
    }
  }

  const screens = useMemo(() => (cfg ? cfg.questions : []), [cfg])
  // El preview se reinicia con un retraso para no parpadear a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setPreviewKey((k) => k + 1), 600)
    return () => clearTimeout(t)
  }, [cfg])

  if (error) return <p className="text-sm text-red-500">{error}</p>
  if (!cfg || !meta)
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    )

  const ids = [...cfg.questions.map((q) => q.id), ...cfg.endings.map((e) => e.id)]
  const patchQ = (id: string, q: Question) =>
    commit({ ...cfg, questions: cfg.questions.map((x) => (x.id === id ? q : x)) })
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= cfg.questions.length) return
    const qs = [...cfg.questions]
    ;[qs[i], qs[j]] = [qs[j], qs[i]]
    commit({ ...cfg, questions: qs })
  }
  const addQuestion = (type: FieldType) => {
    const q: Question = {
      id: newId('pregunta', ids),
      type,
      title: type === 'hidden' ? '' : TYPE_LABELS[type],
      required: false,
    }
    if (['singleChoice', 'multiChoice', 'dropdown'].includes(type))
      q.options = [
        { value: 'opcion-1', label: 'Opción 1' },
        { value: 'opcion-2', label: 'Opción 2' },
      ]
    if (type === 'rating') q.scaleMax = 5
    if (type === 'hidden') q.hiddenKey = 'parametro'
    commit({ ...cfg, questions: [...cfg.questions, q] })
    setSel({ kind: 'question', id: q.id })
  }
  const dup = (q: Question) => {
    const c: Question = { ...q, id: newId('pregunta', ids) }
    const i = cfg.questions.findIndex((x) => x.id === q.id)
    commit({ ...cfg, questions: [...cfg.questions.slice(0, i + 1), c, ...cfg.questions.slice(i + 1)] })
    setSel({ kind: 'question', id: c.id })
  }
  const removeQ = (id: string) => {
    commit({
      ...cfg,
      questions: cfg.questions.filter((q) => q.id !== id),
      logic: cfg.logic.filter((r) => r.from !== id && !(r.then.type === 'jump' && r.then.target === id)),
    })
    setSel({ kind: 'welcome' })
  }
  const addEnding = () => {
    const e: Ending = { id: newId('final', ids), title: 'Gracias', message: '' }
    commit({ ...cfg, endings: [...cfg.endings, e] })
    setSel({ kind: 'ending', id: e.id })
  }
  const removeEnding = (id: string) => {
    if (cfg.endings.length <= 1) return toast.error('Debe quedar al menos un final')
    commit({
      ...cfg,
      endings: cfg.endings.filter((e) => e.id !== id),
      logic: cfg.logic.filter(
        (r) => !(r.then.type === 'end' && r.then.endingId === id) && !(r.then.type === 'jump' && r.then.target === id)
      ),
    })
    setSel({ kind: 'welcome' })
  }

  const selectedQ = sel.kind === 'question' ? cfg.questions.find((q) => q.id === sel.id) : undefined
  const selectedE = sel.kind === 'ending' ? cfg.endings.find((e) => e.id === sel.id) : undefined
  const item = (active: boolean) =>
    cn(
      'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
      active ? 'border-brand-500 bg-brand-500/10' : 'border-border hover:border-brand-500/50'
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className={cn(field, 'max-w-sm text-base font-semibold')}
          value={meta.name}
          maxLength={160}
          disabled={!canWrite}
          onChange={(e) => {
            setMeta({ ...meta, name: e.target.value })
            setDirty(true)
          }}
          aria-label="Nombre del formulario"
        />
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium',
            meta.status === 'published'
              ? 'bg-emerald-500/15 text-emerald-400'
              : meta.status === 'archived'
                ? 'bg-muted text-muted-foreground'
                : 'bg-amber-500/15 text-amber-400'
          )}
        >
          {meta.status === 'published'
            ? `Publicado v${publishedVersion ?? ''}`
            : meta.status === 'archived'
              ? 'Archivado'
              : 'Borrador'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={!history.undo}
            className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Deshacer"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!history.redo}
            className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
            aria-label="Rehacer"
          >
            <Redo2 className="h-4 w-4" />
          </button>
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !dirty}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:border-brand-500 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{' '}
                {dirty ? 'Guardar' : 'Guardado'}
              </button>
              <button
                type="button"
                onClick={() => void publish()}
                disabled={publishing}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Publicar
              </button>
            </>
          )}
        </div>
      </div>
      {!canWrite && (
        <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          Tu rol solo permite ver este formulario.
        </p>
      )}
      {problems.length > 0 && (
        <ul className="list-disc space-y-1 rounded-lg border border-red-500/40 bg-red-500/5 p-3 pl-7 text-sm text-red-400">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        {/* Esquema */}
        <div className="space-y-2">
          <button type="button" className={item(sel.kind === 'welcome')} onClick={() => setSel({ kind: 'welcome' })}>
            <Sparkles className="h-4 w-4 text-brand-400" /> Bienvenida
          </button>
          <div className="space-y-1.5">
            {cfg.questions.map((q, i) => (
              <div
                key={q.id}
                className={item(sel.kind === 'question' && sel.id === q.id)}
                onClick={() => setSel({ kind: 'question', id: q.id })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSel({ kind: 'question', id: q.id })}
              >
                <span className="w-5 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  {q.title || TYPE_LABELS[q.type]}
                  <span className="block text-2xs text-muted-foreground">{TYPE_LABELS[q.type]}</span>
                </span>
                {canWrite && sel.kind === 'question' && sel.id === q.id && (
                  <span className="flex shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      aria-label="Subir"
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      aria-label="Bajar"
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => dup(q)}
                      aria-label="Duplicar"
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeQ(q.id)}
                      aria-label="Eliminar"
                      className="p-1 text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
          {canWrite && (
            <select
              className={field}
              value=""
              onChange={(e) => e.target.value && addQuestion(e.target.value as FieldType)}
              aria-label="Añadir pregunta"
            >
              <option value="">+ Añadir pregunta…</option>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
          <div className="space-y-1.5 pt-2">
            {cfg.endings.map((e) => (
              <div
                key={e.id}
                className={item(sel.kind === 'ending' && sel.id === e.id)}
                onClick={() => setSel({ kind: 'ending', id: e.id })}
                role="button"
                tabIndex={0}
                onKeyDown={(ev) => ev.key === 'Enter' && setSel({ kind: 'ending', id: e.id })}
              >
                <Flag className="h-4 w-4 shrink-0 text-brand-400" />
                <span className="min-w-0 flex-1 truncate">
                  {e.title || e.id}
                  <span className="block text-2xs text-muted-foreground">
                    {e.when ? 'Condicional' : e.isDefault ? 'Por defecto' : 'Final'}
                    {e.redirectUrl ? ' · redirige' : ''}
                  </span>
                </span>
                {canWrite && sel.kind === 'ending' && sel.id === e.id && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      removeEnding(e.id)
                    }}
                    aria-label="Eliminar final"
                    className="p-1 text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {canWrite && (
              <button
                type="button"
                onClick={addEnding}
                className="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> Añadir final
              </button>
            )}
          </div>
          <div className="space-y-1.5 border-t border-border pt-3">
            <button type="button" className={item(sel.kind === 'logic')} onClick={() => setSel({ kind: 'logic' })}>
              <GitBranch className="h-4 w-4 text-brand-400" /> Lógica y saltos{' '}
              <span className="ml-auto text-xs text-muted-foreground">{cfg.logic.length}</span>
            </button>
            <button type="button" className={item(sel.kind === 'scoring')} onClick={() => setSel({ kind: 'scoring' })}>
              <Target className="h-4 w-4 text-brand-400" /> Puntuación{' '}
              <span className="ml-auto text-xs text-muted-foreground">{cfg.scoring?.enabled ? 'activa' : 'off'}</span>
            </button>
            <button
              type="button"
              className={item(sel.kind === 'settings')}
              onClick={() => setSel({ kind: 'settings' })}
            >
              <Settings2 className="h-4 w-4 text-brand-400" /> Ajustes
            </button>
          </div>
        </div>

        {/* Vista previa */}
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" /> Vista previa (no envía nada)
            </span>
            <div className="inline-flex rounded-md border border-border p-0.5">
              {(['desktop', 'mobile'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDevice(d)}
                  className={cn('rounded px-2 py-1', device === d && 'bg-brand-500/15 text-foreground')}
                >
                  {d === 'desktop' ? 'Escritorio' : 'Móvil'}
                </button>
              ))}
            </div>
          </div>
          <div
            className={cn(
              'mx-auto overflow-hidden rounded-2xl border border-border shadow-sm',
              device === 'mobile' ? 'max-w-[390px]' : 'w-full'
            )}
          >
            <FormEngine
              key={previewKey}
              config={cfg}
              name={meta.name}
              tenant={tenant}
              slug={meta.slug}
              mode="preview"
            />
          </div>
        </div>

        {/* Propiedades */}
        <aside
          className="rounded-xl border border-border bg-card p-4 lg:max-h-[80vh] lg:overflow-y-auto"
          aria-label="Propiedades"
        >
          <fieldset disabled={!canWrite} className="min-w-0 border-0 p-0">
            {sel.kind === 'welcome' && <WelcomePanel cfg={cfg} onChange={(p) => commit({ ...cfg, ...p })} />}
            {sel.kind === 'question' && selectedQ && (
              <QuestionPanel q={selectedQ} all={screens} onChange={(q) => patchQ(selectedQ.id, q)} />
            )}
            {sel.kind === 'ending' && selectedE && (
              <EndingPanel
                e={selectedE}
                all={screens}
                onChange={(e) => commit({ ...cfg, endings: cfg.endings.map((x) => (x.id === e.id ? e : x)) })}
              />
            )}
            {sel.kind === 'logic' && <LogicPanel cfg={cfg} onChange={(logic) => commit({ ...cfg, logic })} />}
            {sel.kind === 'scoring' && <ScoringPanel cfg={cfg} onChange={(scoring) => commit({ ...cfg, scoring })} />}
            {sel.kind === 'settings' && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Categoría</label>
                  <select
                    className={field}
                    value={meta.category}
                    onChange={(e) => {
                      setMeta({ ...meta, category: e.target.value })
                      setDirty(true)
                    }}
                  >
                    {FORM_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Quién responde</label>
                  <select
                    className={field}
                    value={meta.audience}
                    onChange={(e) => {
                      setMeta({ ...meta, audience: e.target.value })
                      setDirty(true)
                    }}
                  >
                    {FORM_AUDIENCES.map((a) => (
                      <option key={a} value={a}>
                        {AUDIENCE_LABELS[a]}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-2xs text-muted-foreground">
                    Captación y cualificación crean el contacto en el CRM. Alumnos solo vincula a quien ya existe.
                    Empleados no crea contactos.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Cerrar el formulario el
                  </label>
                  <input
                    type="datetime-local"
                    className={field}
                    value={meta.settings.closeAt ? meta.settings.closeAt.slice(0, 16) : ''}
                    onChange={(e) => {
                      setMeta({
                        ...meta,
                        settings: {
                          ...meta.settings,
                          closeAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                        },
                      })
                      setDirty(true)
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Máximo de respuestas</label>
                  <input
                    type="number"
                    min={1}
                    className={field}
                    value={meta.settings.maxResponses ?? ''}
                    onChange={(e) => {
                      setMeta({
                        ...meta,
                        settings: {
                          ...meta.settings,
                          maxResponses: e.target.value ? Number(e.target.value) : undefined,
                        },
                      })
                      setDirty(true)
                    }}
                  />
                </div>
              </div>
            )}
          </fieldset>
        </aside>
      </div>
    </div>
  )
}

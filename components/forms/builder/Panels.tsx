'use client'

import { useState } from 'react'

import { Image as ImageIcon, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  FIELD_TYPES,
  type Ending,
  type FieldType,
  type FormConfig,
  type LogicRule,
  type Question,
  type ScoringWeight,
  type SemanticRole,
} from '@/lib/forms/types'
import { contrastRatio, HEX, textOn } from '@/lib/forms/theme'
import { ConditionEditor } from './ConditionEditor'

export const TYPE_LABELS: Record<FieldType, string> = {
  shortText: 'Texto corto',
  longText: 'Texto largo',
  email: 'Email',
  phone: 'Teléfono',
  number: 'Número',
  url: 'URL',
  date: 'Fecha',
  singleChoice: 'Opción única',
  multiChoice: 'Opción múltiple',
  yesNo: 'Sí / No',
  dropdown: 'Desplegable',
  rating: 'Valoración con estrellas',
  nps: 'NPS (0-10)',
  scale: 'Escala',
  statement: 'Texto informativo',
  consent: 'Consentimiento',
  booking: 'Reserva de llamada (Calendly)',
  hidden: 'Campo oculto (URL)',
}

const SEMANTICS: { value: SemanticRole | ''; label: string }[] = [
  { value: '', label: 'Ninguno' },
  { value: 'contact.name', label: 'Nombre del contacto' },
  { value: 'contact.email', label: 'Email del contacto' },
  { value: 'contact.phone', label: 'Teléfono del contacto' },
  { value: 'rating', label: 'Valoración (estrellas)' },
  { value: 'nps', label: 'NPS' },
  { value: 'teacher', label: 'Profesor' },
  { value: 'module', label: 'Módulo' },
  { value: 'class', label: 'Clase' },
]

export const field =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand-500 focus:outline-none'
const Lbl = ({ children }: { children: React.ReactNode }) => (
  <label className="mb-1 block text-xs font-medium text-muted-foreground">{children}</label>
)
const Toggle = ({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: React.ReactNode
}) => (
  <label className="flex cursor-pointer items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 accent-[hsl(var(--brand-500))]"
    />
    {children}
  </label>
)

export const slugOf = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'opcion'

export function QuestionPanel({ q, all, onChange }: { q: Question; all: Question[]; onChange: (q: Question) => void }) {
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch })
  const [imgOpen, setImgOpen] = useState<number[]>([])
  const hasOptions = ['singleChoice', 'multiChoice', 'dropdown'].includes(q.type)
  const opts = q.options ?? []
  const before = all.slice(
    0,
    all.findIndex((x) => x.id === q.id)
  )

  const setType = (type: FieldType) => {
    const next: Question = { ...q, type }
    if (['singleChoice', 'multiChoice', 'dropdown'].includes(type) && !next.options?.length)
      next.options = [
        { value: 'opcion-1', label: 'Opción 1' },
        { value: 'opcion-2', label: 'Opción 2' },
      ]
    if (type === 'rating' && !next.scaleMax) next.scaleMax = 5
    onChange(next)
  }
  const addOption = () => {
    let n = opts.length + 1
    while (opts.some((o) => o.value === `opcion-${n}`)) n++
    set({ options: [...opts, { value: `opcion-${n}`, label: `Opción ${n}` }] })
  }
  const renameOption = (i: number, label: string) => {
    const others = opts.filter((_, j) => j !== i).map((o) => o.value)
    let value = slugOf(label)
    for (let k = 2; others.includes(value); k++) value = `${slugOf(label)}-${k}`
    set({ options: opts.map((o, j) => (j === i ? { ...o, label, value } : o)) })
  }

  return (
    <div className="space-y-4">
      <div>
        <Lbl>Tipo de pregunta</Lbl>
        <select className={field} value={q.type} onChange={(e) => setType(e.target.value as FieldType)}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      {q.type !== 'hidden' && (
        <>
          <div>
            <Lbl>Pregunta</Lbl>
            <textarea
              className={cn(field, 'resize-none')}
              rows={2}
              maxLength={500}
              value={q.title}
              onChange={(e) => set({ title: e.target.value })}
            />
            <p className="mt-1 text-2xs text-muted-foreground">
              Puedes usar respuestas anteriores: {'{{id-de-pregunta}}'}
            </p>
          </div>
          <div>
            <Lbl>Ayuda (opcional)</Lbl>
            <input
              className={field}
              maxLength={1000}
              value={q.help ?? ''}
              onChange={(e) => set({ help: e.target.value || undefined })}
            />
          </div>
        </>
      )}
      {q.type !== 'hidden' && (
        <div>
          <Lbl>Imagen bajo la pregunta (https, opcional)</Lbl>
          <input
            className={field}
            placeholder="https://…/imagen.jpg"
            value={q.imageUrl ?? ''}
            onChange={(e) => set({ imageUrl: e.target.value.trim() || undefined })}
          />
        </div>
      )}
      {q.type !== 'statement' && q.type !== 'hidden' && (
        <Toggle checked={!!q.required} onChange={(v) => set({ required: v })}>
          Obligatoria
        </Toggle>
      )}

      {hasOptions && (
        <div className="space-y-2">
          <Lbl>Opciones</Lbl>
          {opts.map((o, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  className={field}
                  value={o.label}
                  onChange={(e) => renameOption(i, e.target.value)}
                  aria-label={`Opción ${i + 1}`}
                />
                <button
                  type="button"
                  onClick={() => setImgOpen((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))}
                  className={cn(
                    'shrink-0 rounded p-1.5 hover:text-foreground',
                    o.imageUrl ? 'text-brand-400' : 'text-muted-foreground'
                  )}
                  aria-label={`Imagen de la opción ${i + 1}`}
                  title="Imagen de la opción"
                >
                  <ImageIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={opts.length <= 2}
                  onClick={() => set({ options: opts.filter((_, j) => j !== i) })}
                  className="shrink-0 text-muted-foreground hover:text-red-500 disabled:opacity-30"
                  aria-label="Quitar opción"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {(o.imageUrl || imgOpen.includes(i)) && (
                <input
                  className={field}
                  placeholder="https://…/imagen.jpg (elección con imágenes)"
                  value={o.imageUrl ?? ''}
                  onChange={(e) =>
                    set({
                      options: opts.map((x, j) =>
                        j === i ? { ...x, imageUrl: e.target.value.trim() || undefined } : x
                      ),
                    })
                  }
                  aria-label={`URL de la imagen de la opción ${i + 1}`}
                />
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addOption}
            className="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> Añadir opción
          </button>
          {q.type !== 'dropdown' && (
            <Toggle checked={!!q.allowOther} onChange={(v) => set({ allowOther: v })}>
              Permitir «Otro» con texto libre
            </Toggle>
          )}
        </div>
      )}
      {(q.type === 'multiChoice' || q.type === 'number') && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Lbl>{q.type === 'number' ? 'Mínimo' : 'Elegir al menos'}</Lbl>
            <input
              type="number"
              className={field}
              value={q.min ?? ''}
              onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
          <div>
            <Lbl>{q.type === 'number' ? 'Máximo' : 'Elegir como máximo'}</Lbl>
            <input
              type="number"
              className={field}
              value={q.max ?? ''}
              onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
        </div>
      )}
      {(q.type === 'rating' || q.type === 'scale') && (
        <div>
          <Lbl>Valor máximo (2-10)</Lbl>
          <input
            type="number"
            min={2}
            max={10}
            className={field}
            value={q.scaleMax ?? 5}
            onChange={(e) => set({ scaleMax: Math.min(10, Math.max(2, Number(e.target.value) || 5)) })}
          />
        </div>
      )}
      {(q.type === 'scale' || q.type === 'nps') && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Lbl>Etiqueta mínimo</Lbl>
            <input
              className={field}
              maxLength={60}
              value={q.scaleLabels?.min ?? ''}
              onChange={(e) => set({ scaleLabels: { ...q.scaleLabels, min: e.target.value || undefined } })}
            />
          </div>
          <div>
            <Lbl>Etiqueta máximo</Lbl>
            <input
              className={field}
              maxLength={60}
              value={q.scaleLabels?.max ?? ''}
              onChange={(e) => set({ scaleLabels: { ...q.scaleLabels, max: e.target.value || undefined } })}
            />
          </div>
        </div>
      )}
      {['shortText', 'longText'].includes(q.type) && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Lbl>Mínimo de caracteres</Lbl>
            <input
              type="number"
              min={0}
              className={field}
              value={q.minLength ?? ''}
              onChange={(e) => set({ minLength: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
          <div>
            <Lbl>Máximo de caracteres</Lbl>
            <input
              type="number"
              min={1}
              className={field}
              value={q.maxLength ?? ''}
              onChange={(e) => set({ maxLength: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
        </div>
      )}
      {['shortText', 'email', 'url', 'number', 'longText', 'phone'].includes(q.type) && (
        <div>
          <Lbl>Texto de ejemplo (placeholder)</Lbl>
          <input
            className={field}
            maxLength={200}
            value={q.placeholder ?? ''}
            onChange={(e) => set({ placeholder: e.target.value || undefined })}
          />
        </div>
      )}
      {q.type === 'consent' && (
        <div>
          <Lbl>Texto de la casilla</Lbl>
          <input
            className={field}
            maxLength={200}
            value={q.placeholder ?? ''}
            onChange={(e) => set({ placeholder: e.target.value || undefined })}
          />
        </div>
      )}
      {q.type === 'booking' && (
        <div>
          <Lbl>Enlace de Calendly</Lbl>
          <input
            className={field}
            placeholder="https://calendly.com/tu-usuario/llamada"
            value={q.defaultValue ?? ''}
            onChange={(e) => set({ defaultValue: e.target.value || undefined })}
          />
        </div>
      )}
      {q.type === 'hidden' && (
        <>
          <div>
            <Lbl>Nombre del parámetro de la URL</Lbl>
            <input
              className={field}
              placeholder="utm_source, profesor…"
              value={q.hiddenKey ?? ''}
              onChange={(e) => set({ hiddenKey: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') || undefined })}
            />
          </div>
          <div>
            <Lbl>Valor por defecto</Lbl>
            <input
              className={field}
              value={q.defaultValue ?? ''}
              onChange={(e) => set({ defaultValue: e.target.value || undefined })}
            />
          </div>
        </>
      )}
      {q.type !== 'statement' && (
        <div>
          <Lbl>Significado (para enlazar con contactos, alumnos y analítica)</Lbl>
          <select
            className={field}
            value={q.semantic?.startsWith('qualification.') ? 'qualification' : (q.semantic ?? '')}
            onChange={(e) =>
              set({
                semantic:
                  e.target.value === 'qualification'
                    ? (`qualification.${slugOf(q.id).replace(/-/g, '_')}` as SemanticRole)
                    : ((e.target.value || undefined) as SemanticRole | undefined),
              })
            }
          >
            {SEMANTICS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
            <option value="qualification">Dato de cualificación</option>
          </select>
        </div>
      )}
      {q.type !== 'hidden' && (
        <div>
          <Lbl>Mostrar solo si…</Lbl>
          <ConditionEditor
            group={q.showIf}
            questions={before}
            onChange={(g) => set({ showIf: g })}
            emptyLabel="Siempre se muestra"
          />
        </div>
      )}
    </div>
  )
}

export function EndingPanel({ e, all, onChange }: { e: Ending; all: Question[]; onChange: (e: Ending) => void }) {
  const set = (patch: Partial<Ending>) => onChange({ ...e, ...patch })
  return (
    <div className="space-y-4">
      <div>
        <Lbl>Título</Lbl>
        <input className={field} maxLength={300} value={e.title} onChange={(ev) => set({ title: ev.target.value })} />
      </div>
      <div>
        <Lbl>Mensaje</Lbl>
        <textarea
          className={cn(field, 'resize-none')}
          rows={3}
          maxLength={2000}
          value={e.message ?? ''}
          onChange={(ev) => set({ message: ev.target.value || undefined })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Lbl>Texto del botón</Lbl>
          <input
            className={field}
            maxLength={80}
            value={e.ctaLabel ?? ''}
            onChange={(ev) => set({ ctaLabel: ev.target.value || undefined })}
          />
        </div>
        <div>
          <Lbl>Enlace del botón</Lbl>
          <input
            className={field}
            placeholder="https://…"
            value={e.ctaUrl ?? ''}
            onChange={(ev) => set({ ctaUrl: ev.target.value || undefined })}
          />
        </div>
      </div>
      <div>
        <Lbl>Redirigir automáticamente a</Lbl>
        <input
          className={field}
          placeholder="{{trustpilot_url}} o https://…"
          value={e.redirectUrl ?? ''}
          onChange={(ev) => set({ redirectUrl: ev.target.value || undefined })}
        />
        <p className="mt-1 text-2xs text-muted-foreground">
          {'{{trustpilot_url}}'} usa el enlace de reseñas de Configuración › Integraciones.
        </p>
      </div>
      <Toggle checked={!!e.isDefault} onChange={(v) => set({ isDefault: v })}>
        Final por defecto
      </Toggle>
      <div>
        <Lbl>Mostrar este final solo si…</Lbl>
        <ConditionEditor
          group={e.when}
          questions={all}
          onChange={(g) => set({ when: g })}
          allowServerVars
          emptyLabel="Sin condición (se usa si ningún otro final aplica)"
        />
      </div>
    </div>
  )
}

export function LogicPanel({ cfg, onChange }: { cfg: FormConfig; onChange: (logic: LogicRule[]) => void }) {
  const screens = cfg.questions.filter((q) => q.type !== 'hidden')
  const rules = cfg.logic
  const setRule = (i: number, r: LogicRule) => onChange(rules.map((x, j) => (j === i ? r : x)))
  const add = () => {
    if (!screens.length) return
    onChange([
      ...rules,
      {
        id: `regla-${Date.now().toString(36)}`,
        from: screens[0].id,
        when: { match: 'all', conditions: [] },
        then: { type: 'end', endingId: cfg.endings[0]?.id ?? '' },
      },
    ])
  }
  const target = (r: LogicRule) => (r.then.type === 'jump' ? `q:${r.then.target}` : `e:${r.then.endingId}`)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Al salir de una pregunta, si se cumple la condición, salta a otra pregunta o termina en un final concreto. Solo
        hacia delante.
      </p>
      {rules.map((r, i) => (
        <div key={r.id} className="space-y-2 rounded-xl border border-border p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Al salir de</span>
            <select className={field} value={r.from} onChange={(e) => setRule(i, { ...r, from: e.target.value })}>
              {screens.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title || q.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onChange(rules.filter((_, j) => j !== i))}
              className="text-muted-foreground hover:text-red-500"
              aria-label="Quitar regla"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <ConditionEditor
            group={r.when}
            questions={screens}
            onChange={(g) => setRule(i, { ...r, when: g ?? { match: 'all', conditions: [] } })}
            emptyLabel="Siempre (sin condición)"
          />
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">entonces ir a</span>
            <select
              className={field}
              value={target(r)}
              onChange={(e) =>
                setRule(i, {
                  ...r,
                  then: e.target.value.startsWith('q:')
                    ? { type: 'jump', target: e.target.value.slice(2) }
                    : { type: 'end', endingId: e.target.value.slice(2) },
                })
              }
            >
              <optgroup label="Preguntas">
                {screens.map((q) => (
                  <option key={q.id} value={`q:${q.id}`}>
                    {q.title || q.id}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Finales">
                {cfg.endings.map((en) => (
                  <option key={en.id} value={`e:${en.id}`}>
                    {en.title || en.id}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1 text-sm text-brand-400 hover:underline"
      >
        <Plus className="h-4 w-4" /> Añadir regla
      </button>
    </div>
  )
}

export function ScoringPanel({ cfg, onChange }: { cfg: FormConfig; onChange: (s: FormConfig['scoring']) => void }) {
  const s = cfg.scoring ?? { enabled: false, weights: [], thresholds: { caliente: 70, templado: 40 } }
  const set = (patch: Partial<typeof s>) => onChange({ ...s, ...patch })
  const choiceQs = cfg.questions.filter((q) => ['singleChoice', 'multiChoice', 'dropdown', 'yesNo'].includes(q.type))
  const optsOf = (id: string) => {
    const q = cfg.questions.find((x) => x.id === id)
    return q?.type === 'yesNo'
      ? [
          { value: 'yes', label: 'Sí' },
          { value: 'no', label: 'No' },
        ]
      : (q?.options ?? [])
  }
  const setW = (i: number, w: ScoringWeight) => set({ weights: s.weights.map((x, j) => (j === i ? w : x)) })
  return (
    <div className="space-y-4">
      <Toggle checked={s.enabled} onChange={(v) => set({ enabled: v })}>
        Puntuar respuestas (cualificación)
      </Toggle>
      <p className="text-xs text-muted-foreground">
        La puntuación se calcula en el servidor: quien rellena el formulario nunca ve los pesos.
      </p>
      {s.enabled && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Lbl>Caliente desde</Lbl>
              <input
                type="number"
                className={field}
                value={s.thresholds.caliente}
                onChange={(e) => set({ thresholds: { ...s.thresholds, caliente: Number(e.target.value) } })}
              />
            </div>
            <div>
              <Lbl>Templado desde</Lbl>
              <input
                type="number"
                className={field}
                value={s.thresholds.templado}
                onChange={(e) => set({ thresholds: { ...s.thresholds, templado: Number(e.target.value) } })}
              />
            </div>
            <div>
              <Lbl>Etiqueta (prefijo)</Lbl>
              <input
                className={field}
                maxLength={40}
                value={s.tagPrefix ?? ''}
                onChange={(e) =>
                  set({ tagPrefix: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') || undefined })
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Lbl>Puntos por respuesta</Lbl>
            {s.weights.map((w, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  className={cn(field, 'w-44')}
                  value={w.questionId}
                  onChange={(e) => setW(i, { questionId: e.target.value, points: w.points })}
                >
                  {choiceQs.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title || q.id}
                    </option>
                  ))}
                </select>
                <select
                  className={cn(field, 'w-40')}
                  value={w.value ?? ''}
                  onChange={(e) => setW(i, { ...w, value: e.target.value, in: undefined })}
                >
                  <option value="">—</option>
                  {optsOf(w.questionId).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  className={cn(field, 'w-20')}
                  value={w.points}
                  onChange={(e) => setW(i, { ...w, points: Number(e.target.value) })}
                  aria-label="Puntos"
                />
                <button
                  type="button"
                  onClick={() => set({ weights: s.weights.filter((_, j) => j !== i) })}
                  className="text-muted-foreground hover:text-red-500"
                  aria-label="Quitar"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={!choiceQs.length}
              onClick={() =>
                set({
                  weights: [
                    ...s.weights,
                    { questionId: choiceQs[0].id, value: optsOf(choiceQs[0].id)[0]?.value, points: 10 },
                  ],
                })
              }
              className="inline-flex items-center gap-1 text-sm text-brand-400 hover:underline disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Añadir peso
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function WelcomePanel({ cfg, onChange }: { cfg: FormConfig; onChange: (c: Partial<FormConfig>) => void }) {
  const w = cfg.welcome
  const setW = (patch: Partial<NonNullable<FormConfig['welcome']>>) =>
    onChange({ welcome: { title: '', cta: 'Empezar', ...w, ...patch } })
  return (
    <div className="space-y-4">
      <Toggle
        checked={!!w}
        onChange={(v) => onChange({ welcome: v ? { title: 'Bienvenida', cta: 'Empezar' } : undefined })}
      >
        Mostrar pantalla de bienvenida
      </Toggle>
      {w && (
        <>
          <div>
            <Lbl>Etiqueta superior</Lbl>
            <input
              className={field}
              maxLength={80}
              value={w.kicker ?? ''}
              onChange={(e) => setW({ kicker: e.target.value || undefined })}
            />
          </div>
          <div>
            <Lbl>Título</Lbl>
            <input
              className={field}
              maxLength={300}
              value={w.title}
              onChange={(e) => setW({ title: e.target.value })}
            />
          </div>
          <div>
            <Lbl>Subtítulo</Lbl>
            <textarea
              className={cn(field, 'resize-none')}
              rows={2}
              maxLength={600}
              value={w.subtitle ?? ''}
              onChange={(e) => setW({ subtitle: e.target.value || undefined })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Lbl>Botón</Lbl>
              <input className={field} maxLength={60} value={w.cta} onChange={(e) => setW({ cta: e.target.value })} />
            </div>
            <div>
              <Lbl>Tiempo estimado</Lbl>
              <input
                className={field}
                maxLength={40}
                value={w.estimatedTime ?? ''}
                onChange={(e) => setW({ estimatedTime: e.target.value || undefined })}
              />
            </div>
          </div>
          <div className="rounded-xl border border-border p-3">
            <Toggle
              checked={!!cfg.abTest}
              onChange={(v) => onChange({ abTest: v ? { field: 'title', a: w.title, b: w.title } : undefined })}
            >
              Test A/B de la bienvenida
            </Toggle>
            {cfg.abTest && (
              <div className="mt-3 space-y-2">
                <select
                  className={field}
                  value={cfg.abTest.field}
                  onChange={(e) => onChange({ abTest: { ...cfg.abTest!, field: e.target.value as 'title' | 'cta' } })}
                >
                  <option value="title">Probar el título</option>
                  <option value="cta">Probar el botón</option>
                </select>
                <input
                  className={field}
                  aria-label="Variante A"
                  placeholder="Variante A"
                  maxLength={300}
                  value={cfg.abTest.a}
                  onChange={(e) => onChange({ abTest: { ...cfg.abTest!, a: e.target.value } })}
                />
                <input
                  className={field}
                  aria-label="Variante B"
                  placeholder="Variante B"
                  maxLength={300}
                  value={cfg.abTest.b}
                  onChange={(e) => onChange({ abTest: { ...cfg.abTest!, b: e.target.value } })}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const PRESETS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0d9488', '#111827']

export function ThemePanel({ cfg, onChange }: { cfg: FormConfig; onChange: (t: FormConfig['theme']) => void }) {
  const t = cfg.theme ?? { mode: 'auto' as const }
  const set = (patch: Partial<NonNullable<FormConfig['theme']>>) => {
    const next = { ...t, ...patch } as Record<string, unknown>
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k]
    onChange(next as unknown as FormConfig['theme'])
  }
  const accentOk = !t.accent || contrastRatio(t.accent, textOn(t.accent)) >= 4.5
  const logoMode = t.hideLogo ? 'hide' : t.logoUrl ? 'custom' : 'tenant'
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Por defecto el formulario usa el color y el logo de tu subcuenta. Aquí puedes personalizarlo solo para este
        formulario.
      </p>
      <div>
        <Lbl>Color de acento</Lbl>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => set({ accent: undefined })}
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-xs',
              !t.accent ? 'border-brand-500 bg-brand-500/10' : 'border-border'
            )}
          >
            Color de la subcuenta
          </button>
          {PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Acento ${c}`}
              onClick={() => set({ accent: c })}
              className={cn(
                'h-7 w-7 rounded-full border-2',
                t.accent === c ? 'border-foreground' : 'border-transparent'
              )}
              style={{ background: c }}
            />
          ))}
          <input
            type="color"
            aria-label="Elegir color"
            value={t.accent && HEX.test(t.accent) ? t.accent : '#2563eb'}
            onChange={(e) => set({ accent: e.target.value })}
            className="h-8 w-10 cursor-pointer rounded border border-border bg-card p-0.5"
          />
        </div>
        {!accentOk && (
          <p className="mt-1 text-2xs text-amber-400">
            Poco contraste con el texto del botón: prueba un tono más oscuro o más claro.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Lbl>Modo</Lbl>
          <select
            className={field}
            value={t.mode}
            onChange={(e) => set({ mode: e.target.value as 'light' | 'dark' | 'auto' })}
          >
            <option value="auto">Automático (según el dispositivo)</option>
            <option value="light">Claro</option>
            <option value="dark">Oscuro</option>
          </select>
        </div>
        <div>
          <Lbl>Tipografía</Lbl>
          <select
            className={field}
            value={t.font ?? 'display'}
            onChange={(e) => set({ font: e.target.value as NonNullable<FormConfig['theme']>['font'] })}
          >
            <option value="display">Moderna (titulares)</option>
            <option value="sans">Neutra</option>
            <option value="serif">Con serifa</option>
            <option value="mono">Monoespaciada</option>
          </select>
        </div>
      </div>
      <div>
        <Lbl>Esquinas</Lbl>
        <select
          className={field}
          value={t.radius ?? 'md'}
          onChange={(e) => set({ radius: e.target.value as NonNullable<FormConfig['theme']>['radius'] })}
        >
          <option value="sm">Rectas</option>
          <option value="md">Suaves</option>
          <option value="lg">Redondeadas</option>
          <option value="full">Botones en píldora</option>
        </select>
      </div>
      <div className="space-y-2">
        <Lbl>Fondo</Lbl>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Color de fondo"
            value={t.background && HEX.test(t.background) ? t.background : '#ffffff'}
            onChange={(e) => set({ background: e.target.value })}
            className="h-8 w-10 cursor-pointer rounded border border-border bg-card p-0.5"
          />
          <button
            type="button"
            onClick={() => set({ background: undefined })}
            className="text-xs text-brand-400 hover:underline"
          >
            Quitar color
          </button>
        </div>
        <input
          className={field}
          placeholder="Imagen de fondo (https, opcional)"
          value={t.backgroundImageUrl ?? ''}
          onChange={(e) => set({ backgroundImageUrl: e.target.value.trim() || undefined })}
        />
      </div>
      <div className="space-y-2">
        <Lbl>Logo</Lbl>
        <select
          className={field}
          value={logoMode}
          onChange={(e) =>
            set({
              hideLogo: e.target.value === 'hide' ? true : undefined,
              logoUrl: e.target.value === 'custom' ? (t.logoUrl ?? 'https://') : undefined,
            })
          }
        >
          <option value="tenant">Logo de la subcuenta</option>
          <option value="custom">Logo propio de este formulario</option>
          <option value="hide">Sin logo</option>
        </select>
        {logoMode === 'custom' && (
          <input
            className={field}
            placeholder="https://…/logo.png"
            value={t.logoUrl ?? ''}
            onChange={(e) => set({ logoUrl: e.target.value.trim() || undefined })}
          />
        )}
      </div>
      <div>
        <Lbl>Imagen de la pantalla de bienvenida (https, opcional)</Lbl>
        <input
          className={field}
          placeholder="https://…/portada.jpg"
          value={t.coverUrl ?? ''}
          onChange={(e) => set({ coverUrl: e.target.value.trim() || undefined })}
        />
      </div>
    </div>
  )
}

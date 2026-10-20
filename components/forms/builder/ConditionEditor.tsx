'use client'

import { Plus, Trash2 } from 'lucide-react'
import type { Condition, ConditionGroup, ConditionOperator, Question } from '@/lib/forms/types'

const OPS: { value: ConditionOperator; label: string }[] = [
  { value: 'equals', label: 'es igual a' },
  { value: 'notEquals', label: 'no es igual a' },
  { value: 'in', label: 'es uno de' },
  { value: 'gte', label: '≥' },
  { value: 'gt', label: '>' },
  { value: 'lte', label: '≤' },
  { value: 'lt', label: '<' },
  { value: 'contains', label: 'contiene' },
  { value: 'isAnswered', label: 'está respondida' },
  { value: 'isEmpty', label: 'está vacía' },
]

const sel = 'rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground'

const needsValue = (op: ConditionOperator) => op !== 'isAnswered' && op !== 'isEmpty'

/** Variables calculadas por el servidor (solo para finales condicionales). */
const SERVER_VARS = [
  { id: '$temperature', label: 'Temperatura (caliente/templado/frio)' },
  { id: '$score', label: 'Puntuación (0-100)' },
]

interface Props {
  group: ConditionGroup | undefined
  questions: Question[]
  onChange: (g: ConditionGroup | undefined) => void
  allowServerVars?: boolean
  emptyLabel?: string
}

export function ConditionEditor({ group, questions, onChange, allowServerVars, emptyLabel = 'Sin condición' }: Props) {
  const usable = questions.filter((q) => q.type !== 'statement')
  const g: ConditionGroup = group ?? { match: 'all', conditions: [] }
  const set = (conditions: Condition[], match = g.match) =>
    onChange(conditions.length ? { match, conditions } : undefined)
  const update = (i: number, patch: Partial<Condition>) =>
    set(g.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  return (
    <div className="space-y-2">
      {g.conditions.length === 0 && <p className="text-xs text-muted-foreground">{emptyLabel}</p>}
      {g.conditions.length > 1 && (
        <select
          className={sel}
          value={g.match}
          onChange={(e) => set(g.conditions, e.target.value as 'all' | 'any')}
          aria-label="Combinar condiciones"
        >
          <option value="all">Se cumplen todas</option>
          <option value="any">Se cumple alguna</option>
        </select>
      )}
      {g.conditions.map((c, i) => {
        const q = usable.find((x) => x.id === c.questionId)
        const options =
          q?.options ??
          (q?.type === 'yesNo'
            ? [
                { value: 'yes', label: 'Sí' },
                { value: 'no', label: 'No' },
              ]
            : undefined)
        const temperature = c.questionId === '$temperature'
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select
              className={sel}
              value={c.questionId}
              onChange={(e) => update(i, { questionId: e.target.value, value: undefined })}
              aria-label="Pregunta"
            >
              {usable.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title || x.id}
                </option>
              ))}
              {allowServerVars &&
                SERVER_VARS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
            </select>
            <select
              className={sel}
              value={c.op}
              onChange={(e) => update(i, { op: e.target.value as ConditionOperator })}
              aria-label="Operador"
            >
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {needsValue(c.op) &&
              (temperature ? (
                <select
                  className={sel}
                  value={String(c.value ?? '')}
                  onChange={(e) => update(i, { value: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="caliente">caliente</option>
                  <option value="templado">templado</option>
                  <option value="frio">frio</option>
                </select>
              ) : options && c.op !== 'in' ? (
                <select
                  className={sel}
                  value={String(c.value ?? '')}
                  onChange={(e) => update(i, { value: e.target.value })}
                >
                  <option value="">—</option>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={`${sel} w-32`}
                  value={Array.isArray(c.value) ? c.value.join(',') : String(c.value ?? '')}
                  placeholder={c.op === 'in' ? 'a,b,c' : 'valor'}
                  onChange={(e) => {
                    const raw = e.target.value
                    update(i, {
                      value:
                        c.op === 'in'
                          ? raw
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean)
                          : raw !== '' && !Number.isNaN(Number(raw)) && ['gt', 'gte', 'lt', 'lte'].includes(c.op)
                            ? Number(raw)
                            : raw,
                    })
                  }}
                />
              ))}
            <button
              type="button"
              onClick={() => set(g.conditions.filter((_, j) => j !== i))}
              className="ml-auto text-muted-foreground hover:text-red-500"
              aria-label="Quitar condición"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        disabled={usable.length === 0 && !allowServerVars}
        onClick={() =>
          set([...g.conditions, { questionId: usable[0]?.id ?? '$temperature', op: 'equals', value: undefined }])
        }
        className="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" /> Añadir condición
      </button>
    </div>
  )
}

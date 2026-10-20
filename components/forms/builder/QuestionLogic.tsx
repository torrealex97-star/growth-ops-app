'use client'

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { Ending, LogicAction, LogicRule, Question } from '@/lib/forms/types'
import { ConditionEditor } from './ConditionEditor'

const field =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand-500'

const isFallback = (r: LogicRule) => r.when.conditions.length === 0
const encode = (a: LogicAction) => (a.type === 'jump' ? `q:${a.target}` : `e:${a.endingId}`)
const decode = (v: string): LogicAction =>
  v.startsWith('q:') ? { type: 'jump', target: v.slice(2) } : { type: 'end', endingId: v.slice(2) }

/**
 * Lógica de saltos de UNA pregunta, como en Typeform: "si la respuesta es X, ve a Y" y, al final,
 * "en cualquier otro caso → …". Gana la primera regla que se cumple (el orden importa); el
 * "en cualquier otro caso" es una regla sin condición y va siempre la última.
 */
export function QuestionLogic({
  q,
  screens,
  endings,
  logic,
  onChange,
}: {
  q: Question
  screens: Question[]
  endings: Ending[]
  logic: LogicRule[]
  onChange: (logic: LogicRule[]) => void
}) {
  const idx = screens.findIndex((x) => x.id === q.id)
  if (idx < 0) return null
  const later = screens.slice(idx + 1)
  const mine = logic.filter((r) => r.from === q.id)
  const others = logic.filter((r) => r.from !== q.id)
  const conditional = mine.filter((r) => !isFallback(r))
  const fallback = mine.find(isFallback)

  const commit = (cond: LogicRule[], fb: LogicRule | undefined) => onChange([...others, ...cond, ...(fb ? [fb] : [])])
  const firstTarget = (): LogicAction =>
    later[0] ? { type: 'jump', target: later[0].id } : { type: 'end', endingId: endings[0]?.id ?? '' }
  const setCond = (i: number, r: LogicRule) =>
    commit(
      conditional.map((x, j) => (j === i ? r : x)),
      fallback
    )
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= conditional.length) return
    const next = [...conditional]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next, fallback)
  }
  const options = (
    <>
      {later.length > 0 && (
        <optgroup label="Preguntas">
          {later.map((x) => (
            <option key={x.id} value={`q:${x.id}`}>
              {x.title || x.id}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Finales">
        {endings.map((e) => (
          <option key={e.id} value={`e:${e.id}`}>
            {e.title || e.id}
          </option>
        ))}
      </optgroup>
    </>
  )

  return (
    <div className="space-y-3" data-testid="question-logic">
      <p className="text-xs text-muted-foreground">
        Al responder esta pregunta, salta a otra o termina en un final según lo que conteste. Gana la primera regla que
        se cumple.
      </p>
      {conditional.map((r, i) => (
        <div key={r.id} className="space-y-2 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Regla {i + 1}</span>
            <span className="flex gap-1">
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label="Subir regla"
                className="p-1 hover:text-foreground disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={i === conditional.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Bajar regla"
                className="p-1 hover:text-foreground disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  commit(
                    conditional.filter((_, j) => j !== i),
                    fallback
                  )
                }
                aria-label="Quitar regla"
                className="p-1 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          <ConditionEditor
            group={r.when}
            questions={screens.slice(0, idx + 1)}
            onChange={(g) => setCond(i, { ...r, when: g ?? { match: 'all', conditions: [] } })}
            emptyLabel="Elige una condición"
          />
          <label className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">Ir a</span>
            <select
              className={field}
              value={encode(r.then)}
              onChange={(e) => setCond(i, { ...r, then: decode(e.target.value) })}
            >
              {options}
            </select>
          </label>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          commit(
            [
              ...conditional,
              {
                id: `regla-${Date.now().toString(36)}${conditional.length}`,
                from: q.id,
                when: {
                  match: 'all',
                  conditions: [{ questionId: q.id, op: 'equals', value: '' }],
                },
                then: firstTarget(),
              },
            ],
            fallback
          )
        }
        className="inline-flex items-center gap-1 text-sm text-brand-400 hover:underline"
      >
        <Plus className="h-4 w-4" /> Añadir regla
      </button>
      <label className="block space-y-1 rounded-xl border border-dashed border-border p-3 text-sm">
        <span className="text-muted-foreground">En cualquier otro caso</span>
        <select
          className={field}
          value={fallback ? encode(fallback.then) : ''}
          onChange={(e) =>
            commit(
              conditional,
              e.target.value
                ? {
                    id: fallback?.id ?? `otro-${Date.now().toString(36)}`,
                    from: q.id,
                    when: { match: 'all', conditions: [] },
                    then: decode(e.target.value),
                  }
                : undefined
            )
          }
        >
          <option value="">Siguiente pregunta (por defecto)</option>
          {options}
        </select>
      </label>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DIAL_CODES, toE164 } from '@/lib/phone'
import { maxForScale, OTHER_VALUE_PREFIX } from '@/lib/forms/validation'
import type { Answer, Question } from '@/lib/forms/types'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const inputCls =
  'w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-brand-500 focus:outline-none'

interface FieldProps {
  q: Question
  value: Answer | undefined
  onChange: (v: Answer | undefined) => void
  /** Respuesta de selección única: el motor avanza solo tras una breve pausa. */
  onPick: (v: Answer) => void
  error?: string
  name?: string
  email?: string
}

function ChoiceButton({
  letter,
  label,
  selected,
  onClick,
  multi,
}: {
  letter: string
  label: string
  selected: boolean
  onClick: () => void
  multi?: boolean
}) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex w-full min-h-[48px] items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-base transition-colors',
        selected
          ? 'border-brand-500 bg-brand-500/10 text-foreground'
          : 'border-border bg-card text-foreground hover:border-brand-500/60'
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold',
          selected ? 'border-brand-500 bg-brand-500 text-white' : 'border-border text-muted-foreground'
        )}
      >
        {letter}
      </span>
      <span>{label}</span>
    </button>
  )
}

export function Field({ q, value, onChange, onPick, error, name, email }: FieldProps) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus({ preventScroll: true }), 120)
    return () => clearTimeout(t)
  }, [q.id])

  const str = typeof value === 'string' ? value : ''
  const opts = q.options ?? []

  switch (q.type) {
    case 'shortText':
    case 'email':
    case 'url':
    case 'number':
    case 'date':
      return (
        <input
          ref={ref}
          aria-label={q.title}
          aria-invalid={!!error}
          type={
            q.type === 'email'
              ? 'email'
              : q.type === 'number'
                ? 'number'
                : q.type === 'date'
                  ? 'date'
                  : q.type === 'url'
                    ? 'url'
                    : 'text'
          }
          inputMode={q.type === 'number' ? 'decimal' : undefined}
          autoComplete={q.type === 'email' ? 'email' : q.semantic === 'contact.name' ? 'name' : 'off'}
          placeholder={q.placeholder}
          min={q.type === 'number' ? q.min : undefined}
          max={q.type === 'number' ? q.max : undefined}
          maxLength={q.type === 'number' || q.type === 'date' ? undefined : (q.maxLength ?? 500)}
          value={q.type === 'number' && typeof value === 'number' ? String(value) : str}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className={inputCls}
        />
      )
    case 'longText':
      return (
        <textarea
          ref={ref}
          aria-label={q.title}
          aria-invalid={!!error}
          rows={4}
          placeholder={q.placeholder}
          maxLength={q.maxLength ?? 5000}
          value={str}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className={cn(inputCls, 'resize-none')}
        />
      )
    case 'phone':
      return <PhoneField q={q} value={str} onChange={onChange} error={error} inputRef={ref} />
    case 'singleChoice':
    case 'yesNo': {
      const list =
        q.type === 'yesNo'
          ? [
              { value: 'yes', label: 'Sí' },
              { value: 'no', label: 'No' },
            ]
          : opts
      const isOther = str.startsWith(OTHER_VALUE_PREFIX)
      return (
        <div role="radiogroup" aria-label={q.title} className="space-y-2">
          {list.map((o, i) => (
            <ChoiceButton
              key={o.value}
              letter={LETTERS[i] ?? ''}
              label={o.label}
              selected={str === o.value}
              onClick={() => onPick(o.value)}
            />
          ))}
          {q.allowOther && q.type === 'singleChoice' && (
            <>
              <ChoiceButton
                letter="+"
                label="Otro"
                selected={isOther}
                onClick={() => onChange(OTHER_VALUE_PREFIX + ' ')}
              />
              {isOther && (
                <input
                  ref={ref}
                  className={inputCls}
                  placeholder="Cuéntanos"
                  maxLength={200}
                  value={str.slice(OTHER_VALUE_PREFIX.length).trimStart()}
                  onChange={(e) => onChange(OTHER_VALUE_PREFIX + e.target.value)}
                />
              )}
            </>
          )}
        </div>
      )
    }
    case 'multiChoice': {
      const arr = Array.isArray(value) ? value : []
      const toggle = (v: string) => onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
      const otherVal = arr.find((x) => x.startsWith(OTHER_VALUE_PREFIX))
      return (
        <div role="group" aria-label={q.title} className="space-y-2">
          {opts.map((o, i) => (
            <ChoiceButton
              key={o.value}
              multi
              letter={LETTERS[i] ?? ''}
              label={o.label}
              selected={arr.includes(o.value)}
              onClick={() => toggle(o.value)}
            />
          ))}
          {q.allowOther && (
            <>
              <ChoiceButton
                multi
                letter="+"
                label="Otro"
                selected={!!otherVal}
                onClick={() =>
                  onChange(otherVal ? arr.filter((x) => x !== otherVal) : [...arr, OTHER_VALUE_PREFIX + ' '])
                }
              />
              {otherVal && (
                <input
                  className={inputCls}
                  placeholder="Cuéntanos"
                  maxLength={200}
                  value={otherVal.slice(OTHER_VALUE_PREFIX.length).trimStart()}
                  onChange={(e) => onChange(arr.map((x) => (x === otherVal ? OTHER_VALUE_PREFIX + e.target.value : x)))}
                />
              )}
            </>
          )}
        </div>
      )
    }
    case 'dropdown':
      return (
        <select
          aria-label={q.title}
          className={inputCls}
          value={str}
          onChange={(e) => (e.target.value ? onPick(e.target.value) : onChange(undefined))}
        >
          <option value="">Elige una opción</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    case 'rating': {
      const max = maxForScale(q)
      const n = typeof value === 'number' ? value : Number(value) || 0
      return (
        <div role="radiogroup" aria-label={q.title} className="flex flex-wrap gap-1">
          {Array.from({ length: max }, (_, i) => i + 1).map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={n === i}
              aria-label={`${i} de ${max}`}
              onClick={() => onPick(i)}
              className="rounded-md p-1 transition-transform hover:scale-110"
            >
              <Star
                className={cn(
                  'h-10 w-10 sm:h-12 sm:w-12',
                  i <= n ? 'fill-brand-500 text-brand-500' : 'text-muted-foreground'
                )}
              />
            </button>
          ))}
        </div>
      )
    }
    case 'nps':
    case 'scale': {
      const lo = q.type === 'nps' ? 0 : 1
      const hi = q.type === 'nps' ? 10 : maxForScale(q)
      const n = typeof value === 'number' ? value : value === undefined ? null : Number(value)
      return (
        <div>
          <div role="radiogroup" aria-label={q.title} className="flex flex-wrap gap-2">
            {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={n === i}
                onClick={() => onPick(i)}
                className={cn(
                  'h-12 w-12 rounded-xl border-2 text-base font-semibold transition-colors',
                  n === i
                    ? 'border-brand-500 bg-brand-500 text-white'
                    : 'border-border bg-card text-foreground hover:border-brand-500/60'
                )}
              >
                {i}
              </button>
            ))}
          </div>
          {(q.scaleLabels?.min || q.scaleLabels?.max) && (
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{q.scaleLabels?.min}</span>
              <span>{q.scaleLabels?.max}</span>
            </div>
          )}
        </div>
      )
    }
    case 'consent':
      return (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-border bg-card p-4 text-base">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 accent-[hsl(var(--brand-500))]"
            checked={value === true || value === 'true'}
            onChange={(e) => onChange(e.target.checked ? true : undefined)}
          />
          <span>{q.placeholder || 'Acepto'}</span>
        </label>
      )
    case 'booking':
      return <BookingField q={q} value={str} onChange={onChange} name={name} email={email} />
    default:
      return null
  }
}

function PhoneField({
  q,
  value,
  onChange,
  error,
  inputRef,
}: {
  q: Question
  value: string
  onChange: (v: Answer | undefined) => void
  error?: string
  inputRef: React.Ref<HTMLInputElement>
}) {
  const [prefix, setPrefix] = useState('+34')
  const [national, setNational] = useState(() => (value ? value.replace(/^\+\d{1,3}/, '') : ''))
  const update = (p: string, n: string) => {
    setPrefix(p)
    setNational(n)
    onChange(toE164(p, n) || undefined)
  }
  return (
    <div className="flex gap-2">
      <select
        aria-label="Prefijo"
        className="rounded-xl border-2 border-border bg-card px-2 py-3 text-base"
        value={prefix}
        onChange={(e) => update(e.target.value, national)}
      >
        {DIAL_CODES.map((d) => (
          <option key={d.code + d.iso} value={d.code}>{`${d.iso} ${d.code}`}</option>
        ))}
      </select>
      <input
        ref={inputRef}
        aria-label={q.title}
        aria-invalid={!!error}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={q.placeholder || '600 000 000'}
        value={national}
        onChange={(e) => update(prefix, e.target.value)}
        className="min-w-0 flex-1 rounded-xl border-2 border-border bg-card px-4 py-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-brand-500 focus:outline-none"
      />
    </div>
  )
}

function BookingField({
  q,
  value,
  onChange,
  name,
  email,
}: {
  q: Question
  value: string
  onChange: (v: Answer | undefined) => void
  name?: string
  email?: string
}) {
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin === 'https://calendly.com' && (e.data as { event?: string })?.event === 'calendly.event_scheduled')
        onChange('confirmed')
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onChange])
  const url = q.defaultValue
  if (!url || !/^https:\/\/calendly\.com\//i.test(url)) {
    return (
      <p className="rounded-xl border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
        El calendario aún no está configurado.
      </p>
    )
  }
  const qs = new URLSearchParams({
    embed_type: 'Inline',
    embed_domain: typeof window === 'undefined' ? '' : window.location.hostname,
    hide_gdpr_banner: '1',
  })
  if (name) qs.set('name', name)
  if (email) qs.set('email', email)
  return (
    <div>
      <iframe
        title="Reserva tu llamada"
        src={`${url}${url.includes('?') ? '&' : '?'}${qs}`}
        className="h-[640px] w-full rounded-xl border-2 border-border"
        loading="lazy"
      />
      {value === 'confirmed' && <p className="mt-2 text-sm text-brand-400">Reserva confirmada.</p>}
    </div>
  )
}

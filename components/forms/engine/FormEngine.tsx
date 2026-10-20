'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getPathAnswers, nextStep, pipe, resolveEnding, screenQuestions, walkPath } from '@/lib/forms/logic'
import { validateAnswer } from '@/lib/forms/validation'
import { OTHER_VALUE_PREFIX } from '@/lib/forms/validation'
import type { Answer, Answers, FormConfig, Question } from '@/lib/forms/types'
import { Field } from './Field'

interface EndingView {
  title: string | null
  message: string | null
  ctaLabel: string | null
  ctaUrl: string | null
}

interface Props {
  config: FormConfig
  name: string
  tenant: string
  slug: string
  /** `preview`: el constructor lo usa sin enviar nada ni registrar analítica. */
  mode?: 'live' | 'preview'
  hidden?: Record<string, string>
}

type Stage = 'welcome' | 'question' | 'submitting' | 'ending'
const AUTO_ADVANCE_TYPES = ['singleChoice', 'yesNo', 'rating', 'nps', 'scale', 'dropdown']

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0')

export function FormEngine({ config, name, tenant, slug, mode = 'live', hidden = {} }: Props) {
  const live = mode === 'live'
  const storeKey = `forms:${tenant}:${slug}`
  const [stage, setStage] = useState<Stage>(config.welcome ? 'welcome' : 'question')
  const [answers, setAnswers] = useState<Answers>({})
  const [history, setHistory] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState('')
  const [ending, setEnding] = useState<EndingView | null>(null)
  const [redirect, setRedirect] = useState<{ url: string; delay: number } | null>(null)
  const [dir, setDir] = useState<1 | -1>(1)
  const [company, setCompany] = useState('')
  const submissionId = useRef(uuid())
  const sessionId = useRef(uuid())
  const startedAt = useRef<number>(Date.now())
  const qStart = useRef<number>(Date.now())
  const times = useRef<Record<string, number>>({})
  const maxIdx = useRef(0)
  const done = useRef(false)
  const partialTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const variant = useMemo<'A' | 'B' | undefined>(() => {
    if (!live || !config.abTest || typeof window === 'undefined') return undefined
    const k = `forms:variant:${slug}`
    let v = sessionStorage.getItem(k) as 'A' | 'B' | null
    if (v !== 'A' && v !== 'B') {
      v = Math.random() < 0.5 ? 'A' : 'B'
      sessionStorage.setItem(k, v)
    }
    return v
  }, [live, config.abTest, slug])

  const device = typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop'
  const byId = useMemo(() => new Map(config.questions.map((q) => [q.id, q])), [config.questions])
  const current: Question | undefined = history.length ? byId.get(history[history.length - 1]) : undefined
  const path = useMemo(() => walkPath(config, answers), [config, answers])

  // Respuestas en curso: volver atrás o recargar no pierde nada.
  useEffect(() => {
    if (!live) return
    try {
      const raw = localStorage.getItem(storeKey)
      if (raw) {
        const s = JSON.parse(raw) as { answers: Answers; history: string[]; submissionId: string }
        if (s.history?.length) {
          setAnswers(s.answers ?? {})
          setHistory(s.history.filter((id) => byId.has(id)))
          submissionId.current = s.submissionId || submissionId.current
          setStage('question')
        }
      }
    } catch {
      /* almacenamiento no disponible: se sigue sin persistir */
    }
  }, [live, storeKey, byId])
  useEffect(() => {
    if (!live || done.current || stage === 'ending') return
    try {
      localStorage.setItem(storeKey, JSON.stringify({ answers, history, submissionId: submissionId.current }))
    } catch {
      /* idem */
    }
  }, [live, storeKey, answers, history, stage])

  // Analítica por sesión: foto de estado (una fila por sesión en el servidor).
  const sendSession = useCallback(
    (status: 'viewed' | 'started' | 'completed' | 'abandoned', beacon = false) => {
      if (!live) return
      const utm: Record<string, string> = {}
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) if (hidden[k]) utm[k.slice(4)] = hidden[k]
      let referrerHost: string | undefined
      try {
        referrerHost = document.referrer ? new URL(document.referrer).hostname : undefined
      } catch {
        referrerHost = undefined
      }
      const payload = JSON.stringify({
        sessionId: sessionId.current,
        status,
        lastQuestion: history[history.length - 1],
        maxIndex: maxIdx.current,
        questionTimes: times.current,
        variant,
        device,
        utm,
        referrerHost,
      })
      const url = `/api/${tenant}/evergreen/forms/public/${slug}/session`
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))
      else
        void fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {})
    },
    [live, tenant, slug, history, variant, device, hidden]
  )
  useEffect(() => {
    if (!live) return
    sendSession('viewed')
    const onHide = () => {
      if (!done.current) sendSession('abandoned', true)
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  // Tiempo por pregunta + índice máximo alcanzado.
  useEffect(() => {
    if (!current) return
    qStart.current = Date.now()
    const acc = times.current
    const idx = path.questionIds.indexOf(current.id)
    if (idx > maxIdx.current) maxIdx.current = idx
    return () => {
      acc[current.id] = (acc[current.id] ?? 0) + (Date.now() - qStart.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  const welcome = config.welcome && {
    ...config.welcome,
    title:
      variant && config.abTest?.field === 'title'
        ? variant === 'A'
          ? config.abTest.a
          : config.abTest.b
        : config.welcome.title,
    cta:
      variant && config.abTest?.field === 'cta'
        ? variant === 'A'
          ? config.abTest.a
          : config.abTest.b
        : config.welcome.cta,
  }

  const contactName = config.questions.find((q) => q.semantic === 'contact.name')
  const contactEmail = config.questions.find((q) => q.semantic === 'contact.email')
  const nameVal = contactName ? (answers[contactName.id] as string | undefined) : undefined
  const emailVal = contactEmail ? (answers[contactEmail.id] as string | undefined) : undefined

  const savePartial = useCallback(
    (next: Answers) => {
      if (!live || done.current) return
      if (partialTimer.current) clearTimeout(partialTimer.current)
      partialTimer.current = setTimeout(() => {
        void fetch(`/api/${tenant}/evergreen/forms/public/${slug}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submissionId: submissionId.current,
            answers: getPathAnswers(config, next),
            hidden,
            partial: true,
            variant,
            device,
          }),
        }).catch(() => {})
      }, 1200)
    },
    [live, tenant, slug, config, hidden, variant, device]
  )

  const finish = useCallback(
    async (finalAnswers: Answers) => {
      setStage('submitting')
      setServerError('')
      const clean = getPathAnswers(config, finalAnswers)
      if (!live) {
        const e = resolveEnding(config, clean)
        setEnding({
          title: e?.title ?? null,
          message: e?.message ?? null,
          ctaLabel: e?.ctaLabel ?? null,
          ctaUrl: e?.ctaUrl ?? null,
        })
        setStage('ending')
        return
      }
      try {
        const res = await fetch(`/api/${tenant}/evergreen/forms/public/${slug}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            submissionId: submissionId.current,
            answers: clean,
            hidden,
            variant,
            device,
            durationMs: Date.now() - startedAt.current,
            company,
          }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          errors?: Record<string, string>
          ending?: EndingView
          redirectUrl?: string | null
          redirectDelayMs?: number
        }
        if (!res.ok) {
          if (data.errors) {
            setErrors(data.errors)
            const first = history.find((id) => data.errors![id])
            if (first) setHistory((h) => h.slice(0, h.indexOf(first) + 1))
          }
          setServerError(data.error || 'No se pudo enviar. Inténtalo de nuevo.')
          setStage('question')
          return
        }
        done.current = true
        sendSession('completed')
        try {
          localStorage.removeItem(storeKey)
        } catch {
          /* idem */
        }
        setEnding(data.ending ?? { title: null, message: null, ctaLabel: null, ctaUrl: null })
        if (data.redirectUrl) setRedirect({ url: data.redirectUrl, delay: data.redirectDelayMs ?? 1500 })
        setStage('ending')
      } catch {
        setServerError('Sin conexión. Tu respuesta sigue aquí: inténtalo de nuevo.')
        setStage('question')
      }
    },
    [config, live, tenant, slug, hidden, variant, device, company, history, sendSession, storeKey]
  )

  useEffect(() => {
    if (!redirect) return
    const t = setTimeout(() => window.location.assign(redirect.url), redirect.delay)
    return () => clearTimeout(t)
  }, [redirect])

  const advanceFrom = useCallback(
    (fromId: string | null, nextAnswers: Answers) => {
      if (fromId) {
        const q = byId.get(fromId)
        const err = q ? validateAnswer(q, nextAnswers[fromId]) : null
        if (err) {
          setErrors({ [fromId]: err })
          return
        }
      }
      setErrors({})
      setServerError('')
      const step = nextStep(config, fromId, nextAnswers)
      setDir(1)
      if (step.kind === 'question') {
        setHistory((h) => [...h, step.id])
        setStage('question')
        if (
          nextAnswers &&
          (emailVal || Object.values(nextAnswers).some((v) => typeof v === 'string' && v.includes('@')))
        )
          savePartial(nextAnswers)
      } else {
        void finish(nextAnswers)
      }
    },
    [byId, config, emailVal, finish, savePartial]
  )

  const start = () => {
    startedAt.current = Date.now()
    sendSession('started')
    advanceFrom(null, answers)
  }

  const back = () => {
    setErrors({})
    setDir(-1)
    if (history.length <= 1) {
      setHistory([])
      setStage(config.welcome ? 'welcome' : 'question')
      if (!config.welcome) advanceFrom(null, answers)
      return
    }
    setHistory((h) => h.slice(0, -1))
  }

  const setValue = (id: string, v: Answer | undefined) => setAnswers((a) => ({ ...a, [id]: v }))
  const pick = (q: Question, v: Answer) => {
    const next = { ...answers, [q.id]: v }
    setAnswers(next)
    setErrors({})
    if (AUTO_ADVANCE_TYPES.includes(q.type)) setTimeout(() => advanceFrom(q.id, next), 220)
  }

  // Sin bienvenida: se entra directo a la primera pregunta.
  useEffect(() => {
    if (stage === 'question' && history.length === 0) advanceFrom(null, answers)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, history.length])

  // Teclado: Enter avanza (salvo en textarea), A–H elige opción.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stage === 'welcome' && e.key === 'Enter') return start()
      if (stage !== 'question' || !current) return
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
      if (
        e.key === 'Enter' &&
        t.tagName !== 'TEXTAREA' &&
        t.tagName !== 'SELECT' &&
        !AUTO_ADVANCE_TYPES.includes(current.type)
      ) {
        e.preventDefault()
        advanceFrom(current.id, answers)
      } else if (e.key === 'Enter' && t.tagName === 'TEXTAREA' && (e.metaKey || e.ctrlKey)) {
        advanceFrom(current.id, answers)
      } else if (
        !typing &&
        /^[a-hA-H]$/.test(e.key) &&
        ['singleChoice', 'multiChoice', 'yesNo'].includes(current.type)
      ) {
        const list = current.type === 'yesNo' ? ['yes', 'no'] : (current.options ?? []).map((o) => o.value)
        const v = list[e.key.toUpperCase().charCodeAt(0) - 65]
        if (v === undefined) return
        if (current.type === 'multiChoice') {
          const arr = Array.isArray(answers[current.id]) ? (answers[current.id] as string[]) : []
          setValue(current.id, arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])
        } else pick(current, v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const total = Math.max(path.questionIds.length, 1)
  const position = current ? Math.max(path.questionIds.indexOf(current.id), 0) + 1 : 0
  const progress = stage === 'ending' ? 100 : stage === 'welcome' ? 0 : Math.round(((position - 1) / total) * 100)
  const anim = cn('animate-in fade-in duration-300', dir === 1 ? 'slide-in-from-right-8' : 'slide-in-from-left-8')

  const isLast = current ? nextStep(config, current.id, answers).kind === 'ending' : false
  const needsButton = current && !AUTO_ADVANCE_TYPES.includes(current.type)
  const title = current ? pipe(current.title, config, answers) : ''

  return (
    <div
      className={cn(
        'relative bg-background text-foreground',
        live ? 'min-h-screen' : 'min-h-[620px] overflow-hidden',
        config.theme?.mode === 'dark' && 'dark'
      )}
      data-form-engine
    >
      <div
        className={cn(live ? 'fixed' : 'absolute', 'left-0 top-0 z-10 h-1.5 w-full bg-muted')}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-brand-500 transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      {config.theme?.logoUrl && stage !== 'ending' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={config.theme.logoUrl} alt={name} className="absolute right-4 top-6 h-8 w-auto" />
      )}

      <div
        className={cn(
          'mx-auto flex max-w-2xl flex-col justify-center px-5 py-16',
          live ? 'min-h-screen' : 'min-h-[620px]'
        )}
        style={{ paddingBottom: 'max(4rem, env(safe-area-inset-bottom))' }}
      >
        {/* Honeypot: invisible para personas. */}
        <input
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          name="company"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />

        {stage === 'welcome' && welcome && (
          <div key="welcome" className={anim}>
            {welcome.kicker && (
              <span className="mb-4 inline-block rounded-full bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-400">
                {welcome.kicker}
              </span>
            )}
            <h1 className="font-display text-[clamp(1.9rem,6vw,3rem)] font-bold leading-tight tracking-tight">
              {welcome.title}
            </h1>
            {welcome.subtitle && <p className="mt-4 text-lg text-muted-foreground">{welcome.subtitle}</p>}
            <button
              type="button"
              onClick={start}
              className="mt-8 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-brand-600 px-8 text-base font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-500 active:scale-95"
            >
              {welcome.cta} <ArrowRight className="h-4 w-4" />
            </button>
            {welcome.estimatedTime && <p className="mt-3 text-sm text-muted-foreground">{welcome.estimatedTime}</p>}
          </div>
        )}

        {stage === 'question' && current && (
          <div key={current.id} className={anim}>
            <div className="mb-6 flex items-center justify-between text-sm text-muted-foreground">
              <button
                type="button"
                onClick={back}
                className="inline-flex items-center gap-1 hover:text-foreground"
                aria-label="Volver"
              >
                <ArrowLeft className="h-4 w-4" /> Atrás
              </button>
              <span aria-live="polite">
                Pregunta {position} de {total}
              </span>
            </div>
            <h2 className="font-display text-[clamp(1.6rem,5vw,2.4rem)] font-bold leading-tight tracking-tight">
              {title}
              {current.required && (
                <span className="ml-1 text-brand-400" aria-hidden="true">
                  *
                </span>
              )}
            </h2>
            {current.help && <p className="mt-2 text-muted-foreground">{pipe(current.help, config, answers)}</p>}
            <div className="mt-6">
              {current.type === 'statement' ? null : (
                <Field
                  q={current}
                  value={answers[current.id]}
                  onChange={(v) => setValue(current.id, v)}
                  onPick={(v) => pick(current, v)}
                  error={errors[current.id]}
                  name={nameVal}
                  email={emailVal}
                />
              )}
              {(errors[current.id] || serverError) && (
                <p role="alert" className="mt-3 text-sm text-red-500">
                  {errors[current.id] || serverError}
                </p>
              )}
            </div>
            {(needsButton || current.type === 'statement') && (
              <div className="mt-8 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => advanceFrom(current.id, answers)}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-500 active:scale-95"
                >
                  {isLast ? 'Enviar' : 'Continuar'} <ArrowRight className="h-4 w-4" />
                </button>
                {current.type !== 'longText' && (
                  <span className="hidden text-xs text-muted-foreground sm:inline">pulsa Enter</span>
                )}
              </div>
            )}
          </div>
        )}

        {stage === 'submitting' && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground" role="status">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p>Enviando…</p>
          </div>
        )}

        {stage === 'ending' && (
          <div key="ending" className="animate-in fade-in zoom-in-95 duration-500 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-brand-500" />
            <h2 className="mt-5 font-display text-3xl font-bold">{ending?.title || '¡Gracias!'}</h2>
            {ending?.message && <p className="mt-3 text-lg text-muted-foreground">{ending.message}</p>}
            {(redirect?.url || (ending?.ctaUrl && ending.ctaLabel)) && (
              <a
                href={redirect?.url ?? ending!.ctaUrl!}
                className="mt-6 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-brand-600 px-7 font-semibold text-white hover:bg-brand-500"
              >
                {ending?.ctaLabel || 'Continuar'} <ArrowRight className="h-4 w-4" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export { screenQuestions, OTHER_VALUE_PREFIX }

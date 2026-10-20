// Webhooks salientes de formularios: cada respuesta completada se envía firmada (HMAC-SHA256) a las
// URLs configuradas. Primer intento al recibir la respuesta (en segundo plano, sin retrasar al
// visitante); los fallos se reintentan con backoff desde el cron diario ya existente (sin añadir
// crons: límite de Vercel Hobby) o a mano desde Ajustes.

import { createHmac, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret } from '@/lib/config'
import { formConfigSchema } from './schema'

export const WEBHOOK_TIMEOUT_MS = 8000
export const MAX_ATTEMPTS = 5
// Espera tras el intento N (1-based): 5 min, 30 min, 2 h, 12 h.
const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 3600_000, 12 * 3600_000]

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('hex')}`

/** `t=<unix>,v1=<hex>`; el receptor recalcula HMAC(secret, `${t}.${cuerpo}`) y compara. */
export function signBody(secret: string, body: string, ts = Math.floor(Date.now() / 1000)): string {
  return `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`
}

/** Solo https y nunca hosts internos: un webhook no puede usarse para sondear la red de la plataforma. */
export function isSafeWebhookUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const h = u.hostname.toLowerCase()
  if (
    !h.includes('.') ||
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.localhost')
  )
    return false
  if (/^\[/.test(h) || /^\d+$/.test(h)) return false
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    )
      return false
  }
  return true
}

/** IP no enrutable públicamente (privada, loopback, link-local, ULA, mapeada IPv4). */
export function isPrivateIp(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) ip = mapped[1]
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  const l = ip.toLowerCase()
  return (
    l === '::' ||
    l === '::1' ||
    l.startsWith('fc') ||
    l.startsWith('fd') ||
    l.startsWith('fe8') ||
    l.startsWith('fe9') ||
    l.startsWith('fea') ||
    l.startsWith('feb')
  )
}

/** `isSafeWebhookUrl` es léxica: un dominio que resuelve a una IP interna (p. ej. *.nip.io) la burlaría. */
export async function resolvesToPublicIp(raw: string): Promise<boolean> {
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, '')
    if (isIP(host)) return !isPrivateIp(host)
    const addrs = await lookup(host, { all: true })
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address))
  } catch {
    return false
  }
}

export interface ResponseForPayload {
  id: string
  submission_id: string
  version_id: string
  answers: Record<string, unknown>
  hidden: Record<string, unknown>
  score: number | null
  temperature: string | null
  tags: string[] | null
  rating: number | null
  nps: number | null
  teacher: string | null
  module: string | null
  class_name: string | null
  outcome: string | null
  contact_id: string | null
  completed_at: string | null
}

export function buildPayload(
  form: { id: string; name: string; slug: string },
  r: ResponseForPayload,
  questions: { id: string; title: string; options?: { value: string; label: string }[] }[]
) {
  return {
    event: 'form.response.completed',
    form: { id: form.id, name: form.name, slug: form.slug },
    response: {
      id: r.id,
      submissionId: r.submission_id,
      completedAt: r.completed_at,
      outcome: r.outcome,
      score: r.score,
      temperature: r.temperature,
      tags: r.tags ?? [],
      rating: r.rating,
      nps: r.nps,
      teacher: r.teacher,
      module: r.module,
      class: r.class_name,
      contactId: r.contact_id,
      hidden: r.hidden ?? {},
      answers: questions
        .filter((q) => r.answers && q.id in r.answers)
        .map((q) => {
          const v = r.answers[q.id]
          const label = (x: unknown) =>
            typeof x === 'string' ? (q.options?.find((o) => o.value === x)?.label ?? x) : x
          return { id: q.id, question: q.title, value: Array.isArray(v) ? v.map(label) : label(v), raw: v }
        }),
    },
  }
}

async function post(
  url: string,
  secretEnc: string,
  body: string
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  try {
    if (!(await resolvesToPublicIp(url))) return { ok: false, status: null, error: 'Destino no permitido' }
    const secret = decryptSecret(secretEnc)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FormsWebhook/1.0',
        'X-Form-Signature': signBody(secret, body),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
    }
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error ? e.message.slice(0, 200) : 'Error de red' }
  }
}

interface DeliveryRow {
  id: string
  attempts: number
  webhook_id: string
  response_id: string
}
interface WebhookRow {
  id: string
  url: string
  secret_enc: string
}

async function attempt(sb: SupabaseClient, tenantId: string, d: DeliveryRow, w: WebhookRow, body: string) {
  const r = await post(w.url, w.secret_enc, body)
  const attempts = d.attempts + 1
  const failedForGood = !r.ok && attempts >= MAX_ATTEMPTS
  await sb
    .from('form_webhook_deliveries')
    .update({
      status: r.ok ? 'delivered' : failedForGood ? 'failed' : 'pending',
      attempts,
      last_status_code: r.status,
      last_error: r.error,
      next_attempt_at:
        r.ok || failedForGood
          ? null
          : new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]).toISOString(),
      delivered_at: r.ok ? new Date().toISOString() : null,
    })
    .eq('tenant_id', tenantId)
    .eq('id', d.id)
  return r
}

async function loadContext(sb: SupabaseClient, tenantId: string, responseId: string) {
  const { data: r } = await sb
    .from('form_responses')
    .select(
      'id, form_id, submission_id, version_id, answers, hidden, score, temperature, tags, rating, nps, teacher, module, class_name, outcome, contact_id, completed_at'
    )
    .eq('tenant_id', tenantId)
    .eq('id', responseId)
    .maybeSingle()
  if (!r) return null
  const [{ data: form }, { data: v }] = await Promise.all([
    sb.from('forms').select('id, name, slug').eq('tenant_id', tenantId).eq('id', r.form_id).maybeSingle(),
    sb.from('form_versions').select('config').eq('tenant_id', tenantId).eq('id', r.version_id).maybeSingle(),
  ])
  const cfg = v ? formConfigSchema.safeParse(v.config) : null
  if (!form) return null
  return {
    form,
    body: JSON.stringify(buildPayload(form, r as ResponseForPayload, cfg?.success ? cfg.data.questions : [])),
  }
}

/** Primer intento de todos los webhooks activos del formulario para una respuesta completada. */
export async function enqueueAndDeliver(sb: SupabaseClient, tenantId: string, formId: string, responseId: string) {
  const { data: hooks } = await sb
    .from('form_webhooks')
    .select('id, url, secret_enc')
    .eq('tenant_id', tenantId)
    .eq('form_id', formId)
    .eq('active', true)
  if (!hooks?.length) return
  const ctx = await loadContext(sb, tenantId, responseId)
  if (!ctx) return
  for (const w of hooks as WebhookRow[]) {
    const { data: d } = await sb
      .from('form_webhook_deliveries')
      .upsert(
        {
          tenant_id: tenantId,
          webhook_id: w.id,
          response_id: responseId,
          status: 'pending',
          next_attempt_at: new Date().toISOString(),
        },
        { onConflict: 'webhook_id,response_id', ignoreDuplicates: true }
      )
      .select('id, attempts, webhook_id, response_id')
      .maybeSingle()
    if (d) await attempt(sb, tenantId, d as DeliveryRow, w, ctx.body)
  }
}

/** Reintenta entregas pendientes vencidas (cron diario). Devuelve cuántas se intentaron. */
export async function sweepPendingDeliveries(sb: SupabaseClient, deadlineMs: number, limit = 25): Promise<number> {
  const { data: due } = await sb
    .from('form_webhook_deliveries')
    .select('id, tenant_id, attempts, webhook_id, response_id')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at')
    .limit(limit)
  let done = 0
  for (const d of (due ?? []) as (DeliveryRow & { tenant_id: string })[]) {
    if (Date.now() > deadlineMs - WEBHOOK_TIMEOUT_MS) break
    const { data: w } = await sb
      .from('form_webhooks')
      .select('id, url, secret_enc, active')
      .eq('tenant_id', d.tenant_id)
      .eq('id', d.webhook_id)
      .maybeSingle()
    if (!w || !w.active) {
      await sb
        .from('form_webhook_deliveries')
        .update({ status: 'failed', last_error: 'Webhook eliminado o desactivado', next_attempt_at: null })
        .eq('tenant_id', d.tenant_id)
        .eq('id', d.id)
      continue
    }
    const ctx = await loadContext(sb, d.tenant_id, d.response_id)
    if (!ctx) continue
    await attempt(sb, d.tenant_id, d, w as WebhookRow, ctx.body)
    done++
  }
  return done
}

/** Envío de prueba con datos de ejemplo (no crea entrega ni respuesta). */
export async function sendTest(secretEnc: string, url: string, form: { id: string; name: string; slug: string }) {
  const body = JSON.stringify({
    event: 'form.test',
    form,
    response: {
      id: 'test',
      answers: [{ id: 'pregunta', question: 'Pregunta de ejemplo', value: 'Respuesta de ejemplo' }],
    },
  })
  return post(url, secretEnc, body)
}

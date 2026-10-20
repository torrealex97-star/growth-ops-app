import { createHash } from 'node:crypto'
import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getConfigValue } from '@/lib/forms/config-vars'
import { getOrCreateContact } from '@/lib/contacts/resolve'
import { buscarContactoPorEmail } from '@/lib/contacts/buscar'
import { safeRedirectUrl } from '@/lib/forms/logic'
import { evaluateSubmission } from '@/lib/forms/submission'
import { loadPublishedForm, serviceClient } from '@/lib/forms/server'
import { enqueueAndDeliver } from '@/lib/forms/webhooks'
import { ipDe, limitar } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'

const HIDDEN_KEY = /^[a-zA-Z0-9_]{1,40}$/
function sanitizeHidden(raw: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw ?? {}).slice(0, 60)) {
    if (HIDDEN_KEY.test(k) && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 500)
  }
  return out
}

const MAX_BODY_BYTES = 100_000
const MIN_COMPLETE_MS = 800

const body = z.object({
  submissionId: z.string().uuid(),
  answers: z.record(z.string(), z.union([z.string().max(5000), z.number(), z.boolean(), z.array(z.string().max(300)).max(60)])),
  // Parámetros de la URL: son de terceros (fbclid, gclid…), así que se SANEAN en lugar de rechazar el envío.
  hidden: z.record(z.string(), z.unknown()).optional(),
  partial: z.boolean().optional(),
  variant: z.enum(['A', 'B']).optional(),
  device: z.enum(['mobile', 'desktop']).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  // Honeypot: un humano no ve este campo. Si viene relleno se responde "ok" y no se guarda nada.
  company: z.string().max(200).optional(),
})

// Envío PÚBLICO (parcial o final) de un formulario. Idempotente por `submissionId`: reenviar el
// mismo envío (doble clic, reintento, recarga) nunca crea una segunda respuesta ni repite efectos.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; slug: string }> }) {
  const { tenant, slug } = await params
  const ip = ipDe(req.headers)
  const limite = limitar(`forms:sub:${ip}:${slug}`, 30, 60_000)
  if (!limite.ok) {
    return NextResponse.json({ error: 'Demasiados envíos. Inténtalo en un minuto.' }, { status: 429, headers: { 'Retry-After': String(limite.reintentarEnSeg) } })
  }

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Envío demasiado grande' }, { status: 413 })
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })
  }
  const parsed = body.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })
  const b = parsed.data
  const hiddenClean = sanitizeHidden(b.hidden)

  if (b.company && b.company.trim() !== '') return NextResponse.json({ ok: true, completed: !b.partial })
  if (!b.partial && b.durationMs !== undefined && b.durationMs < MIN_COMPLETE_MS) {
    return NextResponse.json({ ok: true, completed: true })
  }

  const sb = serviceClient()
  const loaded = await loadPublishedForm(sb, tenant, slug)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { form } = loaded

  const { data: existing } = await sb
    .from('form_responses')
    .select('id, status')
    .eq('tenant_id', form.tenantId)
    .eq('submission_id', b.submissionId)
    .maybeSingle()

  const vars: Record<string, string | undefined> = {}
  if (JSON.stringify(form.config).match(/\{\{\s*trustpilot_url\s*\}\}/)) {
    vars.trustpilot_url = await getConfigValue(form.tenantId, 'TRUSTPILOT_REVIEW_URL')
  }

  const ev = evaluateSubmission(form.config, { answers: b.answers, hidden: hiddenClean, partial: b.partial, vars })
  if (!ev.ok) return NextResponse.json({ error: 'Revisa las respuestas', errors: ev.errors }, { status: 422 })

  const ending = ev.ending && {
    id: ev.ending.id,
    title: ev.endingTitle,
    message: ev.endingMessage,
    ctaLabel: ev.ending.ctaLabel ?? null,
    ctaUrl: safeRedirectUrl(ev.ending.ctaUrl),
  }
  const outcome = { ok: true, completed: !b.partial, ending: b.partial ? null : ending, redirectUrl: b.partial ? null : ev.redirectUrl, redirectDelayMs: ev.ending?.redirectDelayMs ?? 1500 }

  // Ya completado: respuesta idéntica, sin volver a escribir ni a tocar contactos.
  if (existing?.status === 'completed') return NextResponse.json(outcome)

  // Contacto: captación/cualificación de clientes lo crea o encuentra; feedback de alumnos solo
  // lo empareja (no se da de alta a nadie por opinar); candidaturas de empleados NO crean contacto.
  let contactId: string | null = null
  const sem = ev.semantic
  if (!b.partial) {
    if ((form.audience === 'captacion' || form.audience === 'cualificacion') && (sem.email || sem.phone)) {
      const r = await getOrCreateContact(sb, form.tenantId, {
        email: sem.email,
        phone: sem.phone,
        fullName: sem.name,
        leadChannel: `formulario - ${form.name}`.slice(0, 120),
      })
      if (r.ok) contactId = r.contact.id
    } else if (form.audience === 'alumnos' && sem.email) {
      // Solo se EMPAREJA la respuesta con el alumno. El NPS NO se escribe en `contacts`: el envío es
      // anónimo (basta conocer un email) y `contacts.nps` es un único valor editable a mano; pisarlo
      // desde aquí corrompería las métricas. La opinión queda en form_responses (formulario, módulo,
      // clase, profesor, nps, rating) y se explota segmentada en Alumnos › Feedback.
      contactId = await buscarContactoPorEmail(sb, form.tenantId, sem.email)
    }
  }

  const now = new Date().toISOString()
  const row = {
      tenant_id: form.tenantId,
      form_id: form.formId,
      version_id: form.versionId,
      submission_id: b.submissionId,
      status: b.partial ? 'partial' : 'completed',
      answers: ev.answers,
      hidden: ev.hidden,
      score: ev.score?.score ?? null,
      temperature: ev.score?.temperature ?? null,
      tags: ev.score?.tag ? [ev.score.tag] : [],
      rating: sem.rating,
      nps: sem.nps,
      teacher: sem.teacher,
      module: sem.module,
      class_name: sem.class,
      outcome: b.partial ? null : ev.endingId,
      variant: b.variant ?? null,
      contact_id: contactId,
      device: b.device ?? null,
      duration_ms: b.durationMs ?? null,
      ip_hash: createHash('sha256').update(`${form.tenantId}:${ip}`).digest('hex').slice(0, 32),
      completed_at: b.partial ? null : now,
    }
  // Un parcial nunca degrada una respuesta ya completada (carrera entre el parcial y el envío final).
  const { data: saved, error } = b.partial
    ? existing
      ? await sb
          .from('form_responses')
          .update(row)
          .eq('tenant_id', form.tenantId)
          .eq('submission_id', b.submissionId)
          .neq('status', 'completed')
          .select('id')
          .maybeSingle()
      : await sb
          .from('form_responses')
          .upsert(row, { onConflict: 'tenant_id,submission_id', ignoreDuplicates: true })
          .select('id')
          .maybeSingle()
    : await sb.from('form_responses').upsert(row, { onConflict: 'tenant_id,submission_id' }).select('id').single()
  if (error) {
    console.error('[forms/submit] no se pudo guardar:', error.message)
    return NextResponse.json({ error: 'No se pudo guardar tu respuesta. Inténtalo de nuevo.' }, { status: 500 })
  }

  // Webhooks salientes: primer intento en segundo plano, sin retrasar la respuesta al visitante.
  if (!b.partial && saved?.id) {
    const responseId = saved.id as string
    after(() => enqueueAndDeliver(sb, form.tenantId, form.formId, responseId).catch((e) => console.error('[forms/webhook]', e)))
  }

  return NextResponse.json(outcome)
}

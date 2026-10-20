import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { csvCell, toCsv } from '../lib/forms/csv.ts'
import { INTEGRATION_GROUPS } from '../lib/integrations-catalog.ts'
import { buildPayload, isSafeWebhookUrl, signBody } from '../lib/forms/webhooks.ts'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')
const API = 'app/api/[tenant]/evergreen/forms'

test('firma HMAC: el receptor puede verificarla con t y el cuerpo', () => {
  const sig = signBody('whsec_x', '{"a":1}', 1700000000)
  const esperado = createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex')
  assert.equal(sig, `t=1700000000,v1=${esperado}`)
  assert.notEqual(signBody('otro', '{"a":1}', 1700000000), sig)
})

test('un webhook no puede apuntar a la red interna ni a http', () => {
  for (const ok of ['https://hooks.example.com/x', 'https://api.zapier.com/hooks/1'])
    assert.equal(isSafeWebhookUrl(ok), true, ok)
  for (const mal of [
    'http://example.com',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://172.16.0.1/x',
    'https://169.254.169.254/latest',
    'https://intranet.internal/x',
    'https://user:pw@example.com/x',
    'ftp://x.com',
    'https://[::1]/x',
    'no es una url',
  ]) {
    assert.equal(isSafeWebhookUrl(mal), false, mal)
  }
})

test('el payload lleva las preguntas con su etiqueta y el valor bruto', () => {
  const p = buildPayload(
    { id: 'f1', name: 'Feedback', slug: 'feedback' },
    {
      id: 'r1',
      submission_id: 's1',
      version_id: 'v1',
      answers: { profe: 'a', estrellas: 5 },
      hidden: { utm_source: 'ig' },
      score: null,
      temperature: null,
      tags: [],
      rating: 5,
      nps: null,
      teacher: 'Ana',
      module: null,
      class_name: null,
      outcome: 'resena',
      contact_id: null,
      completed_at: '2026-10-01T10:00:00Z',
    },
    [
      { id: 'profe', title: 'Profesor', options: [{ value: 'a', label: 'Ana' }] },
      { id: 'estrellas', title: 'Valoración' },
    ]
  )
  assert.equal(p.event, 'form.response.completed')
  assert.deepEqual(p.response.answers[0], { id: 'profe', question: 'Profesor', value: 'Ana', raw: 'a' })
  assert.equal(p.response.rating, 5)
  assert.deepEqual(p.response.hidden, { utm_source: 'ig' })
})

test('CSV: BOM, separador ; y sin inyección de fórmulas', () => {
  assert.ok(csvCell('=HYPERLINK("x")').includes("'=HYPERLINK"))
  assert.equal(csvCell('+34600'), "'+34600")
  assert.equal(csvCell('a;b'), '"a;b"')
  assert.equal(csvCell('di "hola"'), '"di ""hola"""')
  assert.equal(csvCell(['a', 'b']), 'a, b')
  assert.equal(csvCell(null), '')
  const csv = toCsv([
    ['a', 'b'],
    [1, 'x'],
  ])
  assert.ok(csv.startsWith('﻿'))
  assert.equal(csv.slice(1), 'a;b\n1;x')
})

test('Trustpilot está en Integraciones por subcuenta, con guía y sin secreto', () => {
  const g = INTEGRATION_GROUPS.find((x) => x.id === 'trustpilot')
  assert.ok(g)
  assert.ok(g.pasos.length >= 2 && g.pasos.every((p) => p.detalle.length >= 30))
  assert.deepEqual(
    g.fields.map((f) => [f.key, f.secret]),
    [['TRUSTPILOT_REVIEW_URL', false]]
  )
  assert.match(leer('app/api/[tenant]/evergreen/forms/public/[slug]/submit/route.ts'), /'TRUSTPILOT_REVIEW_URL'/)
})

test('respuestas: lectura por rol, revisar sin borrar, borrar solo admin/director, exportación acotada', () => {
  const r = leer(`${API}/[id]/responses/route.ts`)
  assert.match(r, /authorizeForms\(tenant, false\)/)
  assert.match(r, /EXPORT_MAX = 5000/)
  const rid = leer(`${API}/[id]/responses/[rid]/route.ts`)
  assert.match(rid, /\['admin', 'director', 'manager', 'marketing'\]/)
  assert.match(rid, /DELETE[\s\S]*\['admin', 'director'\]/)
  assert.match(rid, /eq\('tenant_id', auth\.tenantId\)[\s\S]*?eq\('form_id', id\)/)
})

test('analítica con ventana y topes (egress) y solo columnas necesarias', () => {
  const a = leer(`${API}/[id]/analytics/route.ts`)
  assert.match(a, /MAX_SESSIONS = 5000/)
  assert.match(a, /MAX_RESPONSES = 2000/)
  assert.doesNotMatch(a, /select\('\*'\)/)
})

test('webhooks: solo admin/director, secreto cifrado y mostrado una vez, URL pública y https', () => {
  const w = leer(`${API}/[id]/webhooks/route.ts`)
  assert.match(w, /ADMIN = \['admin', 'director'\]/)
  assert.match(w, /encryptSecret\(secret\)/)
  assert.match(w, /isSafeWebhookUrl\(b\.data\.url\)/)
  assert.doesNotMatch(w, /select\([^)]*secret_enc/)
  assert.match(leer(`${API}/[id]/webhooks/[wid]/test/route.ts`), /isSafeWebhookUrl/)
})

test('el primer intento va en segundo plano y los reintentos cuelgan del cron diario ya existente', () => {
  assert.match(leer(`${API}/public/[slug]/submit/route.ts`), /after\(\(\) => enqueueAndDeliver/)
  const cron = leer('app/api/[tenant]/evergreen/cron/reminders/route.ts')
  assert.match(cron, /sweepPendingDeliveries/)
  // Sin añadir crons nuevos (límite Hobby).
  const vercel = JSON.parse(leer('vercel.json'))
  assert.equal(vercel.crons.length <= 2, true)
})

test('las 5 pestañas del detalle tienen página real', () => {
  for (const p of ['constructor', 'respuestas', 'analitica', 'compartir', 'ajustes']) {
    assert.ok(readFileSync(join(raiz, `app/[tenant]/marketing/formularios/[id]/${p}/page.tsx`), 'utf8').length > 200, p)
  }
  const l = leer('app/[tenant]/marketing/formularios/[id]/layout.tsx')
  for (const t of ['Constructor', 'Respuestas', 'Analítica', 'Compartir', 'Ajustes']) assert.ok(l.includes(`'${t}'`), t)
})

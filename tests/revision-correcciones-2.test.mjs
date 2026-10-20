import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ensureWebhookSubscription } from '../lib/calendly.ts'

const leer = (p) => readFileSync(p, 'utf8')
const CB = 'https://app.example.com/api/t/evergreen/webhooks/calendly'

function calendlyFalso(paginas) {
  const llamadas = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    llamadas.push({ u, metodo: init?.method ?? 'GET' })
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status })
    if (u.endsWith('/users/me')) return json({ resource: { current_organization: 'org1', uri: 'u1' } })
    if (u.includes('/webhook_subscriptions') && (init?.method ?? 'GET') === 'GET') {
      const token = new URL(u).searchParams.get('page_token')
      const i = token ? Number(token) : 0
      const sig = paginas[i + 1] ? { next_page_token: String(i + 1) } : {}
      return json({ collection: paginas[i], pagination: sig })
    }
    if ((init?.method ?? '') === 'POST') {
      return json({ resource: { uri: 'nueva', callback_url: CB, state: 'active', signing_key: 'K' } }, 201)
    }
    return json({}, 200)
  }
  return { llamadas, restaurar: () => (globalThis.fetch = original) }
}

test('Calendly: encuentra la suscripción existente aunque esté en la segunda página (no duplica)', async () => {
  const sub = (n, cb) => ({ uri: `s${n}`, callback_url: cb, state: 'active' })
  const f = calendlyFalso([[sub(1, 'https://otro.com/a')], [sub(2, CB)]])
  try {
    const r = await ensureWebhookSubscription('tok-paginas', CB, 'secreto')
    assert.equal(r.accion, 'ya_activa')
    assert.equal(r.uri, 's2')
    assert.equal(f.llamadas.filter((c) => c.metodo === 'POST').length, 0, 'no debe crear otra')
  } finally {
    f.restaurar()
  }
})

test('Calendly: si no existe en ninguna página, la crea', async () => {
  const f = calendlyFalso([[{ uri: 's1', callback_url: 'https://otro.com', state: 'active' }], []])
  try {
    const r = await ensureWebhookSubscription('tok-crear', CB, 'secreto')
    assert.equal(r.accion, 'creada')
    assert.equal(f.llamadas.filter((c) => c.metodo === 'POST').length, 1)
  } finally {
    f.restaurar()
  }
})

test('la migración de contactos limita a closer/setter a contactos con cita y restaura a liderazgo', () => {
  const m = leer('supabase/migrations/20261021100000_contacts_scheduling_scope_solo_con_cita.sql')
  assert.match(m, /ALTER POLICY contacts_select_scope ON public\.contacts/)
  assert.match(m, /OR is_team_scope_allowed\(\)/)
  assert.match(
    m,
    /\(select is_team_scheduling_scope_allowed\(\)\)\s+AND EXISTS \(SELECT 1 FROM appointments a WHERE a\.contact_id = contacts\.id\)/
  )
  // La rama «solo con cita» ya no puede ser un permiso incondicional sobre todos los contactos.
  assert.doesNotMatch(m, /OR is_team_scheduling_scope_allowed\(\) OR/)
  assert.match(m, /is_my_collaborator_row\(id\)/)
})

test('las pestañas de Adquisición solo muestran lo que el rol puede abrir', () => {
  const l = leer('app/[tenant]/marketing/adquisicion/layout.tsx')
  assert.match(l, /allowedPrefixesFor\(rol/)
  assert.match(l, /TABS\.filter\(\(t\) => isAllowedLocation\(zonas, t\.href\)\)/)
})

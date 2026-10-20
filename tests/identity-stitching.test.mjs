import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decidirVinculo, normalizarEmailIdentidad, normalizarTelefonoIdentidad } from '../lib/tracking/identity.ts'
import { aplicarVinculo } from '../lib/tracking/identity-apply.ts'

const base = { contactoActualDelVisitante: null, porEmail: [], porTelefono: [] }

test('un email que casa con un único contacto vincula', () => {
  const d = decidirVinculo({ ...base, email: 'Ana@Ejemplo.com ', porEmail: [{ id: 'c1' }] })
  assert.equal(d.accion, 'vincular')
  assert.equal(d.contactId, 'c1')
  assert.equal(d.metodo, 'email_exacto')
})

test('email y teléfono que apuntan al mismo contacto suben la confianza', () => {
  const d = decidirVinculo({
    ...base,
    email: 'a@b.com',
    phone: '+34600111222',
    porEmail: [{ id: 'c1' }],
    porTelefono: [{ id: 'c1' }],
  })
  assert.equal(d.metodo, 'email_y_telefono')
  assert.ok(d.confianza > 0.95)
})

test('email y teléfono que discrepan van a revisión: no se adivina', () => {
  const d = decidirVinculo({
    ...base,
    email: 'a@b.com',
    phone: '+34600111222',
    porEmail: [{ id: 'c1' }],
    porTelefono: [{ id: 'c2' }],
  })
  assert.equal(d.accion, 'revision')
  assert.equal(d.motivo, 'email_y_telefono_discrepan')
})

test('varios contactos con el mismo email: revisión, nunca vínculo', () => {
  const d = decidirVinculo({ ...base, email: 'a@b.com', porEmail: [{ id: 'c1' }, { id: 'c2' }] })
  assert.equal(d.accion, 'revision')
})

test('primer vínculo gana: un visitante ya enlazado a otro contacto no se reasigna', () => {
  const d = decidirVinculo({
    ...base,
    email: 'a@b.com',
    porEmail: [{ id: 'c2' }],
    contactoActualDelVisitante: 'c1',
  })
  assert.equal(d.accion, 'revision')
  assert.equal(d.motivo, 'visitante_ya_vinculado_a_otro_contacto')
})

test('repetir el mismo vínculo es idempotente', () => {
  const d = decidirVinculo({ ...base, email: 'a@b.com', porEmail: [{ id: 'c1' }], contactoActualDelVisitante: 'c1' })
  assert.equal(d.accion, 'ya_vinculado')
})

test('sin identificador válido o sin coincidencia se omite', () => {
  assert.equal(decidirVinculo({ ...base, email: 'no-es-email' }).accion, 'omitir')
  assert.equal(decidirVinculo({ ...base, email: 'a@b.com' }).motivo, 'sin_contacto_coincidente')
})

test('un teléfono sin prefijo internacional no identifica', () => {
  assert.equal(normalizarTelefonoIdentidad('600111222'), null)
  assert.equal(normalizarTelefonoIdentidad('+34 600 111 222'), '+34600111222')
  assert.equal(normalizarEmailIdentidad('  X@Y.es '), 'x@y.es')
})

// Cliente Supabase mínimo que registra cada operación para verificar tenant y guardas.
function fakeSb({ visitorContact = null, contactsPorEmail = [], touchpoints = 3 } = {}) {
  const log = []
  const from = (tabla) => {
    const op = { tabla, filtros: [], tipo: 'select', payload: null }
    log.push(op)
    const q = {
      select: () => q,
      update: (p) => ((op.tipo = 'update'), (op.payload = p), q),
      insert: (p) => ((op.tipo = 'insert'), (op.payload = p), Promise.resolve({ error: null })),
      eq: (c, v) => (op.filtros.push(['eq', c, v]), q),
      is: (c, v) => (op.filtros.push(['is', c, v]), q),
      limit: () => q,
      maybeSingle: () =>
        Promise.resolve({ data: tabla === 'analytics_visitors' ? { contact_id: visitorContact } : null, error: null }),
      then: (res) => {
        let data = []
        if (tabla === 'contacts') data = op.filtros.some((f) => f[1] === 'email_normalized') ? contactsPorEmail : []
        if (tabla === 'analytics_visitors' && op.tipo === 'update') data = visitorContact ? [] : [{ id: 'v1' }]
        if (tabla === 'analytics_touchpoints' && op.tipo === 'update')
          data = Array.from({ length: touchpoints }, (_, i) => ({ id: `t${i}` }))
        return Promise.resolve({ data, error: null }).then(res)
      },
    }
    return q
  }
  return { sb: { from }, log }
}

test('aplicarVinculo filtra SIEMPRE por tenant, enlaza visitante y toques y audita', async () => {
  const { sb, log } = fakeSb({ contactsPorEmail: [{ id: 'c1' }] })
  const r = await aplicarVinculo({ sb, tenantId: 'T1', visitorId: 'v1', canonicalEventId: 'e1', email: 'a@b.com' })
  assert.equal(r.accion, 'vincular')
  assert.deepEqual(r.hechos, { visitante: true, toques: 3 })
  for (const op of log) {
    assert.ok(
      op.tipo === 'insert' || op.filtros.some((f) => f[1] === 'tenant_id' && f[2] === 'T1'),
      `${op.tabla} sin tenant`
    )
  }
  const visitorUpdate = log.find((o) => o.tabla === 'analytics_visitors' && o.tipo === 'update')
  assert.ok(
    visitorUpdate.filtros.some((f) => f[0] === 'is' && f[1] === 'contact_id'),
    'guarda contra carrera'
  )
  const audit = log.find((o) => o.tabla === 'identity_matches')
  assert.equal(audit.payload.tenant_id, 'T1')
  assert.equal(audit.payload.status, 'confirmed')
  assert.ok(!JSON.stringify(audit.payload).includes('a@b.com'), 'el correo no va en claro en la evidencia')
})

test('aplicarVinculo no escribe nada cuando no hay identificador', async () => {
  const { sb, log } = fakeSb()
  const r = await aplicarVinculo({ sb, tenantId: 'T1', visitorId: 'v1', canonicalEventId: null, email: null })
  assert.equal(r.accion, 'omitir')
  assert.equal(log.length, 0)
})

test('la ingesta llama al stitching solo en eventos de identificación y sin romper la respuesta', () => {
  const r = readFileSync('lib/tracking/normalizar.ts', 'utf8')
  assert.match(r, /IDENTITY_EVENTS = new Set\(\['lead', 'form_submit', 'appointment_booked', 'purchase'\]\)/)
  assert.match(r, /try \{[\s\S]*aplicarVinculo[\s\S]*\} catch/)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { WEBHOOKS_ENTRANTES } from '../lib/webhooks/entrantes.ts'

test('todo webhook entrante dice dónde se crea, dónde va el secreto (dos sitios) y cómo se prueba', () => {
  for (const w of WEBHOOKS_ENTRANTES) {
    assert.ok(w.guia, `${w.id}: falta la guía de conexión`)
    for (const campo of ['donde', 'secreto', 'prueba']) {
      assert.ok(w.guia[campo].trim().length >= 30, `${w.id}: guía.${campo} demasiado corta para ser útil`)
    }
    assert.equal(
      typeof w.guia.secretoLoEligesTu,
      'boolean',
      `${w.id}: dice si el secreto lo eliges tú o lo da el proveedor`
    )
  }
})

test('Typeform: la guía dice dónde se pone el secreto y que se genera aquí', () => {
  const t = WEBHOOKS_ENTRANTES.find((w) => w.id === 'typeform')
  assert.match(t.guia.secreto, /Edit → Add a Secret/)
  assert.match(t.guia.prueba, /View deliveries/)
  assert.equal(t.guia.secretoLoEligesTu, true)
})

test('la ficha enseña la guía, el generador solo cuando el secreto lo eliges tú y qué significa cada respuesta', () => {
  const c = readFileSync('components/integrations/WebhooksEntrantesPanel.tsx', 'utf8')
  assert.match(c, /<GuiaConexionWebhook w=\{w\} \/>/)
  assert.match(c, /g\.secretoLoEligesTu \?/)
  assert.match(c, /crypto\.getRandomValues/)
  for (const codigo of ['200', '401', '404']) assert.ok(c.includes(`«${codigo}»`), `explica el ${codigo}`)
})

test('la API de Integraciones entrega la guía al panel', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/settings/integraciones/route.ts', 'utf8')
  assert.match(r, /guia: webhook\.guia/)
})

test('un webhook que reutiliza el secreto de GHL no ofrece generar uno nuevo (rompería los demás)', () => {
  const porId = Object.fromEntries(WEBHOOKS_ENTRANTES.map((w) => [w.id, w]))
  assert.equal(porId.contratos.guia.secretoLoEligesTu, false)
  // Regla general: quien comparte clave con otro webhook no puede inventarse el secreto por su cuenta.
  for (const w of WEBHOOKS_ENTRANTES) {
    const compartida = WEBHOOKS_ENTRANTES.some((o) => o.id !== w.id && o.auth.configKey === w.auth.configKey)
    if (compartida && w.id !== 'ghl-citas') assert.equal(w.guia.secretoLoEligesTu, false, w.id)
  }
})

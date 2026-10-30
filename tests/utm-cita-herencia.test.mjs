import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { utmDeReservaConContacto } from '../lib/contacts/atribucion.ts'

// UTMs DE LA CITA HEREDADAS DEL ORIGEN DEL CONTACTO (formulario → Calendly).
//
// El payload de la reserva casi nunca repite las UTMs del enlace que trajo al lead (los enlaces
// de booking no las llevan): la cita nacía sin canal en las agendas aunque el contacto tuviera
// su origen capturado en contact_attributions al dejar el formulario (Typeform o propio).
//
// Invariantes: // · La reserva manda por clave; solo se rellenan los huecos con el origen CAPTURADO (no inventado).
//  · El objeto devuelto solo contiene claves con valor: un spread suyo nunca escribe nulls sobre
//    columnas (idempotencia de las re-syncs, misma regla que closer_id).
//  · Un bloque de atribución no se mezcla con el otro (última no se funde con el primer toque).

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

test('la reserva manda por clave y los huecos se rellenan con el origen del contacto', () => {
  assert.deepEqual(
    utmDeReservaConContacto(
      { utm_source: 'calendly', utm_medium: null, utm_campaign: undefined },
      { utm_source: 'instagram-setting', utm_medium: 'cpc', utm_campaign: 'lanzamiento', utm_term: 'COLAB-0001' }
    ),
    { utm_source: 'calendly', utm_medium: 'cpc', utm_campaign: 'lanzamiento', utm_term: 'COLAB-0001' }
  )
})

test('sin contacto (o con reserva completa) el resultado es exactamente lo que trajo la reserva', () => {
  assert.deepEqual(utmDeReservaConContacto({ utm_source: 'app' }, null), { utm_source: 'app' })
  const reserva = { utm_source: 'app', utm_medium: 'cpc', utm_campaign: 'x' }
  assert.deepEqual(
    utmDeReservaConContacto(reserva, { utm_medium: 'otro', utm_campaign: 'otra', utm_term: 'COLAB-0001' }),
    { utm_source: 'app', utm_medium: 'cpc', utm_campaign: 'x', utm_term: 'COLAB-0001' }
  )
})

test('payload vacío + contacto sin atribución → objeto vacío: nada de nulls que borren columnas', () => {
  assert.deepEqual(utmDeReservaConContacto({}, null), {})
  assert.deepEqual(utmDeReservaConContacto({ utm_source: null }, { utm_source: null }), {})
})

test('blancos del payload no bloquean el relleno (legacy payloads traen cadenas vacías)', () => {
  assert.deepEqual(utmDeReservaConContacto({ utm_source: ' ', utm_medium: '' }, { utm_source: 'meta' }), {
    utm_source: 'meta',
  })
})

test('el webhook rellena justo después de resolver el contacto, solo si el payload no trae UTMs', () => {
  const route = leer('app/api/[tenant]/evergreen/webhooks/calendly/route.ts')
  const desde = route.indexOf('const contact = resolved.contact')
  const hasta = route.indexOf('let colaboradorId')
  assert.ok(desde >= 0 && hasta > desde, 'el relleno vive entre el contacto y la atribución')
  const tramo = route.slice(desde, hasta)
  assert.match(tramo, /if \(!hasUtm\) \{/)
  assert.match(tramo, /leerUtmContacto\(sb, tenantId, contact\.id\)/)
  assert.match(tramo, /utmDeReservaConContacto\(utm, origen\.utm\)/)
})

test('la sync por pull hereda el origen con caché por contacto y solo con payload sin UTMs', () => {
  const sync = leer('lib/integrations/citas-sync.ts')
  const calendly = sync.slice(sync.indexOf('export async function syncCalendly'))
  assert.match(calendly, /origenDelContacto = new Map</)
  assert.match(calendly, /origenDelContacto\.has\(contact\.id\)/)
  assert.match(calendly, /Object\.keys\(utmDeCita\)\.length === 0/)
  assert.match(calendly, /utmDeReservaConContacto\(utmDeCita, origen\.utm\)/)
  // La regla no cambia: la reserva con ALGUNA UTM no se completa (sin fuente híbrida).
  const relleno = calendly.slice(calendly.indexOf('RECAÍDA DEL ORIGEN'), calendly.indexOf('const bookingSnapshot'))
  assert.match(relleno, /length === 0/)
})

// ESCRITURAS CIEGAS — barrera anti-regresión.
//
// Regla: un `await` sobre una escritura de Supabase tiene que consumir `{ error }`.
// El escáner (scripts/auditar-escrituras-ciegas.mjs) produce CANDIDATOS con una
// heurística de texto y este test exige que la lista de críticos esté VACÍA.
//
// Si este test falla al tocar código nuevo:
//   1. Si de verdad descartas el `{ error }` de un insert/update/upsert/delete,
//      ES UN ESCRITO CIEGO: compruébalo (throw si el efecto es el resultado, o
//      log con contexto si el efecto ya ocurrió y no se puede deshacer).
//   2. Si es un falso positivo del escáner, arregla el escáner con un caso
//      sintético nuevo aquí abajo; no lo silencies con un comentario si el
//      patrón se repite en el repo.
// No amplíes la lista de excepciones sin auditoría: cada excepción es un fallo
// silencioso aceptado.
//
// Los fixtures usan tablas `demo_*` que no existen en el esquema: así este test
// no alimenta al escáner de columnas fantasma ni al de aislamiento multitenant.

import assert from 'node:assert/strict'
import test from 'node:test'
import { analizarFuente, escanear } from '../scripts/auditar-escrituras-ciegas.mjs'

const tiers = (fuente) => analizarFuente(fuente, 'fixture.ts').map((h) => h.tier)

test('escritura ciega: el valor descartado es crítico', () => {
  const fuente = `
    export async function f(sb: any, id: string) {
      await sb.from('demo_sales').update({ status: 'active' }).eq('id', id)
    }
  `
  assert.deepEqual(tiers(fuente), ['critico'])
})

test('escritura ciega: `const { data }` sin error', () => {
  const fuente = `
    export async function f(sb: any) {
      const { data } = await sb.from('demo_collections').insert({ a: 1 })
      return data
    }
  `
  assert.deepEqual(tiers(fuente), ['sin-error'])
})

test('escritura ciega: el error ligado pero nunca leído', () => {
  const fuente = `
    export async function f(sb: any) {
      const { error } = await sb.from('demo_collections').insert({ a: 1 })
      return 'ok'
    }
  `
  assert.deepEqual(tiers(fuente), ['no-consumido'])
})

test('escritura vigilada: alias del error, ternario y Promise.all', () => {
  const fuente = `
    export async function f(sb: any, editar: boolean) {
      const { error: updError } = editar
        ? await sb.from('demo_rules').update({ a: 1 })
        : await sb.from('demo_rules').insert({ a: 1 })
      if (updError) throw new Error(updError.message)

      const [{ error: uno }, { error: dos }] = await Promise.all([
        sb.from('demo_sales').update({ a: 1 }),
        sb.from('demo_collections').update({ b: 2 }),
      ])
      if (uno || dos) throw new Error('falló')
    }
  `
  assert.deepEqual(tiers(fuente), ['ok', 'ok'])
})

test('escritura vigilada: `.then(({ error }) => …)`, `throwOnError` y `return`', () => {
  const fuente = `
    export async function f(sb: any) {
      await sb
        .from('demo_raw')
        .update({ a: 1 })
        .then(({ error }) => {
          if (error) console.warn(error.message)
        })
      await sb.from('demo_sales').update({ b: 2 }).throwOnError()
      return await sb.from('demo_sales').update({ c: 3 })
    }
  `
  assert.deepEqual(tiers(fuente), ['ok', 'ok', 'propagada'])
})

test('justificación explícita con razón obligatoria', () => {
  const conRazon = `
    export async function f(sb: any) {
      // escritura-ciega-ok: el claim solo pierde carreras, no escribe nada más
      await sb.from('demo_sales').update({ a: 1 })
    }
  `
  const sinRazon = `
    export async function f(sb: any) {
      // escritura-ciega-ok:
      await sb.from('demo_sales').update({ a: 1 })
    }
  `
  assert.deepEqual(tiers(conRazon), ['justificada'])
  assert.deepEqual(tiers(sinRazon), ['critico'])
})

test('no son escrituras de Supabase: Map, googleapis ni callbacks ajenos', () => {
  const fuente = `
    export async function f(sb: any, video: any) {
      const cache = new Map()
      cache.delete('x')
      await video.videos.insert({ media: { body: Readable.from(buffer) } })
      await recordSyncRun(sb, {}, async () => {
        sb.from('demo_defs').update({ a: 1 })
      })
    }
  `
  assert.deepEqual(tiers(fuente), [])
})

test('un rpc de lectura no es una escritura', () => {
  const fuente = `
    export async function f(sb: any) {
      await sb.rpc('is_super_admin')
    }
  `
  assert.deepEqual(tiers(fuente), [])
})

test('barrido del repo: ninguna escritura ciega pendiente', () => {
  const { ficheros, hallazgos, porTier } = escanear()

  // Sanity del propio escáner: un barrido a cero no prueba nada.
  assert.ok(ficheros >= 700, `ficheros escaneados inesperadamente pocos (${ficheros})`)
  assert.ok((porTier.ok ?? 0) >= 400, `escrituras vigiladas inesperadamente pocas (${porTier.ok ?? 0})`)

  const pendientes = hallazgos.filter((h) => ['critico', 'sin-error'].includes(h.tier))
  assert.deepEqual(
    pendientes,
    [],
    `escrituras Supabase sin comprobar { error }:\n  ${pendientes
      .map((h) => `${h.tier} ${h.fichero}:${h.linea} → ${h.tabla ?? '?'} (${h.metodo})`)
      .join('\n  ')}`
  )
})

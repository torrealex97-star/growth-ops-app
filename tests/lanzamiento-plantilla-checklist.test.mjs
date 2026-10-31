import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { limpiarPieza, aplicarPlantilla } from '../lib/launch/contenido.ts'
import { listarMarcados, marcarItem } from '../lib/launch/checklist.ts'
import {
  CHECKLIST,
  CLAVES_CHECKLIST,
  PLANTILLA_ESTANDAR,
  piezasDePlantilla,
  progresoChecklist,
} from '../lib/launch/plantilla.ts'

test('toda pieza de la plantilla pasa la validación de piezas', () => {
  const piezas = piezasDePlantilla()
  assert.equal(piezas.length, PLANTILLA_ESTANDAR.length)
  for (const p of piezas) assert.doesNotThrow(() => limpiarPieza(p, false), p.titulo)
})

test('la plantilla respeta el calendario tipo: nutrición desde 10 días, recta final, 4 emails el día D', () => {
  const emails = PLANTILLA_ESTANDAR.filter((p) => p.canal === 'email')
  assert.ok(Math.min(...emails.map((e) => e.dia)) <= -10, 'nutrición de al menos 10 días')
  assert.equal(emails.filter((e) => e.dia === 0).length, 4)
  assert.ok(
    emails.some((e) => e.dia === -1),
    'email de recta final el día antes'
  )
  assert.ok(PLANTILLA_ESTANDAR.every((p) => Math.abs(p.dia) <= 60))
})

test('claves del checklist únicas y progreso por fase ignorando claves desconocidas', () => {
  const todas = CHECKLIST.flatMap((f) => f.items.map((i) => i.key))
  assert.equal(new Set(todas).size, todas.length)
  assert.equal(CLAVES_CHECKLIST.size, todas.length)
  const p = progresoChecklist([todas[0], todas[1], 'inventada'])
  assert.equal(p.hecho, 2)
  assert.equal(p.total, todas.length)
  assert.equal(progresoChecklist([]).hecho, 0)
})

function fakeSb({ lanzamientos = [], marcadas = [] } = {}) {
  const llamadas = []
  const tabla = (nombre) => {
    const f = {}
    let op = 'select'
    const q = {
      select: () => q,
      eq: (k, v) => ((f[k] = v), q),
      maybeSingle: async () => ({
        data: lanzamientos.find((l) => l.id === f.id && l.tenant_id === f.tenant_id) ?? null,
      }),
      insert: async (filas) => (llamadas.push({ nombre, op: 'insert', filas }), { error: null }),
      upsert: (fila, opts) => ((op = 'upsert'), llamadas.push({ nombre, op, fila, opts }), q),
      delete: () => ((op = 'delete'), q),
      then: (res) => {
        if (op === 'delete') llamadas.push({ nombre, op, filtros: { ...f } })
        res({ data: marcadas.filter((m) => m.tenant_id === f.tenant_id && m.launch_id === f.launch_id), error: null })
      },
    }
    return q
  }
  return { sb: { from: tabla }, llamadas }
}

test('aplicar plantilla: inserta con el tenant del llamante y solo en un lanzamiento suyo', async () => {
  const { sb, llamadas } = fakeSb({ lanzamientos: [{ id: 'L1', tenant_id: 'T1' }] })
  const n = await aplicarPlantilla(sb, 'T1', 'L1', 'U')
  assert.equal(n, PLANTILLA_ESTANDAR.length)
  const ins = llamadas.find((c) => c.op === 'insert')
  assert.ok(
    ins.filas.every((f) => f.tenant_id === 'T1' && f.launch_id === 'L1' && (f.estado ?? 'pendiente') === 'pendiente')
  )
  await assert.rejects(aplicarPlantilla(sb, 'T2', 'L1', 'U'), /no encontrado/)
})

test('checklist: rechaza ítems inventados, no cruza subcuentas y desmarcar filtra por tenant', async () => {
  const { sb, llamadas } = fakeSb({
    lanzamientos: [{ id: 'L1', tenant_id: 'T1' }],
    marcadas: [
      { tenant_id: 'T1', launch_id: 'L1', item_key: 'webinar-guion' },
      { tenant_id: 'T1', launch_id: 'L1', item_key: 'basura' },
      { tenant_id: 'T2', launch_id: 'L1', item_key: 'diseno-oferta' },
    ],
  })
  assert.deepEqual(await listarMarcados(sb, 'T1', 'L1'), ['webinar-guion'])
  await assert.rejects(marcarItem(sb, 'T1', 'L1', 'nope', true, 'U'), /no válido/)
  await assert.rejects(marcarItem(sb, 'T2', 'L1', 'webinar-guion', true, 'U'), /no encontrado/)
  await marcarItem(sb, 'T1', 'L1', 'webinar-guion', false, 'U')
  const del = llamadas.find((c) => c.op === 'delete')
  assert.equal(del.filtros.tenant_id, 'T1')
  assert.equal(del.filtros.item_key, 'webinar-guion')
})

test('migración y rutas: RLS por tenant y escritura solo admin/director', () => {
  const sql = readFileSync('supabase/migrations/20261031130000_launch_checklist.sql', 'utf8')
  assert.match(sql, /tenant_id\s+UUID NOT NULL REFERENCES public\.tenants/)
  assert.match(sql, /AS RESTRICTIVE/)
  const api = readFileSync('app/api/[tenant]/evergreen/lanzamiento/checklist/route.ts', 'utf8')
  assert.match(api, /\['admin', 'director'\]\.includes/)
  const cont = readFileSync('app/api/[tenant]/evergreen/lanzamiento/contenido/route.ts', 'utf8')
  assert.match(cont, /accion === 'plantilla'/)
})

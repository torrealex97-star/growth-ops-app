import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { copiarContenido, fechaDePieza, limpiarPieza } from '../lib/launch/contenido.ts'

test('validación de piezas: canal, día, hora, enlace y título', () => {
  assert.throws(() => limpiarPieza({ canal: 'tiktok' }, true), /Canal no válido/)
  assert.throws(() => limpiarPieza({ dia: 61 }, true), /entre -60 y 60/)
  assert.throws(() => limpiarPieza({ dia: 1.5 }, true), /entre -60 y 60/)
  assert.throws(() => limpiarPieza({ hora: '9h' }, true), /HH:MM/)
  assert.throws(() => limpiarPieza({ enlace: 'javascript:alert(1)' }, true), /http/)
  assert.throws(() => limpiarPieza({ titulo: '  ' }, false), /título/)
  assert.deepEqual(limpiarPieza({ titulo: ' Hola ', dia: -3, hora: '09:30', canal: 'email' }, false), {
    titulo: 'Hola',
    dia: -3,
    hora: '09:30',
    canal: 'email',
  })
  assert.equal(limpiarPieza({ titulo: 'x'.repeat(500) }, false).titulo.length, 200)
  assert.deepEqual(limpiarPieza({}, true), {}, 'una edición vacía no toca nada')
})

test('fecha real de la pieza = día del evento + día relativo', () => {
  assert.equal(fechaDePieza('2026-10-28', -3), '2026-10-25')
  assert.equal(fechaDePieza('2026-10-28', 0), '2026-10-28')
  assert.equal(fechaDePieza('2026-10-30', 3), '2026-11-02', 'cruza de mes')
  assert.equal(fechaDePieza('2026-10-28', null), null)
  assert.equal(fechaDePieza('basura', 1), null)
})

// Cliente Supabase mínimo en memoria: registra filtros e inserciones.
function fakeSb(piezas, lanzamientos) {
  const inserts = []
  const consulta = (tabla) => {
    const f = {}
    const q = {
      select: () => q,
      eq: (k, v) => ((f[k] = v), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({
        data: lanzamientos.find((l) => l.id === f.id && l.tenant_id === f.tenant_id) ?? null,
      }),
      insert: async (filas) => (inserts.push(filas), { error: null }),
      then: (res) =>
        res({ data: piezas.filter((p) => p.launch_id === f.launch_id && f.tenant_id === 'T1'), error: null }),
    }
    return q
  }
  return { sb: { from: consulta }, inserts }
}

test('copiar: trae la secuencia con los mismos días, en pendiente y con el tenant del llamante', async () => {
  const lanz = [
    { id: 'a', tenant_id: 'T1' },
    { id: 'b', tenant_id: 'T1' },
    { id: 'z', tenant_id: 'T2' },
  ]
  const piezas = [
    {
      id: '1',
      launch_id: 'a',
      tipo: 'publicacion',
      canal: 'email',
      dia: -3,
      hora: '09:00',
      titulo: 'Aviso',
      texto: null,
      enlace: null,
      estado: 'publicado',
    },
  ]
  const { sb, inserts } = fakeSb(piezas, lanz)
  assert.equal(await copiarContenido(sb, 'T1', 'a', 'b', 'U'), 1)
  assert.equal(inserts[0][0].estado, 'pendiente')
  assert.equal(inserts[0][0].dia, -3)
  assert.equal(inserts[0][0].tenant_id, 'T1')
  await assert.rejects(copiarContenido(sb, 'T1', 'a', 'a', 'U'), /otro lanzamiento/)
  await assert.rejects(
    copiarContenido(sb, 'T1', 'a', 'z', 'U'),
    /no encontrado/,
    'no se copia a un lanzamiento de otra subcuenta'
  )
})

test('migración y API: RLS por tenant y escritura solo admin/director', () => {
  const sql = readFileSync('supabase/migrations/20261031120000_launch_content.sql', 'utf8')
  assert.match(sql, /tenant_id\s+UUID NOT NULL REFERENCES public\.tenants/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /AS RESTRICTIVE/)
  const api = readFileSync('app/api/[tenant]/evergreen/lanzamiento/contenido/route.ts', 'utf8')
  assert.match(api, /\['admin', 'director'\]\.includes/)
  assert.match(api, /requireTenant/)
})

test('la pantalla solo ofrece edición a quien puede guardar y descarta respuestas viejas', () => {
  const api = readFileSync('app/api/[tenant]/evergreen/lanzamiento/contenido/route.ts', 'utf8')
  assert.match(api, /puedeEditar: \['admin', 'director'\]/)
  const ui = readFileSync('app/[tenant]/lanzamiento/contenido/page.tsx', 'utf8')
  assert.match(ui, /puedeEditar \? \(/)
  assert.match(ui, /abortPiezas\.current\?\.abort\(\)/)
  assert.match(ui, /confirm\(`Este lanzamiento ya tiene/)
})

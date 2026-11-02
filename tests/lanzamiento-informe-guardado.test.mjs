import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { informeAHtml } from '../lib/launch/informe-html.ts'
import { guardarInforme, leerGuardado, listarGuardados } from '../lib/launch/informe-guardado.ts'

const informe = (o = {}) => ({
  lanzamiento: { label: 'Lanz <b>1</b>', fecha: '2026-10-28' },
  registrados: 1200,
  conEncuesta: 300,
  embudo: [
    { id: 'registrados', etiqueta: 'Registrados', n: 1200, pctSobreAnterior: null, pctSobreRegistrados: 100 },
    { id: 'agendados', etiqueta: 'Agendaron', n: null, pctSobreAnterior: null, pctSobreRegistrados: null },
  ],
  anuncios: [
    {
      anuncio: '<script>alert(1)</script>',
      totalLeads: 40,
      conEncuesta: 20,
      pctBuenos: 55,
      citas: 3,
      veredicto: 'escalar',
    },
  ],
  frenos: { base: 20, items: [{ texto: 'No tengo "tiempo" & dinero', n: 8, pct: 40 }] },
  frases: { base: 0, items: [] },
  faltan: [{ mensaje: 'Sin Meta', solucion: 'Conecta Meta' }],
  acciones: [{ area: 'anuncios', texto: 'Subir «A»', dato: '40 leads' }],
  ...o,
})

test('el HTML exportado escapa todo texto de origen externo y no incluye scripts', () => {
  const html = informeAHtml(informe(), { momento: 'final', generadoAt: '2026-11-01T10:00:00Z' })
  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /Lanz &lt;b&gt;1&lt;\/b&gt;/)
  assert.match(html, /No tengo &quot;tiempo&quot; &amp; dinero/)
  assert.doesNotMatch(html, /<script|https?:\/\//, 'autocontenido: sin scripts ni recursos externos')
})

test('el HTML conserva las reglas de rigor: dato no disponible, bases y vacíos explícitos', () => {
  const html = informeAHtml(informe(), { momento: 'intermedio', generadoAt: '2026-11-01T10:00:00Z' })
  assert.match(html, /Dato no disponible/)
  assert.match(html, /Sobre 20 respuestas/)
  assert.match(html, /Sin frases repetidas/)
  assert.match(html, /Informe intermedio/)
  assert.match(
    informeAHtml(informe({ frenos: { base: 0, items: [] }, acciones: [] }), {
      momento: 'final',
      generadoAt: '2026-11-01T10:00:00Z',
    }),
    /nadie ha contestado/
  )
})

function sb(filas) {
  const log = []
  return {
    log,
    from(t) {
      const f = {}
      let ins = null
      const q = {
        select: () => q,
        eq: (k, v) => ((f[k] = v), q),
        order: () => q,
        limit: () => q,
        insert: (x) => ((ins = x), log.push({ t, ins: x }), q),
        single: async () => ({ data: { id: 'R1' }, error: null }),
        maybeSingle: async () => ({
          data: filas.find((r) => r.id === f.id && r.tenant_id === f.tenant_id) ?? null,
          error: null,
        }),
        then: (res) =>
          res({ data: filas.filter((r) => r.tenant_id === f.tenant_id && r.launch_id === f.launch_id), error: null }),
      }
      return q
    },
  }
}

test('listar y leer informes guardados nunca cruza subcuentas', async () => {
  const filas = [
    { id: 'a', tenant_id: 'T1', launch_id: 'L', momento: 'final', generado_at: '2026-11-01', datos: {} },
    { id: 'b', tenant_id: 'T2', launch_id: 'L', momento: 'final', generado_at: '2026-11-01', datos: {} },
  ]
  const c = sb(filas)
  assert.deepEqual(
    (await listarGuardados(c, 'T1', 'L')).map((x) => x.id),
    ['a']
  )
  assert.equal(await leerGuardado(c, 'T1', 'b'), null)
  assert.equal((await leerGuardado(c, 'T1', 'a')).id, 'a')
})

test('guardar rechaza un momento inválido y un lanzamiento de otra subcuenta', async () => {
  const c = sb([])
  await assert.rejects(guardarInforme(c, 'T1', 'L', 'otro', 'U', {}), /no válido/)
  await assert.rejects(guardarInforme(c, 'T1', 'L', 'final', 'U', {}), /no encontrado/)
  assert.equal(c.log.length, 0, 'no se inserta nada')
})

test('migración y ruta: RLS por tenant, escritura solo admin/director, descarga como adjunto', () => {
  const sql = readFileSync('supabase/migrations/20261101100000_launch_reports.sql', 'utf8')
  assert.match(sql, /tenant_id\s+UUID NOT NULL REFERENCES public\.tenants/)
  assert.match(sql, /AS RESTRICTIVE/)
  assert.match(sql, /momento IN \('intermedio', 'final'\)/)
  const api = readFileSync('app/api/[tenant]/evergreen/lanzamiento/informe/guardados/route.ts', 'utf8')
  assert.match(api, /\['admin', 'director'\]\.includes/)
  assert.match(api, /attachment/)
  assert.match(api, /nosniff/)
})

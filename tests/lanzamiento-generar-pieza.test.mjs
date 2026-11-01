import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { MAX_GUION, construirPrompt, generarPieza, generarTexto, guardarGuion } from '../lib/launch/generar-pieza.ts'

const pieza = (o = {}) => ({ canal: 'email', titulo: 'Nutrición 3', texto: 'Objeción de tiempo', dia: -4, ...o })

test('el prompt fija el guion como fuente, el formato del canal y las reglas de no inventar', () => {
  const { system, user } = construirPrompt({
    guion: 'Creencia única: tu semana tiene huecos.',
    pieza: pieza(),
    lanzamiento: { label: 'Lanz oct', fecha: '2026-10-28' },
  })
  assert.match(system, /FUENTE/)
  assert.match(system, /nunca el CÓMO/)
  assert.match(system, /No inventes cifras/)
  assert.match(user, /4 días antes del evento/)
  assert.match(user, /Asunto/)
  assert.match(user, /tu semana tiene huecos/)
  assert.match(user, /Indicación de lo que toca/)
})

test('formatos distintos por canal y fechas relativas legibles', () => {
  const u = (o) =>
    construirPrompt({ guion: 'g', pieza: pieza(o), lanzamiento: { label: 'L', fecha: '2026-10-28' } }).user
  assert.match(u({ canal: 'encuesta' }), /opción por línea/)
  assert.match(u({ canal: 'stories' }), /stories numeradas/)
  assert.match(u({ dia: 0 }), /el día del evento/)
  assert.match(u({ dia: 2 }), /2 días después/)
  assert.match(u({ dia: null }), /sin día fijado/)
})

test('un guion enorme se recorta antes de mandarlo al modelo', () => {
  const { user } = construirPrompt({
    guion: 'x'.repeat(100_000),
    pieza: pieza(),
    lanzamiento: { label: 'L', fecha: '2026-10-28' },
  })
  assert.ok(user.length < 26_000)
})

test('motor: respeta la clave disponible (Gemini, OpenAI) y cae en el proveedor común si no hay', async () => {
  const llamadas = []
  const dobles = {
    gemini: async (p) => (llamadas.push(['gemini', p.model]), { texto: ' G ' }),
    openai: async (p) => (llamadas.push(['openai', p.model]), { texto: ' O ' }),
    completeText: async () => (llamadas.push(['comun']), { text: ' C ', engine: 'deepseek' }),
  }
  assert.deepEqual(await generarTexto({ GEMINI_API_KEY: 'k' }, { system: 's', user: 'u' }, dobles), {
    texto: ' G ',
    motor: 'gemini',
  })
  assert.equal((await generarTexto({ OPENAI_API_KEY: 'k' }, { system: 's', user: 'u' }, dobles)).motor, 'openai')
  assert.equal((await generarTexto({ DEEPSEEK_API_KEY: 'k' }, { system: 's', user: 'u' }, dobles)).motor, 'deepseek')
  assert.deepEqual(
    llamadas.map((l) => l[0]),
    ['gemini', 'openai', 'comun']
  )
})

function sb({ pieza: p, lanz }) {
  const log = []
  return {
    log,
    from(t) {
      const f = {}
      let upd = null
      const q = {
        select: () => q,
        update: (x) => ((upd = x), log.push({ t, upd: x, f }), q),
        eq: (k, v) => ((f[k] = v), q),
        maybeSingle: async () => {
          if (f.tenant_id !== 'T1') return { data: null, error: null }
          return { data: t === 'launch_content' ? p : lanz, error: null }
        },
      }
      return q
    },
  }
}

test('generar exige el guion, no cruza subcuentas y NO guarda la sugerencia', async () => {
  const dobles = { completeText: async () => ({ text: 'Hola', engine: 'anthropic' }) }
  const base = { launch_id: 'L', canal: 'email', titulo: 'T', texto: null, dia: -3 }
  const con = sb({ pieza: base, lanz: { label: 'L', fecha: '2026-10-28', guion_webinar: 'guion' } })
  assert.deepEqual(await generarPieza(con, 'T1', 'P', {}, dobles), { texto: 'Hola', motor: 'anthropic' })
  assert.equal(con.log.length, 0, 'no escribe nada en la base')
  await assert.rejects(generarPieza(con, 'T2', 'P', {}, dobles), /no encontrada/)
  const sin = sb({ pieza: base, lanz: { label: 'L', fecha: '2026-10-28', guion_webinar: '  ' } })
  await assert.rejects(generarPieza(sin, 'T1', 'P', {}, dobles), /guion del webinar/)
  await assert.rejects(
    generarPieza(con, 'T1', 'P', {}, { completeText: async () => ({ text: '  ', engine: 'x' }) }),
    /no devolvió texto/
  )
})

test('guardar guion: límite de longitud y solo en un lanzamiento de la subcuenta', async () => {
  await assert.rejects(guardarGuion(sb({}), 'T1', 'L', 'x'.repeat(MAX_GUION + 1)), /demasiado largo/)
  await assert.rejects(guardarGuion(sb({ lanz: { id: 'L' } }), 'T2', 'L', 'hola'), /no encontrado/)
  const c = sb({ lanz: { id: 'L' } })
  await guardarGuion(c, 'T1', 'L', '  hola  ')
  assert.equal(c.log[0].upd.guion_webinar, 'hola')
  await guardarGuion(c, 'T1', 'L', '   ')
  assert.equal(c.log[1].upd.guion_webinar, null, 'un guion vacío lo borra')
})

test('ruta y migración: solo admin/director, límite de uso y guion acotado', () => {
  const api = readFileSync('app/api/[tenant]/evergreen/lanzamiento/contenido/route.ts', 'utf8')
  assert.match(api, /accion === 'generar'/)
  assert.match(api, /limitar\(`generar-pieza:\$\{auth\.tenantId\}`/)
  assert.match(api, /guion: \['admin', 'director'\]/)
  const sql = readFileSync('supabase/migrations/20261101110000_launch_guion.sql', 'utf8')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS guion_webinar/)
  assert.match(sql, /<= 60000/)
})

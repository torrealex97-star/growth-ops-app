import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cualificacionDeFormulario } from '../lib/forms/cualificacion.ts'
import { fusionarCualificacion } from '../lib/contacts/cualificacion.ts'

const config = {
  questions: [
    { id: 'n', type: 'shortText', title: 'Nombre', semantic: 'contact.name' },
    { id: 'e', type: 'email', title: 'Tu email', semantic: 'contact.email' },
    { id: 'info', type: 'statement', title: 'Lee esto' },
    {
      id: 'ing',
      type: 'singleChoice',
      title: '¿Cuánto estás generando al mes?',
      options: [
        { value: 'a', label: 'Menos de 1.000 €' },
        { value: 'b', label: 'Más de 1.000 €' },
      ],
    },
    {
      id: 'sit',
      type: 'multiChoice',
      title: 'Situación',
      options: [
        { value: 'x', label: 'Estudiante' },
        { value: 'y', label: 'Emprendedora' },
      ],
    },
    { id: 'ok', type: 'yesNo', title: '¿Puedes invertir?' },
    { id: 'libre', type: 'longText', title: 'Cuéntanos tu caso', semantic: 'qualification.motivo_real' },
    { id: 'vacia', type: 'shortText', title: 'Opcional' },
    { id: 'rgpd', type: 'consent', title: 'Acepto' },
  ],
}

test('la cualificación del formulario usa las etiquetas legibles, las claves conocidas y deja fuera la identidad', () => {
  const q = cualificacionDeFormulario(
    config,
    { n: 'Ana', e: 'ana@x.test', ing: 'b', sit: ['x', 'y'], ok: true, libre: 'Quiero crecer', vacia: '', rgpd: true },
    'F1'
  )
  assert.equal(q.ingresos, 'Más de 1.000 €')
  assert.equal(q.situacion, 'Estudiante, Emprendedora')
  assert.equal(q.inversion, 'Sí')
  assert.equal(q.motivo_real, 'Quiero crecer')
  assert.equal(q.origen, 'formulario')
  assert.equal(q.formulario_id, 'F1')
  const preguntas = q.respuestas.map((r) => r.q)
  assert.deepEqual(preguntas, [
    '¿Cuánto estás generando al mes?',
    'Situación',
    '¿Puedes invertir?',
    'Cuéntanos tu caso',
  ])
  assert.ok(!JSON.stringify(q).includes('ana@x.test'), 'ni el email ni el nombre van a la cualificación')
})

test('sin respuestas de cualificación no se inventa nada', () => {
  assert.deepEqual(cualificacionDeFormulario(config, { n: 'Ana', e: 'ana@x.test' }, 'F1'), {})
})

test('la pregunta de origen con opciones graba la etiqueta bajo la clave estable y admite "Otro"', () => {
  const captacion = {
    questions: [
      {
        id: 'pregunta-1',
        type: 'singleChoice',
        title: '¿De dónde nos has conocido?',
        required: true,
        semantic: 'qualification.origen_contacto',
        options: [
          { value: 'anuncios-meta', label: 'Anuncios en Instagram / Meta', icon: 'megaphone' },
          { value: 'referido', label: 'Me recomendaron', icon: 'users' },
        ],
        allowOther: true,
      },
      { id: 'email', type: 'email', title: 'Tu email', semantic: 'contact.email' },
    ],
  }
  // La clave viene de `semantic` (NO del título): renombrar el copy no mueve la cualificación.
  // La respuesta es el value; `cualificacion` la traduce a la etiqueta legible.
  const conOpcion = cualificacionDeFormulario(captacion, { 'pregunta-1': 'anuncios-meta', email: 'ana@x.test' }, 'F2')
  assert.equal(conOpcion.origen_contacto, 'Anuncios en Instagram / Meta')
  assert.equal(conOpcion.respuestas[0].a, 'Anuncios en Instagram / Meta')
  assert.equal(conOpcion.origen, 'formulario')
})

test('la fusión conserva lo que Calendly ya traía y lo nuevo gana en sus claves', () => {
  const f = fusionarCualificacion(
    { ingresos: '500', instagram: 'ana', respuestas: [{ q: 'Instagram', a: 'ana' }] },
    { ingresos: '1500', respuestas: [{ q: 'Ingresos', a: '1500' }] }
  )
  assert.equal(f.ingresos, '1500')
  assert.equal(f.instagram, 'ana')
  assert.equal(f.respuestas.length, 2)
})

test('el envío público de captación y cualificación atribuye el lead y guarda su cualificación', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/forms/public/[slug]/submit/route.ts', 'utf8')
  assert.match(r, /registrarOrigen\(sb, form\.tenantId, contactId, hiddenClean, \{ source: 'formulario'/)
  assert.match(r, /guardarCualificacion\(sb, form\.tenantId, contactId, cualificacion, now\)/)
  // Solo captación y cualificación: los alumnos (feedback) y las candidaturas no pasan por aquí.
  assert.match(
    r,
    /form\.audience === 'captacion' \|\| form\.audience === 'cualificacion'\)\) \{\s*await registrarOrigen/
  )
})

test('Typeform y Formularios comparten el mismo código de origen y cualificación', () => {
  const t = readFileSync('lib/typeform/entrada.ts', 'utf8')
  assert.match(t, /@\/lib\/contacts\/origen-y-cualificacion/)
  assert.ok(!/async function copiarAAgendas/.test(t), 'no queda una copia local')
})

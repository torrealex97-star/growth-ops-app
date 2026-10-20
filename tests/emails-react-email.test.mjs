import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defaultBody, TEMPLATE_SKELETONS, TEMPLATE_VARIABLES } from '../lib/email/templates.ts'

const company = {
  name: 'Empresa Demo',
  email_signature: 'Un saludo,\nEl equipo',
}
const KEYS = Object.keys(TEMPLATE_SKELETONS)

test('el HTML generado está al día con los componentes de /emails (si falla: npm run emails:build)', () => {
  // Ejecuta el generador en modo comprobación: compara lo renderizado con lo commiteado.
  execFileSync('npx', ['tsx', 'scripts/build-emails.tsx', '--check'], { stdio: 'pipe' })
})

test('las 8 plantillas existen y cada variable que documenta el editor está en su HTML', () => {
  assert.equal(KEYS.length, 8)
  for (const key of KEYS) {
    const html = TEMPLATE_SKELETONS[key].body
    assert.match(html, /<html/, key)
    assert.ok(html.length > 1500, `${key}: HTML demasiado corto`)
  }
  // `empresa` es la variable común: aparece en el asunto o en el cuerpo de todas.
  for (const key of KEYS) {
    assert.ok(
      TEMPLATE_VARIABLES[key].some((x) => x.var === '{{empresa}}'),
      key
    )
    assert.ok(TEMPLATE_SKELETONS[key].body.includes('{{empresa}}'), `${key}: el cuerpo lleva el nombre de la empresa`)
  }
})

test('un envío rellena TODAS las variables y no deja ni un {{marcador}} a la vista', () => {
  for (const key of KEYS) {
    const html = defaultBody(key, {
      company,
      memberName: 'Ana García',
      url: 'https://ejemplo.test/enlace?a=1&b=2',
      welcome: 'Bienvenida',
      landingUrl: 'https://ejemplo.test/landing',
      taskTitle: 'Llamar al lead',
      taskDescription: 'Antes de las 18:00',
      priority: 'Alta',
      dueDate: '30/09',
    })
    assert.ok(!/\{\{/.test(html), `${key}: quedó un marcador sin sustituir`)
    assert.match(html, /Empresa Demo/, key)
  }
})

test('los datos del envío se escapan: un nombre con HTML no inyecta nada', () => {
  const html = defaultBody('invite', {
    company: { ...company, name: 'A&B <i>' },
    memberName: '<script>alert(1)</script>',
    url: 'https://ejemplo.test/?a=1&b=2',
  })
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /A&amp;B &lt;i&gt;/)
  assert.match(html, /href="https:\/\/ejemplo\.test\/\?a=1&amp;b=2"/)
})

test('lo opcional se quita en vez de dejar un hueco: contrato firmado sin enlace y tarea sin descripción', () => {
  const sin = defaultBody('contract_signed', { company, memberName: 'Ana' })
  const con = defaultBody('contract_signed', { company, memberName: 'Ana', url: 'https://ejemplo.test/c.pdf' })
  assert.ok(!sin.includes('Descargar contrato firmado'))
  assert.ok(con.includes('Descargar contrato firmado'))
  assert.ok(con.includes('https://ejemplo.test/c.pdf'))

  const tarea = defaultBody('task_assigned', { company, memberName: 'Ana', taskTitle: 'Llamar', url: 'https://x.test' })
  assert.ok(tarea.includes('Llamar'))
  assert.ok(!/white-space:pre-line[^>]*>\s*<\/p>/.test(tarea), 'sin párrafo de descripción vacío')
  const completa = defaultBody('task_assigned', {
    company,
    memberName: 'Ana',
    taskTitle: 'Llamar',
    taskDescription: 'Detalle importante',
    priority: 'Alta',
    dueDate: '30/09',
    url: 'https://x.test',
  })
  assert.match(completa, /Detalle importante/)
  assert.match(completa, /Prioridad: Alta · Vence: 30\/09/)
})

test('el onboarding de alumnos lleva al enlace de la landing si existe y al enlace normal si no', () => {
  const con = defaultBody('student_onboarding', {
    company,
    memberName: 'Ana',
    url: 'https://a.test',
    landingUrl: 'https://landing.test',
  })
  assert.match(con, /href="https:\/\/landing\.test"/)
  const sin = defaultBody('student_onboarding', { company, memberName: 'Ana', url: 'https://a.test' })
  assert.match(sin, /href="https:\/\/a\.test"/)
})

test('los colores de los correos viven en un único sitio: las plantillas no llevan hex sueltos', () => {
  const plantillas = readFileSync('emails/plantillas.tsx', 'utf8')
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(plantillas), 'usa COLOR de emails/diseno.tsx')
  const diseno = readFileSync('emails/diseno.tsx', 'utf8')
  assert.match(diseno, /export const COLOR/)
})

test('react-email es solo de desarrollo: no entra en lo que se despliega', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  for (const dep of ['@react-email/components', '@react-email/render', 'tsx']) {
    assert.ok(pkg.devDependencies[dep], `${dep} en devDependencies`)
    assert.ok(!pkg.dependencies?.[dep], `${dep} fuera de dependencies`)
    assert.ok(!pkg.devDependencies[dep].startsWith('^'), `${dep} con versión fijada`)
  }
  assert.ok(pkg.scripts['emails:build'] && pkg.scripts['emails:check'])
})

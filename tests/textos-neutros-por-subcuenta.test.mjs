import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Los textos por defecto del sistema (emails a alumnos, contrato PDF, placeholders y prompts de IA) no pueden
// nombrar una marca concreta («Academia», «Winner»): el producto es multi-subcuenta y cada una tiene su nombre.
// Lo personal sale de {{empresa}} / del perfil de empresa, o lo escribe cada subcuenta en Configuración › Correos.

const leer = (p) => readFileSync(p, 'utf8')
const PROHIBIDO = /\b(Winners?|Academia)\b/

test('las plantillas de email por defecto no nombran una marca', () => {
  assert.doesNotMatch(leer('emails/plantillas.tsx'), PROHIBIDO)
  assert.doesNotMatch(leer('lib/email/plantillas.generated.ts'), PROHIBIDO)
})

test('el correo de accesos usa el nombre de la empresa de la subcuenta', () => {
  assert.match(leer('emails/plantillas.tsx'), /accesos a \{\{empresa\}\}/)
})

test('el contrato del alumno firma en nombre de la empresa, no de «LA ACADEMIA»', () => {
  const pdf = leer('lib/contracts/pdf-student.ts')
  assert.doesNotMatch(pdf, /LA ACADEMIA/)
  assert.match(pdf, /company\.name\.toUpperCase\(\)/)
})

test('placeholders y prompts de IA no asumen que el programa se llama «academia»', () => {
  assert.doesNotMatch(leer('app/[tenant]/contratos/plantillas/page.tsx'), /Bienvenido Winner/)
  assert.doesNotMatch(leer('lib/testimonios-shared.ts'), /academia/i)
  assert.doesNotMatch(leer('app/api/[tenant]/evergreen/carruseles/caso-exito/route.ts'), /academia/i)
})

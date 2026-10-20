// Genera lib/email/plantillas.generated.ts a partir de los componentes de /emails.
//
//   npm run emails:build      escribe el fichero generado
//   npm run emails:check      falla si el fichero generado no coincide con los componentes (lo usa un test)
//
// El HTML generado se COMMITEA: en tiempo de ejecución no se renderiza React ni se empaqueta
// @react-email (son dependencias de desarrollo); el sistema de plantillas sigue siendo cadenas con
// {{variables}}, síncrono y puro, como antes.
import { render } from '@react-email/render'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLANTILLAS } from '../emails/plantillas'

// Se ejecuta siempre desde la raíz del repo (npm run emails:build).
const DESTINO = join(process.cwd(), 'lib/email/plantillas.generated.ts')

async function generar(): Promise<string> {
  const entradas: string[] = []
  for (const [clave, elemento] of Object.entries(PLANTILLAS)) {
    // React deja marcadores `<!--$-->` de Suspense: inocuos, pero ruido en un HTML que se guarda y se edita.
    const html = (await render(elemento, { pretty: false })).replace(/<!--\/?\$-->/g, '')
    entradas.push(`  ${JSON.stringify(clave)}: ${JSON.stringify(html)},`)
  }
  return `// GENERADO por scripts/build-emails.tsx desde /emails — NO editar a mano (npm run emails:build).
// HTML de cada correo con sus {{variables}} sin sustituir; lib/email/templates.ts las rellena al enviar.
export const PLANTILLAS_HTML: Record<string, string> = {
${entradas.join('\n')}
}
`
}

async function main() {
  const comprobar = process.argv.includes('--check')
  const nuevo = await generar()
  if (comprobar) {
    let actual = ''
    try {
      actual = readFileSync(DESTINO, 'utf8')
    } catch {
      /* no existe */
    }
    if (actual !== nuevo) {
      console.error('lib/email/plantillas.generated.ts está desactualizado: ejecuta `npm run emails:build`.')
      process.exit(1)
    }
    console.log('plantillas de correo al día')
  } else {
    writeFileSync(DESTINO, nuevo)
    console.log(`generadas ${Object.keys(PLANTILLAS).length} plantillas`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

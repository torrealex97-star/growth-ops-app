// EDICIÓN DE PALABRAS de una slide cualquiera (carruseles, flyers o historias antiguas sin especificación): se listan sus
// textos y se reescriben dentro del mismo HTML. shortcut: lee el HTML con expresiones regulares (vale para el HTML que genera
// la app; no entiende '>' dentro de un atributo) y no edita textos que estén en atributos; cambiar a un parser si hace falta.

const PARTES = /(<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]*>)/gi

const decodificar = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
const codificar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const esTexto = (parte: string) => !parte.startsWith('<') && parte.trim().length > 0

export type TextoEditable = { indice: number; texto: string }

/** Los textos visibles de la slide, en orden. `indice` es su posición entre los textos no vacíos. */
export function textosEditables(html: string): TextoEditable[] {
  const salida: TextoEditable[] = []
  for (const parte of html.split(PARTES))
    if (esTexto(parte)) salida.push({ indice: salida.length, texto: decodificar(parte.trim()) })
  return salida
}

/** Devuelve el HTML con los textos cambiados (`cambios[indice] = texto nuevo`); lo demás queda idéntico. */
export function conTextosEditados(html: string, cambios: Record<number, string>): string {
  let n = 0
  return html
    .split(PARTES)
    .map((parte) => {
      if (!esTexto(parte)) return parte
      const nuevo = cambios[n++]
      if (nuevo === undefined) return parte
      const [, antes, , despues] = /^(\s*)([\s\S]*?)(\s*)$/.exec(parte) as RegExpExecArray
      return `${antes}${codificar(nuevo)}${despues}`
    })
    .join('')
}

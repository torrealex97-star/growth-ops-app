// ─────────────────────────────────────────────────────────────────────────────
// AUDITORÍA DE ESCRITURAS CIEGAS (estática)
// ─────────────────────────────────────────────────────────────────────────────
// Un `await` sobre una escritura de Supabase que no consume `{ error }` es un
// fallo silencioso: la fila no se escribió y la pantalla responde como si sí.
// Es la familia de bugs de la ola #269 (cobro fallido con venta registrada),
// #270 (dos publicaciones por falta de claim) y #689 (conversaciones).
//
// Qué detecta (sobre app/, lib/, components/, hooks/):
//   · await de una cadena `.from(...)` + `.insert|update|upsert|delete`, o de un
//     `.rpc(...)` cuyo nombre parece mutación (un rpc de lectura no escribe).
//   · clasifica cómo se consume el resultado:
//       critico      — el valor se descarta (`await supabase…update(...)`).
//       sin-error    — se desestructura data SIN error (`const { data } = await`).
//       no-consumido — se liga a una variable pero no se usa después.
//       propagada    — `return await …`: el consumidor decide (no es hallazgo).
//       ok           — la ligadura se consume (p. ej. `if (updError) throw`).
//       justificada  — comentario `escritura-ciega-ok: <razón>` en la línea del
//                      hallazgo o la anterior. La razón es obligatoria.
//
// Limitaciones aceptadas (documentadas, no silenciadas):
//   · No resuelve cadenas partidas en variables (`let q = supabase.from(…)` y un
//     `await q` posterior): solo ve la expresión del propio await.
//   · Blanquea strings y plantillas antes de razonar: código real escrito dentro
//     de un template no se analiza.
//   · La "consume" se mide en los 6.000 caracteres siguientes: un error guardado
//     para comprobarlo mucho más abajo en un fichero enorme se reporta igual.
//   · Es una heurística de texto, no un type-checker: produce CANDIDATOS y el
//     triage es humano. Un hallazgo no cambia código por sí solo.
//
// Uso:
//   node scripts/auditar-escrituras-ciegas.mjs [--json]   → informe; exit 1 si
//                                                           hay critico/sin-error
//   import { escanear, analizarFuente } from '…'          → para tests
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const raizPorDefecto = join(dirname(fileURLToPath(import.meta.url)), '..')

const DIRECTORIOS = ['app', 'lib', 'components', 'hooks']
const ESCRITURA = /\.(insert|update|upsert|delete|rpc)\s*\(/
const ESCRITURA_G = /\.(insert|update|upsert|delete|rpc)\s*\(/g
const MUTACION_RPC =
  /^(create|insert|update|upsert|delete|apply|registrar|generar|marcar|asignar|assign|set_|add_|remove_|sync|recalcular|procesar|enviar)/i
const MONEY =
  /(finanz|finance|sales|cobr|collection|commission|stripe|payout|invoice|factura|gasto|sequra|refund|payment)/i

// ── Blanqueo: comentarios y strings → espacios (misma longitud, mismas líneas) ─
// Así `.delete(` dentro de un comentario o de un texto no genera hallazgo y los
// índices del texto original siguen siendo válidos para leer el código.
export function sinComentariosNiStrings(src) {
  const out = src.split('')
  const n = src.length
  let i = 0
  let quote = null
  while (i < n) {
    const ch = src[i]
    const dos = src.slice(i, i + 2)
    if (quote) {
      if (ch === '\\') {
        out[i] = ' '
        if (i + 1 < n && src[i + 1] !== '\n') out[i + 1] = ' '
        i += 2
        continue
      }
      if (ch === quote) {
        quote = null
        i++
        continue
      }
      if (ch !== '\n') out[i] = ' '
      i++
      continue
    }
    if (dos === '//') {
      while (i < n && src[i] !== '\n') {
        out[i] = ' '
        i++
      }
      continue
    }
    if (dos === '/*') {
      while (i < n && src.slice(i, i + 2) !== '*/') {
        if (src[i] !== '\n') out[i] = ' '
        i++
      }
      if (i < n) {
        out[i] = ' '
        out[i + 1] = ' '
        i += 2
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      i++
      continue
    }
    i++
  }
  return out.join('')
}

// Fin de la expresión que sigue a `await`: se corta en `;`, `,` o salto de línea
// de nivel 0 (una continuación de cadena empieza por `.`).
function finDeExpresion(b, desde) {
  let d = 0
  for (let j = desde; j < b.length; j++) {
    const ch = b[j]
    if (ch === '(' || ch === '[' || ch === '{') d++
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (d === 0) return j
      d--
    } else if ((ch === ';' || ch === ',') && d === 0) return j
    else if (ch === '\n' && d === 0) {
      const sig = b.slice(j + 1).match(/^\s*(\S)/)
      if (!sig || sig[1] !== '.') return j
    }
  }
  return b.length
}

// Instrucción del await: hasta el `;` anterior. Si la línea inmediata solo trae
// puntuación (`? await …`, `: await …` de un ternario, `&& await …`), se
// retrocede línea a línea hasta encontrar la que porta la ligadura.
// Una línea es "rama" de la misma expresión (ternario o continuación de cadena),
// no el comienzo de otra instrucción: solo entonces se retrocede para buscarla.
const esRama = (ins) => /^\s*[?:.]/.test(ins) || /^[?:()\s&|]*$/.test(ins)

function instruccionDe(b, idx) {
  const lineas = b.slice(Math.max(0, idx - 2200), idx).split('\n')
  let ins = lineas[lineas.length - 1]
  for (let k = lineas.length - 2; k >= 0 && lineas.length - 1 - k <= 24; k--) {
    if (buscarLigadura(ins)) break
    if (!esRama(ins)) break
    ins = `${lineas[k]}\n${ins}`
  }
  return ins
}

// Profundidad de paréntesis por posición: una escritura dentro de un callback
// (`await recordSyncRun(…, async () => { sb.from(…) })`) no es la que se espera.
function profundidades(expresion) {
  const out = new Array(expresion.length)
  let d = 0
  for (let i = 0; i < expresion.length; i++) {
    const ch = expresion[i]
    if (ch === ')' || ch === ']' || ch === '}') d = Math.max(0, d - 1)
    out[i] = d
    if (ch === '(' || ch === '[' || ch === '{') d++
  }
  return out
}

// Formas de ligadura, de la más específica a la más general. `destructura` es
// lo que distingue `{ data }` (nunca miraba el error) de `const res` (puede
// mirar `res.error`).
const LIGADURAS = [
  [/\b(?:const|let|var)\s*\{([\s\S]*?)\}\s*=/, true], // const { data, error } =
  [/\b(?:const|let|var)\s*\[([\s\S]*?)\]\s*=/, true], // const [a, b] = (Promise.all)
  [/\b(?:const|let|var)\s+([\w$]+)\s*=/, false], // const res =
  [/\(\s*\{([\s\S]*?)\}\s*=/, true], // ({ error: e } = …
  [/(?:^|[\s;{])([\w$]+)\s*=(?![=>])[\s\S]*$/, false], // res = … (asignación suelta)
]

function ligaduraDeInstruccion(b, idx) {
  return buscarLigadura(instruccionDe(b, idx))
}

function buscarLigadura(instruccion) {
  for (const [re, destructura] of LIGADURAS) {
    const m = instruccion.match(re)
    if (m) return { cuerpo: m[1], destructura }
  }
  return null
}

// Nombres que quedan ligados: de `{ data, error: e }` → ['data', 'e'].
function nombresLigados(cuerpo) {
  return cuerpo
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => (parte.includes(':') ? parte.split(':').pop() : parte))
    .map((n) => n.replace(/^\.\.\./, '').trim())
    .filter((n) => /^[\w$]+$/.test(n))
}

const cuenta = (texto, nombre) => new RegExp(`\\b${nombre.replace(/\$/g, '\\$')}\\b`).test(texto)

const lineaDe = (src, idx) => src.slice(0, idx).split('\n').length

export function analizarFuente(texto, fichero = '<fuente>') {
  const b = sinComentariosNiStrings(texto)
  const lineasTexto = texto.split('\n')
  const hallazgos = []
  const re = /\bawait\b/g
  let m
  while ((m = re.exec(b))) {
    const inicio = m.index + m[0].length
    const fin = finDeExpresion(b, inicio)
    const expresion = b.slice(inicio, fin)
    if (!ESCRITURA.test(expresion)) continue

    // Solo cuenta la escritura de la propia expresión await: profundidad 0, o la
    // de los elementos de un `Promise.all([...])` (profundidad 1 dentro del array).
    const esPromiseAll = /^\s*Promise\.all\s*\(/.test(expresion)
    const prof = profundidades(expresion)
    const enExpresion = (i) => prof[i] === 0 || (esPromiseAll && prof[i] === 1)
    let escritura = null
    for (const mm of expresion.matchAll(ESCRITURA_G)) {
      if (enExpresion(mm.index)) {
        escritura = mm
        break
      }
    }
    if (!escritura) continue

    const original = texto.slice(inicio, fin)
    const metodo = escritura[1]
    const iMetodo = escritura.index
    const primer = (re) => {
      for (const mm of expresion.matchAll(re)) if (enExpresion(mm.index) && mm.index < iMetodo) return mm.index
      return -1
    }
    const iFrom = primer(/\.from\s*\(/g)
    const iRpc = primer(/\.rpc\s*\(/g)
    const rpc = original.match(/\.rpc\s*\(\s*['"`]([\w.]+)['"`]/)
    const tabla = (original.match(/\.from\s*\(\s*['"`]([\w.]+)['"`]/) || [])[1] || null

    // Solo cadenas de Supabase: `.from(` ANTES de la escritura (descarta p. ej.
    // `youtube.videos.insert({ media: { body: Readable.from(buffer) } })`).
    // Un `.rpc(` NO se valida por la cadena `.from(`: en un `Promise.all` la
    // lectura `.from(...).select()` de al lado haría pasar cualquier rpc.
    const esSupabase = metodo !== 'rpc' && iFrom !== -1 && iFrom < iMetodo
    const esRpcMutacion = metodo === 'rpc' && iRpc !== -1 && iRpc < iMetodo && MUTACION_RPC.test(rpc?.[1] ?? '')
    if (!esSupabase && !esRpcMutacion) continue

    const linea = lineaDe(texto, m.index)
    const riesgo = MONEY.test(`${fichero} ${tabla || rpc?.[1] || ''}`) ? 'dinero' : 'otro'

    // Justificación explícita, en la línea del hallazgo o en la anterior.
    // La razón va en la MISMA línea que el marcador: un comentario vacío no justifica nada.
    const just = `${lineasTexto[linea - 2] ?? ''}\n${lineasTexto[linea - 1] ?? ''}`.match(
      /escritura-ciega-ok:[ \t]*(\S[^\n*]*)/
    )

    let tier
    if (just) tier = 'justificada'
    else if (/\.throwOnError\s*\(/.test(expresion)) tier = 'ok'
    // `.then(({ error }) => …)` es una comprobación, igual que el destructuring.
    else if (/\.then\s*\(\s*\(\s*\{[^}]*\berr/i.test(expresion)) tier = 'ok'
    else {
      const ligadura = ligaduraDeInstruccion(b, m.index)
      if (/\breturn\b\s*$/.test(instruccionDe(b, m.index).trim())) tier = 'propagada'
      else if (!ligadura) tier = 'critico'
      else {
        const nombres = nombresLigados(ligadura.cuerpo)
        const despues = b.slice(fin, fin + 6000)
        // Un `{ error }` se consume por su nombre; `updError` o `saveErr` cuentan.
        const esError = (n) => /err/i.test(n)
        const miraError = nombres.some((n) => esError(n) && cuenta(despues, n))
        const miraAlguno = nombres.some((n) => cuenta(despues, n))
        const usaError = nombres.some((n) =>
          esError(n) ? cuenta(despues, n) : new RegExp(`\\b${n}\\s*\\??\\.\\s*error\\b`).test(despues)
        )
        if (!nombres.length)
          // Un Promise.all sin ligadura puede estar comprobando dentro de cada
          // tarea (`map(async … )` con su `{ error }`): se revisa a mano.
          tier = esPromiseAll && /\berr/i.test(expresion) ? 'ok' : 'critico'
        else if (nombres.some(esError)) tier = miraError ? 'ok' : 'no-consumido'
        else if (/Promise\.all\s*\(/.test(expresion)) tier = miraAlguno ? 'ok' : 'no-consumido'
        else if (ligadura.destructura) tier = 'sin-error'
        else tier = usaError ? 'ok' : 'no-consumido'
      }
    }

    hallazgos.push({
      tier,
      fichero,
      linea,
      metodo,
      tabla: tabla || (rpc ? `rpc:${rpc[1]}` : null),
      riesgo,
      justificacion: just ? just[1].trim() : null,
      evidencia: (lineasTexto[linea - 1] ?? '').trim().slice(0, 160),
    })
  }
  return hallazgos
}

function ficherosRastreados(raiz, directorios) {
  try {
    const salida = execSync(`git ls-files -z ${directorios.map((d) => `${d}`).join(' ')}`, {
      cwd: raiz,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return salida
      .split('\0')
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !/database-generated/.test(f))
      .map((f) => join(raiz, f))
  } catch {
    // Sin git (tarball, CI raro): se cae al árbol real, aceptando ruido de copias.
    const out = []
    const walk = (dir) => {
      let entradas = []
      try {
        entradas = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entradas) {
        if (e.isDirectory()) {
          if (!['node_modules', '.next', '.git'].includes(e.name)) walk(join(dir, e.name))
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(join(dir, e.name))
      }
    }
    for (const d of directorios) walk(join(raiz, d))
    return out
  }
}

export function escanear({ raiz = raizPorDefecto, directorios = DIRECTORIOS } = {}) {
  const ficheros = ficherosRastreados(raiz, directorios)
  const hallazgos = []
  for (const f of ficheros) hallazgos.push(...analizarFuente(readFileSync(f, 'utf8'), relative(raiz, f)))
  const porTier = hallazgos.reduce((acc, h) => ((acc[h.tier] = (acc[h.tier] || 0) + 1), acc), {})
  const orden = { dinero: 0, otro: 1 }
  hallazgos.sort((a, b) => orden[a.riesgo] - orden[b.riesgo] || a.fichero.localeCompare(b.fichero) || a.linea - b.linea)
  return { ficheros: ficheros.length, hallazgos, porTier }
}

export const TIERS_QUE_FALLAN = ['critico', 'sin-error']

const esCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (esCli) {
  const r = escanear()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ficheros: r.ficheros, porTier: r.porTier, hallazgos: r.hallazgos }, null, 2))
  } else {
    console.log(`Ficheros escaneados: ${r.ficheros}`)
    for (const [tier, n] of Object.entries(r.porTier)) console.log(`  ${tier}: ${n}`)
    const lista = r.hallazgos.filter((h) => !['ok', 'propagada', 'justificada'].includes(h.tier))
    if (lista.length) console.log('\nHallazgos (dinero primero):')
    for (const h of lista) {
      console.log(
        `  ${h.tier.toUpperCase().padEnd(12)} [${h.riesgo}] ${h.fichero}:${h.linea} → ${h.tabla ?? '?'} (${h.metodo})`
      )
      if (h.evidencia) console.log(`      ${h.evidencia}`)
    }
  }
  process.exit(r.hallazgos.some((h) => TIERS_QUE_FALLAN.includes(h.tier)) ? 1 : 0)
}

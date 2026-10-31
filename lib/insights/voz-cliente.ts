// VOZ DEL CLIENTE: qué dicen los prospectos y los clientes, convertido en ideas de contenido.
//
// POR QUÉ EXISTE. Lo que el prospecto escribe antes de la llamada (formulario de aplicación), lo que
// objeta durante ella (análisis de la llamada) y lo que cuenta después (feedback) es el mejor material
// para decidir qué contenido publicar: habla de sus palabras, de sus miedos y de lo que de verdad frena
// la compra. Aquí se agrupa por temas y se propone, para cada tema, un enfoque de contenido.
//
// REGLAS DE HONESTIDAD.
//  · Es PURO y determinista (sin IA): mismo texto, mismo tema. Se puede probar y no cuesta dinero.
//  · Un tema solo se muestra con `minMenciones` o más: una sola frase no es un patrón.
//  · Lo que no encaja en ningún tema se cuenta como «sin clasificar», no se esconde ni se inventa.
//  · Las citas salen sin emails, teléfonos, enlaces ni @usuarios, y recortadas.
//  · Un porcentaje es sobre lo CLASIFICADO y se dice; sin datos no hay números (null).
export type Origen = 'llamada' | 'formulario' | 'feedback'
export const ORIGENES: Origen[] = ['llamada', 'formulario', 'feedback']
export const ETIQUETA_ORIGEN: Record<Origen, string> = {
  llamada: 'Objeciones en llamadas',
  formulario: 'Formularios de aplicación',
  feedback: 'Feedback de clientes',
}

export type Senal = { origen: Origen; texto: string; fecha?: string }

export type IdeaContenido = { formato: 'reel' | 'carrusel' | 'historia' | 'flyer'; gancho: string; angulo: string }

export type Tema = {
  id: string
  titulo: string
  /** Qué siente o teme la persona, en una frase. */
  dolor: string
  menciones: number
  /** % sobre las señales clasificadas (0-100). */
  porcentaje: number
  porOrigen: Record<Origen, number>
  citas: string[]
  ideas: IdeaContenido[]
}

export type VozCliente = {
  total: number
  clasificadas: number
  sinClasificar: number
  temas: Tema[]
}

type Definicion = { id: string; titulo: string; dolor: string; patron: RegExp; ideas: IdeaContenido[] }

// Patrones sobre texto SIN tildes y en minúsculas. Ordenados por especificidad: una señal puede sumar
// a varios temas (una frase puede hablar de precio Y de tiempo), pero cada tema cuenta una vez por señal.
const TEMAS: Definicion[] = [
  {
    id: 'precio',
    titulo: 'Precio y dinero',
    dolor: 'Siente que es caro o no sabe si podrá recuperar la inversión.',
    patron:
      /\b(caro|cara|precio|dinero|presupuesto|no me llega|no tengo (el )?dinero|pagar|cuota|financi|inversion|coste|costo|barato|rentable|recuper)/,
    ideas: [
      {
        formato: 'carrusel',
        gancho: '¿Es caro o es una inversión? Haz la cuenta en 3 pasos',
        angulo: 'Calcular el retorno con los números reales de un cliente (sin prometer resultados).',
      },
      {
        formato: 'reel',
        gancho: 'Lo que me dijeron antes de comprar: «es mucho dinero»',
        angulo: 'Responder a la objeción de precio con una historia, no con un descuento.',
      },
    ],
  },
  {
    id: 'tiempo',
    titulo: 'Falta de tiempo',
    dolor: 'No ve cómo encajarlo con su trabajo, familia o agenda.',
    patron:
      /\b(tiempo|ocupad|agenda|horario|trabajo (a )?jornada|no llego|familia|hijos|cansad|estres|compaginar|disponibilidad)/,
    ideas: [
      {
        formato: 'reel',
        gancho: 'Menos de una hora al día: así lo hace alguien con trabajo y niños',
        angulo: 'Mostrar una rutina realista de un cliente, con sus límites.',
      },
      {
        formato: 'historia',
        gancho: '¿Cuánto tiempo necesitas de verdad? Respóndelo aquí',
        angulo: 'Encuesta para convertir la objeción en conversación.',
      },
    ],
  },
  {
    id: 'confianza',
    titulo: 'Dudas de que funcione',
    dolor: 'Teme que sea humo, que no le funcione o que no haya pruebas reales.',
    patron:
      /\b(funcion|estafa|humo|garantia|resultado|prueba|casos?|confianza|fiar|seguro|real|credibilidad|experiencia previa|testimon|demostr)/,
    ideas: [
      {
        formato: 'carrusel',
        gancho: 'Antes y después con números: qué hizo, cuánto tardó y qué falló',
        angulo: 'Caso de éxito completo, incluyendo lo que no salió bien (credibilidad).',
      },
      {
        formato: 'reel',
        gancho: 'La pregunta que más me hacen: «¿esto funciona de verdad?»',
        angulo: 'Responder con pruebas y condiciones, sin garantizar resultados.',
      },
    ],
  },
  {
    id: 'decision',
    titulo: 'Necesita consultarlo',
    dolor: 'No decide solo: pareja, socio o familia influyen, o quiere «pensarlo».',
    patron:
      /\b(pareja|marido|mujer|esposo|esposa|socio|consult|pensarlo|pensar|hablarlo|decidir|familia (opina|decide)|mi jefe)/,
    ideas: [
      {
        formato: 'carrusel',
        gancho: 'Cómo explicarle esta decisión a tu pareja (guion de 3 minutos)',
        angulo: 'Dar argumentos y un resumen compartible para la segunda persona que decide.',
      },
      {
        formato: 'flyer',
        gancho: 'Resumen de una página para decidir en pareja',
        angulo: 'Pieza descargable que ayuda a la persona a defender la decisión.',
      },
    ],
  },
  {
    id: 'capacidad',
    titulo: 'Miedo a no ser capaz',
    dolor: 'Duda de sí misma: sin experiencia, sin perfil comercial, miedo al rechazo.',
    patron:
      /\b(no (se|soy)|no valgo|capaz|sin experiencia|nunca (he|hice)|miedo|verguenza|inseguridad|rechazo|timid|no tengo perfil|principiante|empezar de cero)/,
    ideas: [
      {
        formato: 'reel',
        gancho: 'Empecé sin experiencia comercial y esto fue lo primero que aprendí',
        angulo: 'Historia de un cliente que partió de cero, con el primer paso concreto.',
      },
      {
        formato: 'carrusel',
        gancho: '5 miedos de quien nunca ha vendido (y qué hacer con cada uno)',
        angulo: 'Normalizar el miedo y dar un ejercicio pequeño por cada uno.',
      },
    ],
  },
  {
    id: 'probado',
    titulo: 'Ya probó otras cosas',
    dolor: 'Se ha decepcionado antes con cursos, gurús o métodos que no cumplieron.',
    patron:
      /\b(ya (probe|hice|compre|pague)|otros? curso|gurus?|me (engañ|decepcion)|decepcion|otra formacion|ya estuve|mala experiencia|no me sirvio|vendehumo)/,
    ideas: [
      {
        formato: 'reel',
        gancho: 'Por qué los cursos anteriores no te funcionaron (no es tu culpa)',
        angulo: 'Reconocer la decepción y explicar qué cambia aquí: práctica, acompañamiento, seguimiento.',
      },
      {
        formato: 'carrusel',
        gancho: 'Checklist: cómo saber si una formación es humo',
        angulo: 'Posicionarse con criterios honestos que la persona pueda comprobar.',
      },
    ],
  },
  {
    id: 'momento',
    titulo: 'No es el momento',
    dolor: 'Lo aplaza: ahora no, más adelante, cuando tenga estabilidad.',
    patron:
      /\b(ahora no|mas adelante|mas tarde|otro momento|no es el momento|cuando (pueda|tenga)|esperar|de momento|el mes que viene|despues del verano|todavia no)/,
    ideas: [
      {
        formato: 'historia',
        gancho: '¿Qué tendría que pasar para que fuera el momento?',
        angulo: 'Hacer visible la excusa y el coste de seguir esperando.',
      },
      {
        formato: 'reel',
        gancho: 'Lo que cuesta esperar 6 meses más',
        angulo: 'Comparar con calma dos caminos, sin presión artificial.',
      },
    ],
  },
  {
    id: 'metodo',
    titulo: 'Dudas sobre el método o la oferta',
    dolor: 'No tiene claro qué incluye, cómo funciona o si encaja con su caso.',
    patron:
      /\b(que incluye|como funciona|incluye|temario|programa|modulos?|metodo|plataforma|soporte|acompañamiento|mentor|certificad|duracion|encaja|mi caso|para mi sector)/,
    ideas: [
      {
        formato: 'carrusel',
        gancho: 'Qué incluye exactamente, semana a semana',
        angulo: 'Mostrar el recorrido real: qué haces, qué recibes y qué se espera de ti.',
      },
      {
        formato: 'historia',
        gancho: 'Pregúntame lo que quieras sobre el programa (respondo hoy)',
        angulo: 'Caja de preguntas para recoger más dudas reales.',
      },
    ],
  },
]

export const MAX_CITAS = 3
const LARGO_CITA = 140

const sinTildes = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Quita datos personales de una frase antes de mostrarla: emails, teléfonos, enlaces y @usuarios. */
export function anonimizar(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[enlace]')
    .replace(/(^|\s)@[\w.]{2,}/g, '$1[usuario]')
    .replace(/(\+?\d[\d\s().-]{7,}\d)/g, '[teléfono]')
    .replace(/\s+/g, ' ')
    .trim()
}

function recortar(texto: string): string {
  const limpio = anonimizar(texto)
  if (limpio.length <= LARGO_CITA) return limpio
  const corte = limpio.slice(0, LARGO_CITA)
  return `${corte.slice(0, Math.max(corte.lastIndexOf(' '), 60))}…`
}

/** Un tema por señal como mucho cuenta una vez; una señal puede sumar a varios temas. */
export function temasDe(texto: string): string[] {
  const normal = sinTildes(texto.toLowerCase())
  return TEMAS.filter((tema) => tema.patron.test(normal)).map((tema) => tema.id)
}

export function analizarVozCliente(senales: Senal[], opciones: { minMenciones?: number } = {}): VozCliente {
  const minMenciones = Math.max(1, opciones.minMenciones ?? 2)
  const utiles = senales.filter((s) => typeof s.texto === 'string' && s.texto.trim().length >= 8)
  const cuentas = new Map<
    string,
    { menciones: number; porOrigen: Record<Origen, number>; citas: Array<{ texto: string; fecha: string }> }
  >()
  let clasificadas = 0
  for (const senal of utiles) {
    const ids = temasDe(senal.texto)
    if (!ids.length) continue
    clasificadas += 1
    for (const id of ids) {
      const actual = cuentas.get(id) ?? {
        menciones: 0,
        porOrigen: { llamada: 0, formulario: 0, feedback: 0 },
        citas: [],
      }
      actual.menciones += 1
      actual.porOrigen[senal.origen] += 1
      actual.citas.push({ texto: senal.texto, fecha: senal.fecha ?? '' })
      cuentas.set(id, actual)
    }
  }
  const temas: Tema[] = []
  for (const definicion of TEMAS) {
    const dato = cuentas.get(definicion.id)
    if (!dato || dato.menciones < minMenciones) continue
    const citas: string[] = []
    // Las más recientes primero y sin repetir; la cita es una muestra, no el listado completo.
    for (const cita of [...dato.citas].sort((a, b) => b.fecha.localeCompare(a.fecha))) {
      const texto = recortar(cita.texto)
      if (texto && !citas.includes(texto)) citas.push(texto)
      if (citas.length >= MAX_CITAS) break
    }
    temas.push({
      id: definicion.id,
      titulo: definicion.titulo,
      dolor: definicion.dolor,
      menciones: dato.menciones,
      porcentaje: clasificadas ? Math.round((dato.menciones / clasificadas) * 100) : 0,
      porOrigen: dato.porOrigen,
      citas,
      ideas: definicion.ideas,
    })
  }
  temas.sort((a, b) => b.menciones - a.menciones || a.titulo.localeCompare(b.titulo, 'es'))
  return { total: utiles.length, clasificadas, sinClasificar: utiles.length - clasificadas, temas }
}

export const TEMAS_DISPONIBLES = TEMAS.map(({ id, titulo }) => ({ id, titulo }))

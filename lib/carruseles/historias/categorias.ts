import { ZONA_SEGURA } from './estilo-nativo'
import type { Layout } from './layouts'

// REGLAS DE SECUENCIAS DE HISTORIAS como datos: categorías, arco por longitud (3, 5 o 7) y, para cada
// etapa, qué foto, qué velo y dónde va el texto. Salen del análisis de secuencias reales de creadores
// (formato, ritmo y tratamiento), no de plantillas genéricas. Puro: sin red ni base de datos.

export type Etapa = 'gancho' | 'problema' | 'cambio' | 'ejemplo' | 'prueba' | 'porque' | 'objecion' | 'cta'
export type LongitudSecuencia = 3 | 5 | 7
export type ZonaTexto = 'arriba' | 'centro' | 'abajo' | 'partida'

export type CategoriaId =
  | 'opinion_error'
  | 'antes_ahora'
  | 'contraste_nivel'
  | 'pregunta_respuesta'
  | 'caso_prueba'
  | 'marco_diagrama'
  | 'insider'

type EspecEtapa = {
  /** Qué foto conviene (del banco de fotos subido al proyecto). */
  foto: string
  /** Velo oscuro sobre la foto: 0 = limpia, 75 = muy oscura (manda el texto). */
  velo: 0 | 20 | 40 | 60 | 75
  zona: ZonaTexto
  /** Plantilla de `add_story` que corresponde a esta etapa. */
  layout: Layout
  /** Componentes del editor nativo que encajan. */
  componentes: string[]
  /** Qué tiene que lograr esta historia. */
  objetivo: string
}

/** Qué hace cada etapa: el gancho y el cierre son claros y con cara; el desarrollo, oscuro y con texto. */
export const ETAPAS: Record<Etapa, EspecEtapa> = {
  gancho: {
    foto: 'persona a cámara, plano medio, la más luminosa',
    velo: 20,
    zona: 'arriba',
    layout: 'portada',
    componentes: ['ig-etiqueta-fecha', 'ig-titulo', 'ig-marcador'],
    objetivo: 'Frenar el dedo en 1,5 s: una afirmación fuerte o una pregunta incómoda, con una palabra de acento.',
  },
  problema: {
    foto: 'persona o recurso del día a día',
    velo: 60,
    zona: 'centro',
    layout: 'texto',
    componentes: ['ig-caja-negra', 'ig-texto', 'ig-marcador'],
    objetivo: 'Que la audiencia se reconozca: el error o el dolor, dicho como lo dice ella.',
  },
  cambio: {
    foto: 'fondo oscuro o desenfocado',
    velo: 75,
    zona: 'centro',
    layout: 'comparacion',
    componentes: ['ig-chip', 'ig-recuadro', 'ig-titulo'],
    objetivo: 'Mostrar el contraste (antes/ahora, mal/bien) en recuadros comparables, una idea por historia.',
  },
  ejemplo: {
    foto: 'captura, recurso o escena real',
    velo: 60,
    zona: 'centro',
    layout: 'foto_texto',
    componentes: ['ig-captura', 'ig-caja', 'ig-chip'],
    objetivo: 'Hacerlo concreto con algo que se pueda ver: captura, perfil, escena.',
  },
  prueba: {
    foto: 'captura de resultados sobre fondo oscuro',
    velo: 75,
    zona: 'centro',
    layout: 'cifra',
    componentes: ['ig-captura', 'ig-caja-acento', 'ig-texto'],
    objetivo: 'Credibilidad con cifras reales (solo las que dé el negocio): logro y qué se hizo.',
  },
  porque: {
    foto: 'persona hablando o pensando',
    velo: 60,
    zona: 'abajo',
    layout: 'foto_texto',
    componentes: ['ig-texto', 'ig-marcador', 'ig-caja-negra'],
    objetivo: 'Explicar la causa con una frase simple; sin tecnicismos.',
  },
  objecion: {
    foto: 'persona con gesto expresivo',
    velo: 40,
    zona: 'abajo',
    layout: 'foto_texto',
    componentes: ['ig-caja', 'ig-texto', 'ig-emoji'],
    objetivo: 'Anticipar la duda más habitual y desactivarla con honestidad.',
  },
  cta: {
    foto: 'persona cerca, luz natural, la más cálida',
    velo: 0,
    zona: 'abajo',
    layout: 'sticker',
    componentes: ['ig-caja-acento', 'ig-sticker-escribe', 'ig-marcador'],
    objetivo:
      'Una sola acción de fricción mínima: una palabra clave por mensaje, una pregunta o un sticker. Cierra con un regalo o la siguiente historia.',
  },
}

type Categoria = {
  id: CategoriaId
  label: string
  /** Cuándo usarla. */
  cuando: string
  /** Rasgos propios que la distinguen. */
  rasgos: string
  arcos: Record<LongitudSecuencia, Etapa[]>
}

export const CATEGORIAS: Record<CategoriaId, Categoria> = {
  opinion_error: {
    id: 'opinion_error',
    label: 'Opinión / el mayor error',
    cuando: 'Posicionarte con una tesis clara y generar conversación.',
    rasgos:
      'Selfie o plano a cámara en el mismo lugar en todas; gancho «El mayor error que veo…»; cierra con la tesis.',
    arcos: {
      3: ['gancho', 'problema', 'cta'],
      5: ['gancho', 'problema', 'porque', 'cambio', 'cta'],
      7: ['gancho', 'problema', 'porque', 'ejemplo', 'objecion', 'cambio', 'cta'],
    },
  },
  antes_ahora: {
    id: 'antes_ahora',
    label: 'Educativa «antes vs ahora»',
    cuando: 'Explicar un cambio de tendencia o método que la audiencia aún aplica mal.',
    rasgos:
      'Fondo muy oscuro, titulares serif enormes, recuadros con borde de acento 2025/2026, ☠️ ⚠️ ✅ ❌; serie repetible.',
    arcos: {
      3: ['gancho', 'cambio', 'cta'],
      5: ['gancho', 'cambio', 'cambio', 'ejemplo', 'cta'],
      7: ['gancho', 'cambio', 'cambio', 'cambio', 'ejemplo', 'porque', 'cta'],
    },
  },
  contraste_nivel: {
    id: 'contraste_nivel',
    label: 'Contraste de nivel',
    cuando: 'Mostrar la diferencia entre dos niveles o enfoques (sin nombrar a nadie).',
    rasgos:
      'Pantalla partida arriba/abajo, blanco y negro frente a color, etiquetas «X que hace -3k / +10k» y cajas de texto.',
    arcos: {
      3: ['gancho', 'cambio', 'cta'],
      5: ['gancho', 'cambio', 'cambio', 'porque', 'cta'],
      7: ['gancho', 'cambio', 'cambio', 'cambio', 'porque', 'objecion', 'cta'],
    },
  },
  pregunta_respuesta: {
    id: 'pregunta_respuesta',
    label: 'Pregunta y respuesta',
    cuando: 'Generar interacción y mostrar criterio respondiendo preguntas reales de la audiencia.',
    rasgos:
      'Sticker de preguntas en cada historia, respuesta hablando a cámara, criterios con ✅/❌, regalo como gancho.',
    arcos: {
      3: ['gancho', 'porque', 'cta'],
      5: ['gancho', 'porque', 'porque', 'objecion', 'cta'],
      7: ['gancho', 'porque', 'porque', 'objecion', 'ejemplo', 'porque', 'cta'],
    },
  },
  caso_prueba: {
    id: 'caso_prueba',
    label: 'Caso con prueba y cifras',
    cuando: 'Demostrar resultados reales (propios o de clientes) con capturas.',
    rasgos:
      'Capturas de analíticas, tablas o perfiles sobre fondo oscuro; etiquetas «Logro: / Qué he hecho:»; cierre «te enseño cómo replicarlo».',
    arcos: {
      3: ['gancho', 'prueba', 'cta'],
      5: ['gancho', 'problema', 'prueba', 'ejemplo', 'cta'],
      7: ['gancho', 'problema', 'ejemplo', 'prueba', 'prueba', 'porque', 'cta'],
    },
  },
  marco_diagrama: {
    id: 'marco_diagrama',
    label: 'Marco / diagrama',
    cuando: 'Enseñar un método o sistema con un esquema (embudo, pasos, comparativa).',
    rasgos: 'Esquema dibujado sobre selfie, comparativa ❌/✅, flechas a mano, chips numerados 1️⃣ 2️⃣ 3️⃣.',
    arcos: {
      3: ['gancho', 'cambio', 'cta'],
      5: ['gancho', 'problema', 'cambio', 'ejemplo', 'cta'],
      7: ['gancho', 'problema', 'cambio', 'cambio', 'ejemplo', 'porque', 'cta'],
    },
  },
  insider: {
    id: 'insider',
    label: 'Insider / storytelling',
    cuando: 'Despertar curiosidad con un giro, una «filtración» o una anécdota.',
    rasgos:
      'Foto expresiva (sorpresa), titular en caja de acento, notas tipo «(la cara que se me ha quedado)» con flecha a mano.',
    arcos: {
      3: ['gancho', 'ejemplo', 'cta'],
      5: ['gancho', 'problema', 'ejemplo', 'porque', 'cta'],
      7: ['gancho', 'problema', 'ejemplo', 'ejemplo', 'porque', 'objecion', 'cta'],
    },
  },
}

export type PasoSecuencia = EspecEtapa & {
  n: number
  etapa: Etapa
}

/** Plan paso a paso de una secuencia: qué etapa, foto, velo, zona y componentes lleva cada historia. */
export function planDeSecuencia(categoria: CategoriaId, longitud: LongitudSecuencia): PasoSecuencia[] {
  const cat = CATEGORIAS[categoria]
  if (!cat) throw new Error(`Categoría de historias desconocida: ${categoria}`)
  const arco = cat.arcos[longitud]
  if (!arco) throw new Error('La longitud debe ser 3, 5 o 7')
  return arco.map((etapa, i) => ({ n: i + 1, etapa, ...ETAPAS[etapa] }))
}

/** Longitud válida más cercana a la pedida (por defecto 5). */
export function longitudValida(n: number | null | undefined): LongitudSecuencia {
  if (!n || !Number.isFinite(n)) return 5
  if (n <= 3) return 3
  if (n <= 5) return 5
  return 7
}

/**
 * Sección del prompt del agente para proyectos de HISTORIAS (9:16). Describe las categorías y sus arcos,
 * las reglas de lo «nativo» y los componentes disponibles.
 */
export function seccionHistoriasPrompt(): string {
  const categorias = Object.values(CATEGORIAS)
    .map(
      (c) =>
        `- ${c.id} — ${c.label}: ${c.cuando} ${c.rasgos}\n  Arcos: 3 = ${c.arcos[3].join(' → ')}; 5 = ${c.arcos[5].join(' → ')}; 7 = ${c.arcos[7].join(' → ')}`
    )
    .join('\n')
  const etapas = (Object.entries(ETAPAS) as [Etapa, EspecEtapa][])
    .map(([e, s]) => `- ${e}: layout «${s.layout}»; foto = ${s.foto}. ${s.objetivo}`)
    .join('\n')
  return `## Cómo trabajas con HISTORIAS (9:16): que parezcan hechas en el editor de Instagram
Una secuencia son 3, 5 o 7 historias (por defecto 5; usa EXACTAMENTE las que pida el usuario, redondeando a 3/5/7). Elige la categoría que mejor encaje con lo que cuenta el usuario y sigue su arco, una idea por historia, y di cuál has elegido en una frase.

Categorías:
${categorias}

Etapas (qué plantilla usar y qué foto le conviene):
${etapas}

Cómo se construye cada historia: llamas a add_story con una PLANTILLA y el texto; la app coloca todo (foto limpia, foto oscurecida o fondo liso; fecha, logo, titular, cajas y stickers sin que se pisen y dentro de la zona segura). NO escribas HTML ni posiciones. Plantillas:
- portada: gancho con titular grande; foto limpia a pantalla completa. Campos: titulo, acento (palabra a resaltar), texto opcional.
- texto: una idea en texto sobre foto oscurecida o fondo liso. Campos: titulo y/o texto, acento.
- foto_texto: la foto manda y el texto va en una caja abajo. Campos: texto (y titulo opcional).
- comparacion: dos recuadros (❌ antes / ✅ ahora). Campos: items [{icono, titulo, texto}] (máx 2), titulo opcional.
- sticker: pregunta o llamada a la acción. Campos: sticker {tipo: "pregunta"|"escribe", cabecera, texto}, titulo opcional.
- cifra: un dato grande. Campos: cifra (ej. "+37%"), titulo o texto que lo explica. Solo cifras que dé el negocio.
- partida: pantalla partida con dos fotos (foto y foto2). Campos: titulo.
- captura: PRUEBA REAL (captura de un pago, testimonio de una alumna, resultado, foto de una alumna). Campos: pedido {clave, tipo, titulo}, titulo/texto opcionales. Si la imagen ya está subida (lista «Material real») usa su misma clave; si no, la app se la pedirá a la persona.
Texto como en el editor de Instagram: fuente (classic por defecto; strong para ganchos de impacto; typewriter para confesiones; modern; neon para destacar; serif para titulares elegantes), fondoTexto (sin caja, solido o translucido, como el botón «A» del editor) y colorTexto (blanco, negro o marca). Emojis: los de Instagram en iPhone, escritos como texto (✅ ❌ ⚠️ 🔥 👇 👀 💡 🤯), máximo 1 o 2 por historia y solo con función (señalar, marcar bien/mal); nunca iconos dibujados ni SVG.
Campos comunes: foto (número de la lista de fotos/vídeos; si no lo pones se reparte solo), fondo "liso" para dar respiro entre fotos, fecha (true solo en la primera), ultima (true en la de cierre, lleva el logo).

Reglas (obligatorias):
1. UNA palabra de acento por historia (campo acento) y una sola idea por historia; titulares de máximo ~8 palabras, textos de máximo ~25.
2. Cada foto o vídeo se usa donde encaja: el gancho y el cierre con foto limpia; el desarrollo oscurecido; si hay menos fotos que historias, alterna con fondo liso en vez de repetir.
3. Primera historia: portada con fecha. Última: sticker (una sola acción: palabra clave por mensaje, pregunta o regalo), con ultima true.
4. Cierra cada historia (salvo la última) con un bucle abierto breve hacia la siguiente («te lo cuento en la siguiente»).
5. Escribe como habla la persona: frases cortas, tuteo, sin jerga, sin promesas de resultados garantizados ni cifras que no estén en el contexto del negocio.
6. Cuando una historia necesite autoridad (pagos, testimonios, resultados, alumnas), usa la plantilla captura con un pedido: NUNCA inventes capturas, cifras ni testimonios. Pide solo el material que de verdad aporta prueba (máximo 2 o 3 por secuencia).
7. Para cambiar una historia usa update_story (misma plantilla de campos); para quitar una, delete_slide.`
}

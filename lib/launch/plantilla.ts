import type { Canal, DatosPieza } from './contenido'

// Plantilla estándar de un lanzamiento (calendario de contenido) y checklist por fase. Es la
// metodología general de un lanzamiento con webinar: captación 7-14 días, nutrición desde 10 días
// antes, recta final de 2-3 días, día del directo y cierre. Los días son RELATIVOS al evento
// (0 = día del evento), igual que `launch_content.dia`, así que aplicar la plantilla a cualquier
// lanzamiento no exige recalcular fechas. Los textos son una guía de qué toca cada día, no copy
// final: el copy lo escribe el equipo (o la IA) a partir del guion del webinar de cada tenant.

type Pieza = Required<Pick<DatosPieza, 'canal' | 'dia' | 'titulo'>> &
  Pick<DatosPieza, 'hora' | 'texto'> & {
    canal: Canal
  }

const e = (dia: number, titulo: string, texto: string, hora?: string): Pieza => ({
  canal: 'email',
  dia,
  titulo,
  texto,
  hora: hora ?? null,
})
const w = (dia: number, titulo: string, texto: string, canal: Canal = 'whatsapp'): Pieza => ({
  canal,
  dia,
  titulo,
  texto,
  hora: null,
})

/** Secuencia de emails: registro, un email diario de nutrición, recta final, día D (4) y post. */
const EMAILS: Pieza[] = [
  e(-10, 'Email de registro', 'Confirmación, qué van a vivir en el evento y primer paso (entrar al grupo).'),
  e(-9, 'Nutrición 1', 'Primer peldaño: el problema que ya tienen, con ejemplos de su día a día.'),
  e(-8, 'Nutrición 2', 'Por qué el problema va a peor si no se corrige.'),
  e(-7, 'Nutrición 3', 'Las soluciones que probaron y por qué no podían funcionar.'),
  e(-6, 'Nutrición 4', 'Prueba social: gente como ellos que ya cambió.'),
  e(-5, 'Nutrición 5', 'Autoridad y conexión: por qué esta persona puede guiarles.'),
  e(-4, 'Nutrición 6', 'Qué van a ver en el directo (el QUÉ, nunca el CÓMO).'),
  e(-3, 'Nutrición 7', 'Objeción frecuente: tiempo, miedo o «no seré capaz».'),
  e(-2, 'Nutrición 8', 'Elevar el nivel de conciencia y preparar la recta final.'),
  e(-1, 'Recta final', 'Mañana es el directo: escasez real y recordatorio de hora.'),
  e(0, 'Día D · aviso de la mañana', 'Hoy es el día: hora, enlace y motivo por el que se apuntaron.', '09:00'),
  e(0, 'Día D · mediodía', 'Recordatorio corto con cuenta atrás.', '12:00'),
  e(0, 'Día D · a la hora exacta', 'Estamos en directo: enlace y nada más.'),
  e(0, 'Día D · 30 min después', 'Ahora mismo estamos viendo esto y te lo estás perdiendo.'),
  e(1, 'Post · replay', 'Replay con caducidad y llamada a agendar.'),
  e(3, 'Post · objeciones', 'Respuesta a las dudas más frecuentes del directo.'),
  e(5, 'Post · último aviso', 'Cierre del carrito: qué pierden si no deciden.'),
]

/** Calentamiento del grupo de WhatsApp: una función distinta cada día, hasta el cierre. */
const WHATSAPP: Pieza[] = [
  w(-10, 'Grupo · bienvenida', 'Bienvenida, fecha y hora del evento y encuesta de entrada.'),
  w(-10, 'Grupo · encuesta de entrada', 'Una pregunta de una línea para conocer a la audiencia.', 'encuesta'),
  w(-9, 'Grupo · el problema', 'Contar el problema con una historia propia.'),
  w(-8, 'Grupo · el problema (2)', 'Un audio o vídeo corto del experto.'),
  w(-7, 'Grupo · va a peor', 'El enemigo tiene nombre y no es culpa suya.'),
  w(-6, 'Grupo · falsas soluciones', 'Lo que probaron no podía funcionar.'),
  w(-5, 'Grupo · el mecanismo', 'Qué es y por qué funciona, sin dar el cómo.'),
  w(-4, 'Grupo · prueba social', 'Un caso parecido a la audiencia.'),
  w(-3, 'Grupo · objeciones', 'Tiempo y dinero: cómo se resuelven.'),
  w(-2, 'Grupo · objeciones (2)', 'Miedo y «no seré capaz».'),
  w(-1, 'Grupo · se abre la puerta', 'Mañana se abre algo, en directo y sin repetición.'),
  w(0, 'Grupo · cuenta atrás', 'Mensajes cortos a -3 h, -1 h y -15 min; el último, una línea.'),
  w(0, 'Grupo · durante el directo', 'Empujones anclados a los momentos clave del guion.'),
  w(1, 'Grupo · cierre', 'Casos, objeciones y bienvenida a los que entran.'),
]

/** Contenido de redes durante la captación y el hype. */
const REDES: Pieza[] = [
  w(-14, 'Reel de captación 1', 'Gancho del guion del webinar; versión A.', 'reel'),
  w(-12, 'Carrusel de captación', 'Una creencia del webinar en 8-10 slides.', 'post'),
  w(-10, 'Historias · arranque', 'Calendario de historias: invitación al evento.', 'stories'),
  w(-7, 'Reel de captación 2', 'Otro ángulo del mismo guion.', 'reel'),
  w(-3, 'Historias · recta final', 'Recordatorio, escasez y prueba social.', 'stories'),
  w(0, 'Historias · directo', 'Avisos durante el día del evento.', 'stories'),
  w(0, 'Directo / webinar', 'Emisión del evento.', 'directo'),
]

export const PLANTILLA_ESTANDAR: readonly Pieza[] = [...EMAILS, ...WHATSAPP, ...REDES]

/** Piezas listas para insertar (`launch_content`), todas en «pendiente» y como publicación. */
export function piezasDePlantilla(): DatosPieza[] {
  return PLANTILLA_ESTANDAR.map((p) => ({
    tipo: 'publicacion',
    canal: p.canal,
    dia: p.dia,
    hora: p.hora ?? null,
    titulo: p.titulo,
    texto: p.texto ?? null,
  }))
}

export type ItemChecklist = { key: string; texto: string }
export type FaseChecklist = { id: string; titulo: string; items: ItemChecklist[] }

const i = (key: string, texto: string): ItemChecklist => ({ key, texto })

export const CHECKLIST: readonly FaseChecklist[] = [
  {
    id: 'diseno',
    titulo: 'Diseño',
    items: [
      i('diseno-reuniones', 'Reuniones con el experto hechas y analizadas'),
      i('diseno-oferta', 'Producto, escalera de valor y precio decididos'),
      i('diseno-embudo', 'Tipo de embudo y calendario cerrados'),
      i('diseno-horario', 'Hora del evento validada con el reparto geográfico de la audiencia'),
    ],
  },
  {
    id: 'webinar',
    titulo: 'Webinar',
    items: [
      i('webinar-creencia', 'Única creencia escrita en una frase'),
      i('webinar-nombre', 'Gran idea y nombre del evento cerrados'),
      i('webinar-guion', 'Guion completo revisado por el cliente'),
      i('webinar-oferta', 'Oferta final construida (valor, precio, bonus, garantía)'),
      i('webinar-montaje', 'Webinar montado y probado'),
    ],
  },
  {
    id: 'captacion',
    titulo: 'Captación',
    items: [
      i('captacion-angulos', 'Tabla de ángulos definida'),
      i('captacion-reels', 'Reels y carruseles listos'),
      i('captacion-historias', 'Calendario de historias cargado'),
      i('captacion-anuncios', 'Anuncios escritos y subidos, uno por ángulo'),
      i('captacion-landings', 'Una landing por ángulo'),
      i('captacion-pixel', 'Píxel y API de conversiones verificados con un evento de prueba'),
      i('captacion-medicion', 'CRM midiendo visitas → registros → comunidad'),
    ],
  },
  {
    id: 'nutricion',
    titulo: 'Nutrición',
    items: [
      i('nutricion-emails', 'Secuencia de emails cargada y programada'),
      i('nutricion-dia-d', 'Los 4 emails del día del evento a su hora'),
      i('nutricion-grupo', 'Calentamiento del grupo preparado día a día'),
      i('nutricion-encuestas', 'Encuestas y dinámicas del grupo listas'),
      i('nutricion-replay', 'Página de replay preparada'),
    ],
  },
  {
    id: 'informe',
    titulo: 'Informe',
    items: [
      i('informe-etiquetas', 'Definido qué se etiqueta en cada paso (avatar, dolor, deseo)'),
      i('informe-creativo', 'Creativo de origen guardado en cada lead'),
      i('informe-intermedio', 'Informe intermedio revisado y cambios aplicados'),
      i('informe-final', 'Informe final generado al cerrar el carrito'),
    ],
  },
]

export const CLAVES_CHECKLIST: ReadonlySet<string> = new Set(CHECKLIST.flatMap((f) => f.items.map((x) => x.key)))

/** Progreso por fase y total. `hechas` son las claves marcadas; las desconocidas se ignoran. */
export function progresoChecklist(hechas: Iterable<string>) {
  const marcadas = new Set(hechas)
  const porFase = CHECKLIST.map((f) => {
    const hecho = f.items.filter((x) => marcadas.has(x.key)).length
    return { id: f.id, hecho, total: f.items.length }
  })
  const hecho = porFase.reduce((a, f) => a + f.hecho, 0)
  const total = porFase.reduce((a, f) => a + f.total, 0)
  return { porFase, hecho, total }
}

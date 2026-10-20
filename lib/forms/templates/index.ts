// Plantillas precreadas. Son neutras (sin marca ni personas): al instanciarlas se copian a la
// subcuenta como un formulario en BORRADOR, que se edita y se publica como cualquier otro.

import type {
  Condition,
  Ending,
  FormAudience,
  FormCategory,
  FormConfig,
  LogicRule,
  Question,
  QuestionOption,
  ScoringWeight,
} from '../types'

export interface FormTemplate {
  key: string
  name: string
  description: string
  category: FormCategory
  audience: FormAudience
  slug: string
  config: FormConfig
}

/** 'valor|Etiqueta' → opción. */
const opts = (...list: string[]): QuestionOption[] =>
  list.map((s) => {
    const [value, label] = s.split('|')
    return { value, label: label ?? value }
  })

const when = (...conditions: Condition[]) => ({ match: 'all' as const, conditions })
const gracias = (message: string): Ending => ({ id: 'gracias', title: 'Gracias', message, isDefault: true })
const w = (questionId: string, value: string, points: number): ScoringWeight => ({ questionId, value, points })
const wIn = (questionId: string, list: string[], points: number): ScoringWeight => ({ questionId, in: list, points })

const contact = (): Question[] => [
  { id: 'nombre', type: 'shortText', title: '¿Cómo te llamas?', required: true, semantic: 'contact.name' },
  { id: 'email', type: 'email', title: '¿Cuál es tu email?', required: true, semantic: 'contact.email' },
  { id: 'telefono', type: 'phone', title: '¿Y tu teléfono?', required: true, semantic: 'contact.phone' },
]

/** Estrellas ≥4 → final con redirección a Trustpilot; <4 → pregunta de mejora → gracias. */
function starsFlow(): { logic: LogicRule[]; endings: Ending[] } {
  const alta = when({ questionId: 'estrellas', op: 'gte', value: 4 })
  return {
    logic: [{ id: 'alta', from: 'estrellas', when: alta, then: { type: 'end', endingId: 'resena' } }],
    endings: [
      {
        id: 'resena',
        title: '¡Gracias por tu valoración!',
        message: 'Nos ayudaría mucho que lo cuentes en una reseña pública.',
        ctaLabel: 'Dejar reseña',
        redirectUrl: '{{trustpilot_url}}',
        redirectDelayMs: 2500,
        when: alta,
      },
      gracias('Leemos todos los comentarios para mejorar.'),
    ],
  }
}

const base = (c: Omit<FormConfig, 'schemaVersion'>): FormConfig => ({ schemaVersion: 1, ...c })

const cualificacionCliente: FormTemplate = {
  key: 'cualificacion-cliente',
  name: 'Cualificación de clientes',
  description:
    'Filtra y puntúa a quien quiere trabajar contigo: situación, facturación y decisión. Calcula temperatura (caliente, templado, frío).',
  category: 'cualificacion_cliente',
  audience: 'cualificacion',
  slug: 'cualificacion-clientes',
  config: base({
    welcome: {
      kicker: 'Solicitud',
      title: 'Cuéntanos de ti',
      subtitle: 'Unas preguntas rápidas para ver cómo podemos ayudarte.',
      cta: 'Empezar',
      estimatedTime: '2 minutos',
    },
    questions: [
      ...contact(),
      {
        id: 'situacion',
        type: 'singleChoice',
        title: '¿Cuál es tu situación actual?',
        required: true,
        semantic: 'qualification.situacion',
        options: opts(
          'empleado|Trabajo por cuenta ajena',
          'autonomo|Soy autónomo/a',
          'empresa|Tengo una empresa',
          'otro|Otra'
        ),
      },
      {
        id: 'facturacion',
        type: 'singleChoice',
        title: '¿Cuánto facturas al mes ahora mismo?',
        required: true,
        semantic: 'qualification.facturacion',
        options: opts(
          '0-500|Menos de 500 €',
          '500-1500|500 – 1.500 €',
          '1500-3000|1.500 – 3.000 €',
          '3000+|Más de 3.000 €'
        ),
      },
      {
        id: 'listo',
        type: 'yesNo',
        title: '¿Estás listo/a para invertir en tu crecimiento si encaja?',
        required: true,
        semantic: 'qualification.listo',
      },
      {
        id: 'objecion',
        type: 'singleChoice',
        title: '¿Qué te frena?',
        semantic: 'qualification.objecion',
        showIf: when({ questionId: 'listo', op: 'equals', value: 'no' }),
        options: opts('precio|El precio', 'tiempo|El tiempo', 'confianza|Necesito más información', 'otro|Otra cosa'),
      },
    ],
    logic: [],
    endings: [
      {
        id: 'prioritario',
        title: '¡Encajas muy bien!',
        message: 'Te contactaremos en menos de 24 horas.',
        when: when({ questionId: '$temperature', op: 'equals', value: 'caliente' }),
      },
      gracias('Revisaremos tu solicitud y te escribiremos pronto.'),
    ],
    scoring: {
      enabled: true,
      tagPrefix: 'cualificacion',
      thresholds: { caliente: 70, templado: 40 },
      weights: [
        w('listo', 'yes', 45),
        w('facturacion', '3000+', 35),
        w('facturacion', '1500-3000', 22),
        w('facturacion', '500-1500', 10),
        w('facturacion', '0-500', 5),
        w('situacion', 'autonomo', 15),
        wIn('situacion', ['empresa', 'empleado', 'otro'], 5),
      ],
    },
  }),
}

const empleado = (
  key: string,
  name: string,
  category: FormCategory,
  slug: string,
  role: string,
  extra: Question[],
  weights: ScoringWeight[],
  description: string
): FormTemplate => ({
  key,
  name,
  description,
  category,
  audience: 'empleados',
  slug,
  config: base({
    welcome: {
      kicker: 'Candidatura',
      title: `Únete al equipo como ${role}`,
      subtitle: 'Cuéntanos tu experiencia. Revisamos cada candidatura.',
      cta: 'Empezar',
      estimatedTime: '4 minutos',
    },
    questions: [
      ...contact(),
      {
        id: 'experiencia',
        type: 'singleChoice',
        title: `¿Cuánta experiencia tienes como ${role}?`,
        required: true,
        options: opts('0|Ninguna todavía', '1|Menos de 1 año', '1-3|1 – 3 años', '3+|Más de 3 años'),
      },
      ...extra,
      {
        id: 'disponibilidad',
        type: 'singleChoice',
        title: '¿Qué disponibilidad tienes?',
        required: true,
        options: opts('completa|Jornada completa', 'parcial|Media jornada', 'puntual|Solo por proyectos'),
      },
      {
        id: 'motivo',
        type: 'longText',
        title: '¿Por qué quieres este puesto y qué aportarías?',
        required: true,
        maxLength: 1500,
      },
      { id: 'enlace', type: 'url', title: 'Enlace a tu LinkedIn o portfolio', help: 'Opcional, pero ayuda mucho.' },
      {
        id: 'consentimiento',
        type: 'consent',
        title: 'Tratamiento de datos',
        required: true,
        placeholder: 'Acepto que se traten mis datos para el proceso de selección.',
      },
    ],
    logic: [],
    endings: [gracias('Hemos recibido tu candidatura. Si encaja, te contactaremos para una entrevista.')],
    scoring: {
      enabled: true,
      tagPrefix: key,
      thresholds: { caliente: 65, templado: 35 },
      weights: [
        w('experiencia', '3+', 30),
        w('experiencia', '1-3', 20),
        w('experiencia', '1', 8),
        w('disponibilidad', 'completa', 15),
        w('disponibilidad', 'parcial', 8),
        ...weights,
      ],
    },
  }),
})

const setter = empleado(
  'cualificacion-setter',
  'Cualificación de setters',
  'empleado_setter',
  'candidatura-setter',
  'setter',
  [
    {
      id: 'mensajes',
      type: 'singleChoice',
      title: '¿Cuántos mensajes o llamadas gestionabas al día?',
      required: true,
      options: opts('<20|Menos de 20', '20-50|20 – 50', '50+|Más de 50'),
    },
    {
      id: 'herramientas',
      type: 'multiChoice',
      title: '¿Qué herramientas dominas?',
      options: opts('crm|CRM', 'instagram|Instagram DM', 'whatsapp|WhatsApp', 'llamadas|Llamadas en frío'),
      allowOther: true,
    },
  ],
  [w('mensajes', '50+', 20), w('mensajes', '20-50', 12)],
  'Candidatos a setter: volumen de contactos, herramientas, disponibilidad y motivación.'
)

const closer = empleado(
  'cualificacion-closer',
  'Cualificación de closers',
  'empleado_closer',
  'candidatura-closer',
  'closer',
  [
    {
      id: 'ticket',
      type: 'singleChoice',
      title: '¿Cuál ha sido el ticket medio que has cerrado?',
      required: true,
      options: opts('<1000|Menos de 1.000 €', '1000-3000|1.000 – 3.000 €', '3000+|Más de 3.000 €'),
    },
    {
      id: 'cierre',
      type: 'singleChoice',
      title: '¿Qué porcentaje de cierre tienes en llamadas?',
      required: true,
      options: opts('<15|Menos del 15 %', '15-30|15 – 30 %', '30+|Más del 30 %'),
    },
    { id: 'caso', type: 'longText', title: 'Cuéntanos tu mejor cierre', maxLength: 1500 },
  ],
  [w('ticket', '3000+', 15), w('ticket', '1000-3000', 8), w('cierre', '30+', 20), w('cierre', '15-30', 10)],
  'Candidatos a closer: ticket medio, % de cierre, mejor caso y disponibilidad.'
)

const mediaBuyer = empleado(
  'cualificacion-media-buyer',
  'Cualificación de media buyers',
  'empleado_media_buyer',
  'candidatura-media-buyer',
  'media buyer',
  [
    {
      id: 'plataformas',
      type: 'multiChoice',
      title: '¿Qué plataformas de anuncios manejas?',
      required: true,
      options: opts('meta|Meta Ads', 'google|Google Ads', 'tiktok|TikTok Ads', 'youtube|YouTube Ads'),
    },
    {
      id: 'gasto',
      type: 'singleChoice',
      title: '¿Qué gasto mensual has gestionado?',
      required: true,
      options: opts('<3k|Menos de 3.000 €', '3k-20k|3.000 – 20.000 €', '20k+|Más de 20.000 €'),
    },
    {
      id: 'roas',
      type: 'shortText',
      title: '¿Qué ROAS o CPL medio sueles conseguir?',
      help: 'Indica el sector y el dato.',
    },
    { id: 'caso', type: 'longText', title: 'Describe una campaña de la que estés orgulloso/a', maxLength: 1500 },
  ],
  [w('gasto', '20k+', 25), w('gasto', '3k-20k', 14)],
  'Candidatos a media buyer: plataformas, gasto gestionado, resultados y un caso real.'
)

const feedbackBase = (
  key: string,
  name: string,
  category: FormCategory,
  slug: string,
  description: string,
  specific: Question[],
  title: string
): FormTemplate => ({
  key,
  name,
  description,
  category,
  audience: 'alumnos',
  slug,
  config: base({
    welcome: {
      title,
      subtitle: 'Tu opinión mejora la formación. Son 30 segundos.',
      cta: 'Valorar',
      estimatedTime: '30 segundos',
    },
    questions: [
      ...specific,
      {
        id: 'estrellas',
        type: 'rating',
        title: '¿Qué valoración le das?',
        required: true,
        scaleMax: 5,
        semantic: 'rating',
      },
      {
        id: 'mejora',
        type: 'longText',
        title: '¿Qué podríamos mejorar?',
        help: 'Sé todo lo concreto que puedas.',
        required: true,
        maxLength: 1500,
      },
      {
        id: 'email',
        type: 'email',
        title: 'Tu email',
        help: 'Para vincular tu respuesta a tu ficha de alumno.',
        semantic: 'contact.email',
      },
    ],
    ...starsFlow(),
  }),
})

const feedbackClase = feedbackBase(
  'feedback-clase-directo',
  'Feedback de clases en directo',
  'feedback_clase',
  'feedback-clase',
  'Estrellas tras cada clase en directo. 4 o más lleva a Trustpilot; menos, a un formulario de mejora que alimenta el dashboard de profesores.',
  [
    {
      id: 'profesor',
      type: 'dropdown',
      title: '¿Qué profesor/a ha dado la clase?',
      required: true,
      semantic: 'teacher',
      options: opts('profesor-1|Profesor 1', 'profesor-2|Profesor 2'),
    },
    { id: 'clase', type: 'shortText', title: '¿Cómo se llamaba la clase?', semantic: 'class' },
  ],
  '¿Qué tal la clase en directo?'
)

const feedbackModulo = feedbackBase(
  'feedback-modulo',
  'Feedback de módulos',
  'feedback_modulo',
  'feedback-modulo',
  'Valoración al terminar cada módulo del programa, con el mismo enrutado a Trustpilot o a mejora.',
  [
    {
      id: 'modulo',
      type: 'dropdown',
      title: '¿Qué módulo has terminado?',
      required: true,
      semantic: 'module',
      options: opts('modulo-1|Módulo 1', 'modulo-2|Módulo 2', 'modulo-3|Módulo 3', 'modulo-4|Módulo 4'),
    },
    {
      id: 'profesor',
      type: 'dropdown',
      title: '¿Quién lo imparte?',
      semantic: 'teacher',
      options: opts('profesor-1|Profesor 1', 'profesor-2|Profesor 2'),
    },
  ],
  '¿Qué te ha parecido el módulo?'
)

const nps: FormTemplate = {
  key: 'nps-cliente',
  name: 'Feedback de cliente (NPS)',
  description: 'Pregunta de recomendación 0-10 y motivo. Puntuaciones de 9 o más llevan a Trustpilot.',
  category: 'feedback_cliente',
  audience: 'alumnos',
  slug: 'feedback-cliente',
  config: base({
    welcome: {
      title: 'Tu opinión nos importa',
      subtitle: 'Una pregunta y un comentario.',
      cta: 'Empezar',
      estimatedTime: '1 minuto',
    },
    questions: [
      {
        id: 'nps',
        type: 'nps',
        title: '¿Con qué probabilidad nos recomendarías a un amigo o colega?',
        required: true,
        semantic: 'nps',
        scaleLabels: { min: 'Nada probable', max: 'Muy probable' },
      },
      { id: 'motivo', type: 'longText', title: '¿Cuál es el motivo principal de tu puntuación?', maxLength: 1500 },
      {
        id: 'email',
        type: 'email',
        title: 'Tu email',
        help: 'Para vincular tu respuesta a tu ficha.',
        semantic: 'contact.email',
      },
    ],
    logic: [
      {
        id: 'promotor',
        from: 'nps',
        when: when({ questionId: 'nps', op: 'gte', value: 9 }),
        then: { type: 'end', endingId: 'resena' },
      },
    ],
    endings: [
      {
        id: 'resena',
        title: '¡Gracias!',
        message: '¿Nos dejas una reseña pública? Nos ayuda muchísimo.',
        ctaLabel: 'Dejar reseña',
        redirectUrl: '{{trustpilot_url}}',
        redirectDelayMs: 2500,
        when: when({ questionId: 'nps', op: 'gte', value: 9 }),
      },
      gracias('Gracias por tu sinceridad.'),
    ],
  }),
}

export const FORM_TEMPLATES: FormTemplate[] = [
  cualificacionCliente,
  setter,
  closer,
  mediaBuyer,
  feedbackClase,
  feedbackModulo,
  nps,
]

export const templateByKey = (key: string): FormTemplate | undefined => FORM_TEMPLATES.find((t) => t.key === key)

/** Config vacía para "formulario en blanco". */
export const blankConfig = (): FormConfig =>
  base({
    welcome: { title: 'Nuevo formulario', cta: 'Empezar' },
    questions: [{ id: 'pregunta-1', type: 'shortText', title: 'Tu primera pregunta', required: true }],
    logic: [],
    endings: [gracias('Hemos recibido tus respuestas.')],
  })

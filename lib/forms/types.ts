// Modelo de un formulario conversacional. Es la fuente única de tipos del módulo: el motor público,
// el constructor, la validación del servidor y las plantillas importan de aquí.
//
// Es JSON puro (se guarda en `form_versions.config`): nada de funciones ni clases. Los pesos de
// scoring viven en `config.scoring` y NUNCA viajan al navegador público (`stripForPublic`).

export const FIELD_TYPES = [
  'shortText',
  'longText',
  'email',
  'phone',
  'number',
  'url',
  'date',
  'singleChoice',
  'multiChoice',
  'yesNo',
  'dropdown',
  'rating',
  'nps',
  'scale',
  'statement',
  'consent',
  'booking',
  'hidden',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

/** Tipos que no piden nada al usuario: nunca llevan respuesta ni cuentan como pregunta visible. */
export const NON_INPUT_TYPES: readonly FieldType[] = ['statement', 'hidden']

/**
 * Rol semántico: lo que la pregunta SIGNIFICA, con independencia de su id. Es lo que enlaza una
 * respuesta con el contacto, las estrellas/NPS y el dashboard de profesores.
 */
export type SemanticRole =
  | 'contact.name'
  | 'contact.email'
  | 'contact.phone'
  | 'rating'
  | 'nps'
  | 'teacher'
  | 'module'
  | 'class'
  | `qualification.${string}`

export type Scalar = string | number | boolean

export interface QuestionOption {
  value: string
  label: string
  /** Nombre de icono de lucide-react (nunca emoji: las páginas públicas no los admiten). */
  icon?: string
  /** Imagen de la opción (elección con imágenes). */
  imageUrl?: string
}

export type ConditionOperator =
  'equals' | 'notEquals' | 'in' | 'notIn' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'isAnswered' | 'isEmpty'

/**
 * `questionId` puede ser el id de una pregunta o una variable calculada que solo existe en el
 * servidor: `$score`, `$temperature`.
 */
export interface Condition {
  questionId: string
  op: ConditionOperator
  value?: Scalar | Scalar[]
}

export interface ConditionGroup {
  match: 'all' | 'any'
  conditions: Condition[]
}

export interface Question {
  id: string
  type: FieldType
  title: string
  help?: string
  required?: boolean
  placeholder?: string
  /** Nombre de icono lucide para la cabecera de la pregunta. */
  icon?: string
  /** Imagen bajo el título de la pregunta (https). */
  imageUrl?: string
  options?: QuestionOption[]
  /** Añade una opción "Otro" con texto libre (opción única/múltiple). */
  allowOther?: boolean
  /** Selección mínima/máxima (multiChoice) o rango numérico (number). */
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  /** Expresión regular (sin delimitadores) que debe cumplir la respuesta de texto. */
  pattern?: string
  patternMessage?: string
  /** Máximo de rating/scale (por defecto 5 / 5). nps es siempre 0-10. */
  scaleMax?: number
  scaleLabels?: { min?: string; max?: string }
  semantic?: SemanticRole
  /** Solo se muestra si se cumple (ocultar por rama). */
  showIf?: ConditionGroup
  /** `hidden`: nombre del parámetro de la URL que rellena el valor (p. ej. `profesor`, `utm_source`). */
  hiddenKey?: string
  /** `hidden`/`booking`: valor por defecto o URL del calendario. */
  defaultValue?: string
}

export type LogicAction = { type: 'jump'; target: string } | { type: 'end'; endingId: string }

/** Se evalúa al SALIR de la pregunta `from`; la primera regla que cumple gana. */
export interface LogicRule {
  id: string
  from: string
  when: ConditionGroup
  then: LogicAction
}

export interface Ending {
  id: string
  title: string
  message?: string
  ctaLabel?: string
  ctaUrl?: string
  /** Redirección automática. Admite `{{trustpilot_url}}`; la resuelve el servidor. */
  redirectUrl?: string
  redirectDelayMs?: number
  /** Final condicional. Se evalúan en orden; el primero que cumple gana, si no el `isDefault`. */
  when?: ConditionGroup
  isDefault?: boolean
}

export interface ScoringWeight {
  questionId: string
  value?: string
  in?: string[]
  points: number
}

export type Temperature = 'caliente' | 'templado' | 'frio'

export interface Scoring {
  enabled: boolean
  weights: ScoringWeight[]
  thresholds: { caliente: number; templado: number }
  tagPrefix?: string
}

export interface Welcome {
  kicker?: string
  title: string
  subtitle?: string
  cta: string
  estimatedTime?: string
}

export interface AbTest {
  field: 'title' | 'cta'
  a: string
  b: string
}

export interface FormTheme {
  mode: 'light' | 'dark' | 'auto'
  /** Logo propio. Sin él se usa el logo de la subcuenta (si `hideLogo` no lo oculta). */
  logoUrl?: string
  hideLogo?: boolean
  /** Imagen de la pantalla de bienvenida. */
  coverUrl?: string
  /** Color de acento (#rrggbb). Sin él se hereda el de la subcuenta. */
  accent?: string
  /** Color de fondo (#rrggbb) o imagen (https) con velo para que el texto siga leyéndose. */
  background?: string
  backgroundImageUrl?: string
  font?: 'sans' | 'display' | 'serif' | 'mono'
  radius?: 'sm' | 'md' | 'lg' | 'full'
}

export interface FormConfig {
  schemaVersion: 1
  welcome?: Welcome
  questions: Question[]
  logic: LogicRule[]
  endings: Ending[]
  scoring?: Scoring
  abTest?: AbTest
  theme?: FormTheme
}

export type Answer = string | string[] | number | boolean
export type Answers = Record<string, Answer | undefined>

export const FORM_CATEGORIES = [
  'cualificacion_cliente',
  'captacion',
  'empleado_setter',
  'empleado_closer',
  'empleado_media_buyer',
  'feedback_clase',
  'feedback_modulo',
  'feedback_cliente',
  'otro',
] as const
export type FormCategory = (typeof FORM_CATEGORIES)[number]

export const FORM_AUDIENCES = ['captacion', 'cualificacion', 'empleados', 'alumnos'] as const
export type FormAudience = (typeof FORM_AUDIENCES)[number]

export const FORM_STATUSES = ['draft', 'published', 'archived'] as const
export type FormStatus = (typeof FORM_STATUSES)[number]

export const REVIEW_STATUSES = ['nuevo', 'contactado', 'entrevista', 'descartado', 'contratado'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** Variables que el servidor puede inyectar en textos y redirecciones. */
export type FormVariables = Record<string, string | number | undefined>

export const MAX_QUESTIONS = 120
export const MAX_OPTIONS = 60
export const MAX_ANSWER_CHARS = 5000

// ─────────────────────────────────────────────────────────────────────────────
// CATÁLOGO Y RENDERIZADO DE PLANTILLAS DE EMAIL
// ─────────────────────────────────────────────────────────────────────────────
// Módulo PURO (sin Node ni Supabase): lo importan el servidor (envíos) y el
// editor de Configuración › Correos (vista previa en el navegador).
//
// Diseño: cada correo del sistema tiene un default (los HTML que antes vivían
// inline en resend.ts) y puede ser sobreescrito por subcuenta (tabla
// email_templates). El renderizador sustituye {{variables}} en asunto y cuerpo.
//
// REGLA DE FALLBACK: si (tenant_id, template_key) no tiene fila → default del
// catálogo. Guardar una fila y luego borrarla = volver al default. Nada se
// rompe si la tabla no existe todavía (los envíos pasan directo al default).

import type { CompanyProfile } from '@/lib/contracts/company'
import { PLANTILLAS_HTML } from './plantillas.generated'

export type EmailTemplateKey =
  | 'invite'
  | 'recovery'
  | 'contract'
  | 'contract_signed'
  | 'student_contract'
  | 'student_onboarding'
  | 'student_contract_signed'
  | 'task_assigned'

export type EmailVars = {
  company: CompanyProfile
  memberName?: string
  url?: string
  taskTitle?: string
  taskDescription?: string | null
  dueDate?: string | null
  priority?: string | null
  welcome?: string
  landingUrl?: string
}

// ── DEFAULTS (los HTML de resend.ts, variable a variable) ────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Asuntos por plantilla, con variables.
export const DEFAULT_SUBJECTS: Record<EmailTemplateKey, (v: EmailVars) => string> = {
  invite: (v) => `${v.company.name} · Crea tu contraseña para acceder`,
  recovery: (v) => `${v.company.name} · Restablecer contraseña`,
  contract: (v) => `${v.company.name} · Contrato para firmar`,
  contract_signed: (v) => `${v.company.name} · Copia de tu contrato firmado`,
  student_contract: (v) => `${v.company.name} · ¡Bienvenida! Acepta tus condiciones`,
  student_onboarding: (v) => `${v.company.name} · Tus accesos están listos — empieza aquí`,
  student_contract_signed: (v) => `${v.company.name} · Copia de tu contrato firmado`,
  task_assigned: (v) => `${v.company.name} · Nueva tarea: ${v.taskTitle ?? ''}`,
}

export function defaultSubject(key: EmailTemplateKey, vars: EmailVars): string {
  return DEFAULT_SUBJECTS[key](vars)
}

// Documentación de variables que muestra el editor, por plantilla.
export const TEMPLATE_VARIABLES: Record<EmailTemplateKey, { var: string; desc: string }[]> = {
  invite: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del invitado' },
    { var: '{{enlace}}', desc: 'Enlace para crear la contraseña' },
    { var: '{{firma}}', desc: 'Firma de email del perfil de empresa' },
  ],
  recovery: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{enlace}}', desc: 'Enlace para crear una nueva contraseña' },
  ],
  contract: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del colaborador' },
    { var: '{{enlace}}', desc: 'Enlace para revisar y firmar el contrato' },
    { var: '{{firma}}', desc: 'Firma de email del perfil de empresa' },
  ],
  contract_signed: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del colaborador' },
    { var: '{{enlace_pdf}}', desc: 'Enlace de descarga del PDF firmado (si hay)' },
    { var: '{{firma}}', desc: 'Firma de email del perfil de empresa' },
  ],
  student_contract: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del alumno' },
    { var: '{{enlace}}', desc: 'Enlace para aceptar condiciones' },
    { var: '{{bienvenida}}', desc: 'Mensaje de bienvenida configurado' },
  ],
  student_onboarding: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del alumno' },
    { var: '{{enlace}}', desc: 'Enlace a la landing de accesos' },
    { var: '{{firma}}', desc: 'Firma de email del perfil de empresa' },
  ],
  student_contract_signed: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del alumno' },
    { var: '{{enlace_pdf}}', desc: 'Enlace de descarga del PDF firmado (si hay)' },
    { var: '{{firma}}', desc: 'Firma de email del perfil de empresa' },
  ],
  task_assigned: [
    { var: '{{empresa}}', desc: 'Nombre de la empresa' },
    { var: '{{nombre}}', desc: 'Nombre del responsable' },
    { var: '{{tarea}}', desc: 'Título de la tarea' },
    { var: '{{descripcion}}', desc: 'Descripción (si hay)' },
    { var: '{{meta}}', desc: 'Prioridad y fecha de vencimiento' },
    { var: '{{enlace}}', desc: 'Enlace a las tareas' },
  ],
}

// ── DEFAULTS: salen de los componentes de /emails (React Email) ───────────────
//
// El diseño y los textos viven en /emails y se generan a HTML con {{variables}} (npm run emails:build →
// plantillas.generated.ts). Aquí solo se ELIGE la variante (con o sin lo opcional) y se rellenan las
// variables ESCAPADAS: es el único sitio que convierte los datos de un envío en HTML del correo.

/** Botón de las plantillas guardadas antiguas con directivas {{boton:…}} (ver expandSkeletonDirectives). */
const btn = (url: string, label: string, color = '#18181b') =>
  `<div style="text-align:center;margin:28px 0">
        <a href="${esc(url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:15px;font-weight:600">${esc(label)}</a>
      </div>`

function claveDeVariante(key: EmailTemplateKey, v: EmailVars): string {
  if ((key === 'contract_signed' || key === 'student_contract_signed') && !v.url) return `${key}:sin_enlace`
  if (key === 'task_assigned') {
    const sinDescripcion = !v.taskDescription
    const sinMeta = !v.priority && !v.dueDate
    if (sinDescripcion && sinMeta) return 'task_assigned:sin_descripcion_ni_meta'
    if (sinDescripcion) return 'task_assigned:sin_descripcion'
    if (sinMeta) return 'task_assigned:sin_meta'
  }
  return key
}

export function defaultBody(key: EmailTemplateKey, v: EmailVars): string {
  const vars = templateVars(key, v)
  // El onboarding de alumnos lleva al enlace de la landing si existe.
  if (key === 'student_onboarding' && v.landingUrl) vars.enlace = v.landingUrl
  const escapadas = Object.fromEntries(Object.entries(vars).map(([k, valor]) => [k, esc(valor)]))
  return renderTemplate(PLANTILLAS_HTML[claveDeVariante(key, v)] ?? PLANTILLAS_HTML[key], escapadas)
}

// ── ESQUELETOS EDITABLES ─────────────────────────────────────────────────────
// Punto de partida del editor: el MISMO HTML que se envía por defecto (variante completa), con sus
// {{variables}} sin sustituir. Antes eran una segunda copia escrita a mano que ya había divergido de lo
// que realmente se enviaba. NO se usan en envíos — solo para pre-rellenar el formulario cuando la
// subcuenta aún no ha guardado nada.
export const TEMPLATE_SKELETONS: Record<EmailTemplateKey, { subject: string; body: string }> = {
  invite: { subject: '{{empresa}} · Crea tu contraseña para acceder', body: PLANTILLAS_HTML.invite },
  recovery: { subject: '{{empresa}} · Restablecer contraseña', body: PLANTILLAS_HTML.recovery },
  contract: { subject: '{{empresa}} · Contrato para firmar', body: PLANTILLAS_HTML.contract },
  contract_signed: { subject: '{{empresa}} · Copia de tu contrato firmado', body: PLANTILLAS_HTML.contract_signed },
  student_contract: {
    subject: '{{empresa}} · ¡Bienvenida! Acepta tus condiciones',
    body: PLANTILLAS_HTML.student_contract,
  },
  student_onboarding: {
    subject: '{{empresa}} · Tus accesos están listos — empieza aquí',
    body: PLANTILLAS_HTML.student_onboarding,
  },
  student_contract_signed: {
    subject: '{{empresa}} · Copia de tu contrato firmado',
    body: PLANTILLAS_HTML.student_contract_signed,
  },
  task_assigned: { subject: '{{empresa}} · Nueva tarea: {{tarea}}', body: PLANTILLAS_HTML.task_assigned },
}

// Directivas {{boton:…}}, {{boton_pdf}} y {{enlace_fallback}} de los esqueletos:
// el editor las expande al HTML del botón/enlace antes de guardar, para que la
// plantilla guardada sea HTML puro con {{variables}} simples (lo que renderTemplate
// ya entiende). Así el usuario nunca escribe href a mano.
export function expandSkeletonDirectives(body: string): string {
  return body
    .replace(/\{\{boton:([^:}]+):([^}]+)\}\}/g, (_, color: string, label: string) => btn('{{enlace}}', label, color))
    .replace(/\{\{boton_pdf\}\}/g, btn('{{enlace_pdf}}', 'Descargar contrato firmado'))
    .replace(
      /\{\{enlace_fallback\}\}/g,
      `<p style="font-size:12px;color:#71717a;line-height:1.6">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><span style="color:#7c3aed;word-break:break-all">{{enlace}}</span></p>`
    )
}

// Variables de MUESTRA para la vista previa del editor (nunca se envían).
export function sampleVars(empresa: string): Record<string, string> {
  return {
    empresa,
    nombre: 'Ana García',
    enlace: 'https://ejemplo.com/enlace',
    enlace_pdf: 'https://ejemplo.com/contrato.pdf',
    bienvenida: 'Bienvenida al programa',
    firma: 'Un saludo,\nEl equipo de ' + empresa,
    tarea: 'Llamada de seguimiento',
    descripcion: 'Contactar con el lead antes de las 18:00.',
    meta: 'Prioridad: Alta · Vence: 30/09',
  }
}

// ── VARIABLES → sustitución ──────────────────────────────────────────────────

// Mapa de variables disponibles para el renderizador. {{firma}} lleva el escape
// YA aplicado cuando viene del default (white-space:pre-line la respeta); desde
// una plantilla guardada llega texto plano y se escapa aquí.
export function templateVars(key: EmailTemplateKey, v: EmailVars): Record<string, string> {
  void key
  return {
    empresa: v.company.name,
    nombre: v.memberName ?? '',
    enlace: v.url ?? '',
    enlace_pdf: v.url ?? '',
    bienvenida: v.welcome ?? '',
    firma: v.company.email_signature || `Un saludo,\n${v.company.name}`,
    tarea: v.taskTitle ?? '',
    descripcion: v.taskDescription ?? '',
    meta: [v.priority ? `Prioridad: ${v.priority}` : '', v.dueDate ? `Vence: ${v.dueDate}` : '']
      .filter(Boolean)
      .join(' · '),
  }
}

// Sustituye {{var}} (con espacios tolerados: {{ var }}). Las variables sin valor
// se dejan VACÍAS (nunca se muestra el literal {{…}} a un destinatario).
export function renderTemplate(source: string, vars: Record<string, string>): string {
  return source.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => vars[name] ?? '')
}

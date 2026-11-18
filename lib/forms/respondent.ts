// Quién ha respondido: la identidad que se muestra en Respuestas para poder analizar y escribir a la
// persona. Dos fuentes, y la UI las distingue porque NO valen lo mismo:
//  · `linked`  — la respuesta quedó emparejada con una ficha de contacto (contact_id): identidad verificada.
//  · declarada — nombre/email que la persona escribió en el propio formulario (el envío es anónimo, así
//    que es lo que dijo ser, no una prueba).

export interface RespondentQuestion {
  id: string
  type: string
  title?: string
  semantic?: string | null
}

export interface RespondentContact {
  id: string
  full_name: string | null
  email: string | null
}

export interface Respondent {
  name: string | null
  email: string | null
  phone: string | null
  contactId: string | null
  /** true si name/email salen de la ficha de contacto; false si son lo declarado en el formulario. */
  linked: boolean
}

const clean = (v: unknown): string | null => {
  if (v === undefined || v === null || Array.isArray(v) || typeof v === 'object') return null
  const s = String(v).trim()
  return s ? s.slice(0, 200) : null
}

/** Primera respuesta con valor entre las preguntas que cumplen `match` (rol semántico o, a falta de él, el tipo). */
function pick(
  questions: RespondentQuestion[],
  answers: Record<string, unknown>,
  role: string,
  type: string | null
): string | null {
  const by = (q: RespondentQuestion) => q.semantic === role
  for (const q of questions.filter(by)) {
    const v = clean(answers[q.id])
    if (v) return v
  }
  // Formularios creados sin rol semántico: una pregunta de tipo email/teléfono sigue siendo identidad.
  if (type) {
    for (const q of questions.filter((x) => !x.semantic && x.type === type)) {
      const v = clean(answers[q.id])
      if (v) return v
    }
  }
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_TITLE = /e-?mail|correo/i
const NAME_TITLE = /nombre|name|c[oó]mo te llamas/i

/** Último recurso: pregunta cuyo TÍTULO dice email/nombre, o cuya respuesta tiene forma de email. */
function guess(
  questions: RespondentQuestion[],
  answers: Record<string, unknown>,
  kind: 'email' | 'name'
): string | null {
  for (const q of questions) {
    if (q.semantic && q.semantic.startsWith('contact.')) continue
    const v = clean(answers[q.id])
    if (!v) continue
    if (kind === 'email' && (EMAIL_RE.test(v) || (EMAIL_TITLE.test(q.title ?? '') && v.includes('@')))) return v
    if (kind === 'name' && NAME_TITLE.test(q.title ?? '') && !v.includes('@')) return v
  }
  return null
}

export function respondentOf(
  row: { answers: unknown; hidden?: unknown; contact_id: string | null },
  questions: RespondentQuestion[],
  contacts: Map<string, RespondentContact>
): Respondent {
  const answers = (row.answers && typeof row.answers === 'object' ? row.answers : {}) as Record<string, unknown>
  const hidden = (row.hidden && typeof row.hidden === 'object' ? row.hidden : {}) as Record<string, unknown>
  const declaredEmail =
    (
      pick(questions, answers, 'contact.email', 'email') ??
      clean(hidden.email) ??
      guess(questions, answers, 'email')
    )?.toLowerCase() ?? null
  const declaredName =
    pick(questions, answers, 'contact.name', null) ??
    clean(hidden.name) ??
    clean(hidden.nombre) ??
    guess(questions, answers, 'name')
  const phone = pick(questions, answers, 'contact.phone', 'phone')
  const c = row.contact_id ? contacts.get(row.contact_id) : undefined
  if (c) {
    return {
      name: clean(c.full_name) ?? declaredName,
      email: clean(c.email)?.toLowerCase() ?? declaredEmail,
      phone,
      contactId: c.id,
      linked: true,
    }
  }
  return { name: declaredName, email: declaredEmail, phone, contactId: null, linked: false }
}

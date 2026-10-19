// IDENTIDAD DE UN PAGO: de quién es un cobro de Stripe cuando NO paga con el correo que dio en la reunión.
//
// El cruce automático es por email exacto (o por el cliente de Stripe ya enlazado). Mucha gente paga con
// otro correo —el del trabajo, el de su pareja, el de la tarjeta— y el cobro se queda sin contacto. Este
// módulo hace dos cosas, ambas PURAS (sin base de datos):
//   1. SUGERIR quién puede ser, con razones legibles. Nunca decide: solo ordena candidatos para que una
//      persona confirme. Un cobro atribuido al contacto equivocado cambia comisiones (docs/MONEY.md).
//   2. RECORDAR el correo alternativo en el contacto (`custom_fields.emails_alternativos`), para que el
//      siguiente pago desde ese correo encaje solo.

export type ContactoIdentidad = {
  id: string
  email: string | null
  full_name: string | null
  custom_fields?: unknown
}
export type AgendaIdentidad = { contact_id: string | null; appointment_datetime: string | null; status: string | null }
export type PagoIdentidad = { email: string | null; nombre: string | null; pagadoEn: string | null }

export type SugerenciaContacto = { contactId: string; nombre: string | null; puntos: number; razones: string[] }

const CLAVE_ALIAS = 'emails_alternativos'

export const normalizarEmail = (e: string | null | undefined): string => (e ?? '').trim().toLowerCase()

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Correos alternativos recordados en el contacto, normalizados y sin repetir. */
export function aliasDeContacto(c: Pick<ContactoIdentidad, 'custom_fields'>): string[] {
  const cf = c.custom_fields
  const lista = esObjeto(cf) && Array.isArray(cf[CLAVE_ALIAS]) ? (cf[CLAVE_ALIAS] as unknown[]) : []
  return [...new Set(lista.map((x) => normalizarEmail(typeof x === 'string' ? x : '')).filter(Boolean))]
}

/** Todos los correos con los que se reconoce a un contacto: el principal y sus alias. */
export function emailsDeContacto(c: Pick<ContactoIdentidad, 'email' | 'custom_fields'>): string[] {
  const principal = normalizarEmail(c.email)
  return [...new Set([principal, ...aliasDeContacto(c)].filter(Boolean))]
}

/**
 * `custom_fields` del contacto con el correo añadido a los alternativos. Devuelve `null` si no hay nada
 * que cambiar (vacío, ya es el principal o ya estaba): quien llama evita una escritura inútil.
 */
export function conAlias(
  c: Pick<ContactoIdentidad, 'email' | 'custom_fields'>,
  email: string | null
): Record<string, unknown> | null {
  const nuevo = normalizarEmail(email)
  if (!nuevo || !/.+@.+\..+/.test(nuevo)) return null
  if (emailsDeContacto(c).includes(nuevo)) return null
  const base = esObjeto(c.custom_fields) ? c.custom_fields : {}
  return { ...base, [CLAVE_ALIAS]: [...aliasDeContacto(c), nuevo] }
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const PALABRAS_SUELTAS = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'y',
  'e',
  'da',
  'do',
  'van',
  'von',
  'mr',
  'mrs',
  'sra',
  'sr',
])

function tokensDeNombre(nombre: string | null | undefined): string[] {
  return sinAcentos((nombre ?? '').toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !PALABRAS_SUELTAS.has(t))
}

/** Parte local del correo sin puntos ni «+etiqueta»: laura.gomez+pagos@ → lauragomez. */
function usuarioDeCorreo(email: string): string {
  const [local = ''] = email.split('@')
  return local.split('+')[0].replace(/\./g, '')
}

function distancia(a: string, b: string): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 3) return 99
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const actual = [i]
    for (let j = 1; j <= b.length; j++) {
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previa = actual
  }
  return previa[b.length]
}

const DIA_MS = 86_400_000
/** Una llamada anterior al pago, hasta este número de días, es indicio (no prueba) de que es la misma persona. */
const VENTANA_AGENDA_DIAS = 30
/** Por debajo de esta puntuación no se enseña nada: una sugerencia floja invita a vincular a ciegas. */
export const PUNTOS_MINIMOS = 45

export function sugerirContactos(
  pago: PagoIdentidad,
  contactos: readonly ContactoIdentidad[],
  agendas: readonly AgendaIdentidad[],
  maximo = 5
): SugerenciaContacto[] {
  const emailPago = normalizarEmail(pago.email)
  const usuarioPago = emailPago ? usuarioDeCorreo(emailPago) : ''
  const tokensPago = tokensDeNombre(pago.nombre)
  const tPago = pago.pagadoEn ? Date.parse(pago.pagadoEn) : NaN

  const agendasPorContacto = new Map<string, AgendaIdentidad[]>()
  for (const a of agendas) {
    if (!a.contact_id) continue
    agendasPorContacto.set(a.contact_id, [...(agendasPorContacto.get(a.contact_id) ?? []), a])
  }

  const salida: SugerenciaContacto[] = []
  for (const c of contactos) {
    const razones: string[] = []
    let puntosCorreo = 0
    let puntosNombre = 0
    let puntosAgenda = 0

    for (const correo of emailsDeContacto(c)) {
      if (!emailPago) break
      const d = distancia(emailPago, correo)
      if (d > 0 && d <= 2 && puntosCorreo < 75) {
        puntosCorreo = 75
        razones.splice(0, razones.length, `Correo casi idéntico (${correo}): posible errata`)
      } else if (usuarioPago.length >= 4 && usuarioDeCorreo(correo) === usuarioPago && puntosCorreo < 60) {
        puntosCorreo = 60
        razones.push('Mismo usuario de correo en otro dominio')
      }
    }

    const tokensContacto = tokensDeNombre(c.full_name)
    if (tokensPago.length && tokensContacto.length) {
      const comunes = tokensPago.filter((t) => tokensContacto.includes(t))
      if (comunes.length >= 2) {
        puntosNombre = 60
        razones.push('Mismo nombre y apellido')
      } else if (comunes.length === 1 && tokensPago[0] === tokensContacto[0]) {
        puntosNombre = 25
        razones.push('Mismo nombre de pila')
      }
    }

    if (Number.isFinite(tPago)) {
      const recientes = (agendasPorContacto.get(c.id) ?? []).filter((a) => {
        const t = a.appointment_datetime ? Date.parse(a.appointment_datetime) : NaN
        const dias = (tPago - t) / DIA_MS
        return Number.isFinite(t) && dias >= -1 && dias <= VENTANA_AGENDA_DIAS && !/cancel/i.test(a.status ?? '')
      })
      if (recientes.length) {
        puntosAgenda = 20
        const masReciente = Math.min(
          ...recientes.map((a) =>
            Math.max(0, Math.round((tPago - Date.parse(a.appointment_datetime as string)) / DIA_MS))
          )
        )
        razones.push(
          masReciente === 0 ? 'Tuvo una llamada el mismo día del pago' : `Tuvo una llamada hace ${masReciente} días`
        )
      }
    }

    // La agenda reciente sola no basta (media agenda tendrá llamadas recientes): solo suma con otra señal.
    const puntos = Math.min(100, puntosCorreo + puntosNombre + (puntosCorreo + puntosNombre > 0 ? puntosAgenda : 0))
    if (puntos >= PUNTOS_MINIMOS) salida.push({ contactId: c.id, nombre: c.full_name, puntos, razones })
  }
  return salida.sort((a, b) => b.puntos - a.puntos).slice(0, maximo)
}

import { ghlHeaders } from './conversaciones'

// Cambia el responsable (`assignedUserId`) de una cita que vive en GHL. El token necesita el permiso
// de escritura de calendarios (calendars/events.write); si no lo tiene, el error lo dice.

const BASE = 'https://services.leadconnectorhq.com'

export class GhlReasignarError extends Error {}

type Json = Record<string, unknown>

export async function reasignarCitaGhl(p: {
  token: string
  locationId: string
  eventId: string
  /** Emails del closer en la app (login y Calendly): GHL lo identifica por email. */
  emails: (string | null | undefined)[]
  fetchImpl?: typeof fetch
}): Promise<void> {
  const f = p.fetchImpl ?? fetch
  const buscados = p.emails.map((e) => (e ?? '').trim().toLowerCase()).filter(Boolean)
  if (!buscados.length) throw new GhlReasignarError('El closer no tiene email para localizarlo en GHL')

  const lista = await f(`${BASE}/users/?locationId=${encodeURIComponent(p.locationId)}`, {
    headers: ghlHeaders(p.token),
    signal: AbortSignal.timeout(15_000),
  })
  const cuerpo = (await lista.json().catch(() => ({}))) as Json
  if (!lista.ok) throw new GhlReasignarError(mensajeDeHttp(lista.status, 'leer los usuarios de GHL'))
  const usuarios = (Array.isArray(cuerpo.users) ? cuerpo.users : []) as Json[]
  const usuario = usuarios.find((u) =>
    buscados.includes(
      String(u.email ?? '')
        .trim()
        .toLowerCase()
    )
  )
  if (!usuario?.id) throw new GhlReasignarError('Ese closer no tiene usuario en GHL con el mismo email')

  const res = await f(`${BASE}/calendars/events/appointments/${encodeURIComponent(p.eventId)}`, {
    method: 'PUT',
    headers: ghlHeaders(p.token),
    body: JSON.stringify({ assignedUserId: String(usuario.id) }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new GhlReasignarError(mensajeDeHttp(res.status, 'cambiar el responsable de la cita en GHL'))
}

function mensajeDeHttp(status: number, accion: string): string {
  if (status === 401 || status === 403)
    return `El token de GHL no tiene permiso para ${accion}. Añade el permiso de calendarios (escritura) al token.`
  if (status === 404) return `GHL no encuentra la cita o el usuario al ${accion}.`
  return `GHL respondió ${status} al ${accion}.`
}

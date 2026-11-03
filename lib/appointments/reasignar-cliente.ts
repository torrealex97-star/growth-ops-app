// Reasignar el closer desde el navegador. El servidor decide dónde se refleja (GHL, Calendly o solo la app);
// aquí solo se gestiona el caso de Calendly, que necesita confirmación porque Calendly avisa al contacto.

export type ResultadoReasignar = { cancelado?: boolean; aviso?: string | null; sincronizado?: string | null }

export async function reasignarCloserApi(
  tenant: string,
  appointmentId: string,
  closerId: string | null,
  confirmar: (mensaje: string) => boolean = (m) => window.confirm(m)
): Promise<ResultadoReasignar> {
  const post = async (ruta: string, cuerpo: Record<string, unknown>) => {
    const res = await fetch(`/api/${tenant}/evergreen/appointments/${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    })
    return { res, json: (await res.json().catch(() => ({}))) as Record<string, unknown> }
  }

  const a = await post('reassign-closer', { appointmentId, closerId })
  if (a.res.status === 409 && a.json.code === 'CALENDLY_REQUIERE_REAGENDAR') {
    if (!confirmar(`${a.json.error}\n\nEl contacto recibirá un aviso de Calendly con la cita nueva. ¿Continuar?`))
      return { cancelado: true }
    const b = await post('reschedule', { appointmentId, startTime: a.json.startTime, closerId })
    if (!b.res.ok || b.json.error) throw new Error(String(b.json.error || 'No se pudo reasignar en Calendly'))
    return {
      sincronizado: 'calendly',
      aviso:
        b.json.calendlyCanceled === false ? 'La cita anterior sigue en Calendly: se reintentará cancelarla.' : null,
    }
  }
  if (!a.res.ok || a.json.error) throw new Error(String(a.json.error || 'No se pudo reasignar el closer'))
  return {
    sincronizado: (a.json.sincronizado as string | null) ?? null,
    aviso: (a.json.aviso as string | null) ?? null,
  }
}

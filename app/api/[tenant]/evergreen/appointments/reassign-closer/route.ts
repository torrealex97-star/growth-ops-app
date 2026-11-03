import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { closerDeLaSubcuenta, proveedorDeReasignacion } from '@/lib/appointments/closer'
import { GhlReasignarError, reasignarCitaGhl } from '@/lib/ghl/reasignar'

export const runtime = 'nodejs'
export const maxDuration = 30

const LEADERSHIP = ['admin', 'director', 'manager']

// Reasigna el closer de una agenda y lo refleja donde se agendó. Solo liderazgo (afecta a la
// atribución de comisiones). Va por service role porque appointments solo permite UPDATE a
// admin/director por RLS.
//   · GHL      → cambia el responsable de la cita en GHL ANTES de tocar la app (si GHL falla, nada cambia).
//   · Calendly → no se puede cambiar el anfitrión de un evento: responde 409 CALENDLY_REQUIERE_REAGENDAR
//                para que la pantalla confirme y use /reschedule con `closerId` (crea en el nuevo y cancela el viejo).
//   · Manual o ya pasada → solo la app.
// `soloApp: true` salta el proveedor (la persona lo pide expresamente, p. ej. si GHL no responde).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { appointmentId, closerId, soloApp } = (await req.json()) as {
      appointmentId?: string
      closerId?: string | null
      soloApp?: boolean
    }
    if (!appointmentId) return NextResponse.json({ error: 'Falta la agenda' }, { status: 400 })
    if (!LEADERSHIP.includes(t.role || '')) {
      return NextResponse.json({ error: 'Solo liderazgo puede reasignar el closer' }, { status: 403 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: appt } = await sb
      .from('appointments')
      .select('id, closer_id, external_source, external_id, calendly_event_uuid, appointment_datetime')
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })

    const closer = closerId ? await closerDeLaSubcuenta(sb, t.tenantId, closerId, t.isSuperAdmin) : null
    if (closerId && !closer) {
      return NextResponse.json(
        { error: 'El usuario elegido no es un closer válido de esta subcuenta' },
        { status: 400 }
      )
    }

    let sincronizado: 'ghl' | null = null
    let aviso: string | null = null
    if (closer && (appt.closer_id ?? null) !== closer.id) {
      const proveedor = soloApp ? 'solo_app' : proveedorDeReasignacion(appt)
      if (proveedor === 'ghl') {
        const cfg = await getTenantConfigWithFallback(t.tenantId)
        if (!cfg.GHL_API_TOKEN || !cfg.GHL_LOCATION_ID) {
          return NextResponse.json(
            { error: 'La cita es de GHL pero la integración no está configurada: no se puede cambiar allí.' },
            { status: 409 }
          )
        }
        try {
          await reasignarCitaGhl({
            token: cfg.GHL_API_TOKEN,
            locationId: cfg.GHL_LOCATION_ID,
            eventId: appt.external_id as string,
            emails: [closer.email, closer.calendly_email],
          })
          sincronizado = 'ghl'
        } catch (e) {
          if (!(e instanceof GhlReasignarError)) throw e
          return NextResponse.json({ error: e.message, code: 'GHL_FALLO' }, { status: 502 })
        }
      } else if (proveedor === 'calendly') {
        return NextResponse.json(
          {
            code: 'CALENDLY_REQUIERE_REAGENDAR',
            startTime: appt.appointment_datetime,
            error:
              'Calendly no permite cambiar el anfitrión: se creará la cita en el calendario del nuevo closer y se cancelará la del anterior.',
          },
          { status: 409 }
        )
      } else if (appt.external_source === 'calendly' && !soloApp) {
        aviso = 'La cita ya pasó: Calendly no permite moverla, así que solo se cambió en la app.'
      }
    }

    const { data, error } = await sb
      .from('appointments')
      .update({ closer_id: closerId || null })
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
      .select('id, closer_id, closer:closer_id(id, full_name)')
      .single()
    if (error) {
      // GHL ya cambió pero la app no: se dice, porque quedan distintos.
      return NextResponse.json(
        { error: sincronizado ? `Se cambió en GHL pero no en la app: ${error.message}` : error.message },
        { status: 500 }
      )
    }

    const { error: auditErr } = await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'appointment',
      entity_id: appointmentId,
      action: 'reassign_closer',
      old_values: { closer_id: appt.closer_id },
      new_values: { closer_id: closerId || null, proveedor: sincronizado ?? 'solo_app' },
    })
    if (auditErr) console.error('[reassign-closer] no se pudo registrar audit_logs:', auditErr.message)

    return NextResponse.json({ ok: true, appointment: data, sincronizado, aviso })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

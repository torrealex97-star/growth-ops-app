import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { puedeAccederAFila } from '@/lib/auth/acceso-por-propiedad'

export const runtime = 'nodejs'

// Encola una grabación de Drive para transcripción en segundo plano (worker de Railway).
// Guarda el enlace y pone transcript_status='pendiente'. El worker la procesa (cualquier duración).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { appointmentId, driveUrl, recordingUrl } = await req.json()
    if (!appointmentId || !driveUrl)
      return NextResponse.json({ error: 'Falta appointmentId o driveUrl' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    // Misma regla que appointments/update: el service-role salta el RLS, así que se comprueba aquí que la agenda es tuya
    // (o que tienes liderazgo / visibilidad de equipo) antes de cambiar su grabación o su transcripción.
    const { data: appt } = await sb
      .from('appointments')
      .select('setter_id, closer_id')
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (!appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })
    const { data: urow } = await sb.from('users').select('data_scope').eq('id', t.userId).maybeSingle()
    const dataScope = (urow as { data_scope?: string | null } | null)?.data_scope ?? null
    if (!puedeAccederAFila({ userId: t.userId, role: t.role, isSuperAdmin: t.isSuperAdmin, dataScope }, appt)) {
      return NextResponse.json({ error: 'Solo puedes gestionar tus propias agendas' }, { status: 403 })
    }
    const { error } = await sb
      .from('appointments')
      .update({
        transcript_drive_url: driveUrl,
        transcript_status: 'pendiente',
        ...(typeof recordingUrl === 'string' && recordingUrl.trim() ? { recording_url: recordingUrl.trim() } : {}),
      })
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, queued: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { ESTADOS_COLABORADOR_ASIGNABLES } from '@/lib/collaborators/estados-asignables'
import { recalcularVentasTrasAsignar, type ResultadoRecalculo } from '@/lib/commissions/reasignar-colaborador'

// OVERRIDE ADMINISTRATIVO DE ATRIBUCIÓN DE COLABORADOR (§12-§13 del brief).
//
// La regla por defecto es FIRST VALID COLLABORATOR ATTRIBUTION WINS (registrarToque
// nunca roba un colaborador ya asignado). La ÚNICA vía para cambiarlo es esta ruta:
// un admin/director, con MOTIVO OBLIGATORIO, actor y timestamp registrados en
// audit_logs (old → new). Nada en la app modifica atribución financiera en silencio.
//
// Al ASIGNAR un colaborador se recalculan las comisiones DE ESE COLABORADOR en las ventas YA HECHAS del contacto
// (lib/commissions/reasignar-colaborador.ts: idempotente, nunca toca lo liquidado ni las de setter/closer) y se
// devuelven `warnings` si algo impedirá que cobre: sin % de comisión en ningún sitio o ficha no activa. Antes se
// cambiaba la atribución y «por pagar» se quedaba a cero sin explicación.
//
// Cuerpo: { contactId, collaboratorId | null, reason }
//   collaboratorId = null → "Directo / Sin colaborador" (estado válido, §14; NULL
//   estructural, nunca un colaborador fake).

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  // Solo administración. El colaborador jamás toca su atribución (§63).
  if (!['admin', 'director'].includes(t.role ?? '')) {
    return NextResponse.json({ error: 'Solo administración puede cambiar la atribución' }, { status: 403 })
  }

  try {
    const body = (await req.json()) as { contactId?: string; collaboratorId?: string | null; reason?: string }
    const contactId = body.contactId
    const collaboratorId = body.collaboratorId ?? null
    const reason = (body.reason ?? '').trim()

    if (!contactId) return NextResponse.json({ error: 'Falta contactId' }, { status: 400 })
    if (!reason) return NextResponse.json({ error: 'El motivo es obligatorio' }, { status: 400 })

    const sb = (await import('@supabase/supabase-js')).createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // El contacto tiene que existir EN ESTA subcuenta (no se aceptan ids cross-tenant).
    const { data: contacto } = await sb
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (!contacto) return NextResponse.json({ error: 'Contacto no encontrado' }, { status: 404 })

    // Si se asigna colaborador, tiene que ser un perfil asignable (no suspendido/inactivo) de esta subcuenta.
    let estadoPerfil: string | null = null
    let colaboradorUserId: string | null = null
    if (collaboratorId) {
      const { data: perfil } = await sb
        .from('collaborator_profiles')
        .select('id, status, user_id')
        .eq('id', collaboratorId)
        .eq('tenant_id', t.tenantId)
        .maybeSingle()
      const p = perfil as { id: string; status: string; user_id: string | null } | null
      estadoPerfil = p?.status ?? null
      colaboradorUserId = p?.user_id ?? null
      if (!p) return NextResponse.json({ error: 'Colaborador no encontrado en esta subcuenta' }, { status: 404 })
      if (!(ESTADOS_COLABORADOR_ASIGNABLES as readonly string[]).includes(p.status)) {
        return NextResponse.json({ error: 'El colaborador está suspendido o inactivo' }, { status: 400 })
      }
    }

    // Valor ANTERIOR (para el histórico). La fila is_primary es la canónica.
    const { data: attr } = await sb
      .from('contact_attributions')
      .select('id, collaborator_id, collaborator_attribution_blocked')
      .eq('contact_id', contactId)
      .eq('tenant_id', t.tenantId)
      .eq('is_primary', true)
      .maybeSingle()
    const estadoAnterior = attr as {
      id: string
      collaborator_id: string | null
      collaborator_attribution_blocked: boolean
    } | null
    const anterior = estadoAnterior?.collaborator_id ?? null
    const bloqueoAnterior = estadoAnterior?.collaborator_attribution_blocked ?? false
    const bloquearReatribucion = collaboratorId === null

    const ahora = new Date().toISOString()
    if (attr) {
      const { error } = await sb
        .from('contact_attributions')
        .update({
          collaborator_id: collaboratorId,
          collaborator_attribution_blocked: bloquearReatribucion,
          updated_at: ahora,
        })
        .eq('id', (attr as { id: string }).id)
        .eq('tenant_id', t.tenantId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      // Contacto sin fila de atribución (creado a mano): se crea la canónica.
      const { error } = await sb.from('contact_attributions').insert({
        tenant_id: t.tenantId,
        contact_id: contactId,
        is_primary: true,
        collaborator_id: collaboratorId,
        collaborator_attribution_blocked: bloquearReatribucion,
        source: 'admin_override',
        first_touch_at: ahora,
        last_touch_at: ahora,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // AUDITORÍA (§64): quién, qué, cuándo, anterior, nuevo y por qué. Este endpoint existe
    // PRECISAMENTE para que ningún cambio de atribución financiera quede sin rastro — si el
    // audit falla, el cambio ya aplicado es justo lo que la ruta promete que nunca pasa.
    const { error: auditErr } = await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'contact_attribution',
      entity_id: contactId,
      action: 'collaborator_attribution_override',
      old_values: {
        collaborator_id: anterior,
        collaborator_attribution_blocked: bloqueoAnterior,
      },
      new_values: {
        collaborator_id: collaboratorId,
        collaborator_attribution_blocked: bloquearReatribucion,
        reason,
      },
    })
    if (auditErr) {
      return NextResponse.json(
        {
          error:
            'El cambio de atribución se aplicó pero no se pudo auditar: ' +
            auditErr.message +
            '. Revisar a mano — este endpoint no permite cambios sin rastro.',
        },
        { status: 500 }
      )
    }

    // RECÁLCULO de lo ya vendido (solo las comisiones de ESTE colaborador). Un fallo aquí NO deshace la atribución
    // (ya aplicada y auditada): se declara en `warnings`. Lo que escribe (afiliado/% de la venta, comisiones) queda
    // en audit_logs: este endpoint no permite cambios financieros sin rastro.
    let recalculo: ResultadoRecalculo = { ventasRevisadas: 0, comisionesNuevas: 0, warnings: [], detalle: [] }
    if (collaboratorId) {
      recalculo = await recalcularVentasTrasAsignar({
        sb,
        tenantId: t.tenantId,
        contactId,
        colaboradorUserId,
        estadoPerfil,
      })
      if (recalculo.detalle.length > 0) {
        const { error: recalcAuditErr } = await sb.from('audit_logs').insert({
          tenant_id: t.tenantId,
          actor_user_id: t.userId,
          entity_type: 'contact_attribution',
          entity_id: contactId,
          action: 'collaborator_attribution_recalc',
          old_values: {},
          new_values: { collaborator_id: collaboratorId, reason, ventas: recalculo.detalle },
        })
        if (recalcAuditErr) {
          recalculo.warnings.push(
            `Las comisiones se recalcularon pero no se pudo auditar el recálculo (${recalcAuditErr.message}). Revisar a mano.`
          )
        }
      }
    }

    return NextResponse.json({
      ok: true,
      from: anterior,
      to: collaboratorId,
      ventasRevisadas: recalculo.ventasRevisadas,
      comisionesNuevas: recalculo.comisionesNuevas,
      warnings: recalculo.warnings,
    })
  } catch (err) {
    console.error('[api/colaboradores/attribution]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}

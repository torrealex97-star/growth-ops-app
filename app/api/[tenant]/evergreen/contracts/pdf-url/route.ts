import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { ROLES_VER_CONTRATOS } from '@/lib/auth/acceso-por-propiedad'

export const runtime = 'nodejs'

const BUCKET = 'contratos'
const SIGNED_URL_TTL_SECONDS = 60 * 60 // 1h — se pide fresca en cada visualización, no se guarda.

// Devuelve una signed URL corta para ver el PDF de un contrato FIRMADO POR NUESTRO PROPIO FLUJO
// (sign/[token] o sign-student/[token]), generada en el momento. El path es siempre determinista:
// `${contractId}.pdf` (ver uploadSignedPdf en esas rutas) — no depende de la columna `url`, que
// para contratos kind='venta' guarda en cambio un enlace externo que un admin escribe a mano y
// no vive en este bucket, así que para esos devolvemos `contracts.url` tal cual (no es nuestro).
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const contractId = req.nextUrl.searchParams.get('contractId')
    if (!contractId) return NextResponse.json({ error: 'Falta contractId' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: contract, error } = await sb
      .from('contracts')
      .select('signed_pdf_url, url, user_id')
      .eq('id', contractId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (error || !contract) return NextResponse.json({ error: 'Contrato no encontrado' }, { status: 404 })
    // Misma regla que `contracts_select` del RLS (el service-role la salta): liderazgo/csm/gestoría, o el contrato es tuyo.
    const veLiderazgo = t.isSuperAdmin || (ROLES_VER_CONTRATOS as readonly string[]).includes(t.role ?? '')
    if (!veLiderazgo && contract.user_id !== t.userId) {
      // 404 y no 403: no se confirma que el contrato existe a quien no puede verlo.
      return NextResponse.json({ error: 'Contrato no encontrado' }, { status: 404 })
    }

    if (contract.signed_pdf_url) {
      const path = `${contractId}.pdf`
      const signed = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
      if (signed.error || !signed.data?.signedUrl) {
        return NextResponse.json({ error: 'No se pudo generar el enlace' }, { status: 500 })
      }
      return NextResponse.json({ url: signed.data.signedUrl })
    }

    // kind='venta' sin firma propia: enlace externo introducido a mano por un admin.
    if (contract.url) return NextResponse.json({ url: contract.url })

    return NextResponse.json({ error: 'Este contrato no tiene PDF' }, { status: 404 })
  } catch (err) {
    console.error('[api/contracts/pdf-url GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

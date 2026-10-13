import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { inspectEncryptedSecret } from '@/lib/config'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/** Diagnóstico administrativo. Nunca devuelve valores, ciphertexts, llaves ni fingerprints. */
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!auth.administraTenant) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const { data, error } = await serviceClient()
    .from('integration_settings')
    .select('key,value,is_secret,key_fingerprint,updated_at')
    .eq('tenant_id', auth.tenantId)
    .eq('is_secret', true)
    .order('key')

  if (error)
    return NextResponse.json({ error: `No se pudo ejecutar el diagnóstico: ${error.message}` }, { status: 500 })

  const secrets = (data ?? []).map((row) => {
    const value = (row as { value: string | null }).value
    const storedFingerprint = (row as { key_fingerprint: string | null }).key_fingerprint
    const inspection = inspectEncryptedSecret(value, storedFingerprint)
    return {
      key: (row as { key: string }).key,
      encrypted: Boolean(value?.startsWith('enc:v1:')),
      decryptable: inspection.decryptable,
      fingerprintPresent: Boolean(storedFingerprint),
      fingerprintMatches: inspection.fingerprintMatches,
      reason:
        inspection.status === 'fingerprint_mismatch'
          ? 'key_mismatch'
          : inspection.status === 'decrypt_error'
            ? 'decrypt_error'
            : inspection.status === 'not_encrypted'
              ? 'plaintext_legacy'
              : storedFingerprint
                ? 'ok'
                : 'ok_legacy_without_fingerprint',
      updatedAt: (row as { updated_at: string }).updated_at,
    }
  })

  return NextResponse.json({ ok: true, secrets })
}

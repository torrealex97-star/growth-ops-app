import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  assertConfigEncryptionReady,
  decryptSecret,
  encryptSecret,
  getConfigEncryptionKeyFingerprint,
  inspectEncryptedSecret,
  invalidateConfigCache,
  getTenantConfigWithFallback,
} from '@/lib/config'
import { ALL_FIELDS, SECRET_KEYS, isKnownKey, INTEGRATION_ONLY_GROUPS } from '@/lib/integrations-catalog'
import { assessIntegration, SYNCS_BY_GROUP, type LastCheck } from '@/lib/integrations/health'
import { SYNC_DEFS } from '@/lib/ops/sync-health'
import { lastRunsByJob } from '@/lib/integrations/sync-runs'
import { PG_CRON_READY, VERCEL_CRON_ROUTES } from '@/lib/ops/vercel-crons'
import { fetchAdAccounts } from '@/lib/meta/client'
import { cuentaUnicaActiva, parseAccountIds } from '@/lib/meta/accounts'
import { requireTenant } from '@/lib/auth/requireTenant'
import { configBunny, faltaEnConfigBunny, probarBunny } from '@/lib/vsl/bunny'
import { isDeprecatedMetaVersion, META_API_VERSION } from '@/lib/meta/api-version'
import { classifyMetaError } from '@/lib/meta/errors'
import { comprobarSaludMeta } from '@/lib/meta/salud'
import { guardarComprobacion, HEALTH_KEY, parseLastChecks } from '@/lib/integrations/comprobaciones'
import { oauthCredentialValidationError } from '@/lib/integrations/oauth-credentials'
import { comprobarSaludInstagram } from '@/lib/instagram/salud'
import { stripeGet } from '@/lib/stripe/client'
import { listarModelos, ModelosError, resolverModelo } from '@/lib/ai/modelos'
import { DEEPSEEK_MODELOS_PREFERIDOS } from '@/lib/ai/provider'
import { getValidGoogleAccessToken } from '@/lib/google/token-store'
import {
  WEBHOOKS_ENTRANTES,
  evaluarSecret,
  ultimoEventoEnAudit,
  eventosPorFuente,
  type EstadoSecretInfo,
  type UltimoEvento,
  type WebhookEntranteEstado,
} from '@/lib/webhooks/entrantes'

export const runtime = 'nodejs'

async function requireAdmin(
  tenantSlug: string
): Promise<{ ok: true; callerId: string; tenantId: string } | { ok: false; res: NextResponse }> {
  const t = await requireTenant(tenantSlug)
  if ('error' in t) return { ok: false, res: t.error }
  const sb = svc()
  const role = t.role
  if (role !== 'admin' && role !== 'director') {
    return { ok: false, res: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return { ok: true, callerId: t.userId, tenantId: t.tenantId }
}

function svc(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Clave donde vive el último veredicto de cada integración. Va en integration_settings (no secreta)
// porque es configuración/estado por subcuenta, que es justo lo que guarda esa tabla: no hace falta
// tabla nueva ni migración para algo que se sobrescribe entero en cada comprobación.

/** Lee el estado guardado siendo tolerante: un JSON corrupto deja las luces en gris, no rompe nada. */

/**
 * Cuenta las filas de las tablas que alimentan las integraciones, para poder decir "conectada pero
 * todavía sin datos". `null` = no se pudo leer, que NO es 0 (ver lib/ops/sync-health).
 */
async function countSyncTables(client: SupabaseClient, tenantId: string): Promise<Record<string, number | null>> {
  const grupos = new Set(Object.values(SYNCS_BY_GROUP).flat())
  const tablas = [...new Set(SYNC_DEFS.filter((d) => grupos.has(d.id)).map((d) => d.table))]
  const out: Record<string, number | null> = {}
  await Promise.all(
    tablas.map(async (table) => {
      const { count, error } = await client
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
      out[table] = error ? null : (count ?? 0)
    })
  )
  return out
}

/** Longitud del secreto ya descifrado. Si no se puede descifrar, no se inventa un número. */
function decryptedLength(stored: string): number | undefined {
  try {
    return decryptSecret(stored).length
  } catch {
    return undefined
  }
}

function mask(v: string): string {
  if (!v) return ''
  if (v.length <= 6) return '••••'
  return `••••${v.slice(-4)}`
}

// GET — estado de cada clave: configurada (BBDD), en env (fallback) o vacía.
// Nunca devuelve secretos en claro (solo máscara). Los no-secretos sí (para editarlos).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireAdmin(tenant)
  if (!auth.ok) return auth.res

  let encReady = true
  let encError: string | null = null
  try {
    assertConfigEncryptionReady()
  } catch (error) {
    encReady = false
    encError = error instanceof Error ? error.message : 'CONFIG_ENC_KEY no es válida'
  }
  type DbSetting = { value: string | null; is_secret: boolean; key_fingerprint: string | null }
  let dbRows: Record<string, DbSetting> = {}
  const settingsQuery = await svc()
    .from('integration_settings')
    .select('key,value,is_secret,key_fingerprint')
    .eq('tenant_id', auth.tenantId)
  if (settingsQuery.error) {
    return NextResponse.json(
      { error: `No se pudo leer la configuración: ${settingsQuery.error.message}` },
      { status: 500 }
    )
  }
  for (const r of settingsQuery.data ?? []) {
    const row = r as { key: string } & DbSetting
    dbRows[row.key] = row
  }

  // `length` acompaña a los secretos: una longitud NO es una credencial, y es lo único que permite
  // ver de un vistazo que un token se pegó a medias — el fallo que Meta reporta como "Bad signature"
  // y que la máscara ••••1234 esconde por completo.
  const state: Record<
    string,
    {
      source: 'db' | 'env' | 'none'
      secret: boolean
      preview: string
      value?: string
      length?: number
      // Cifrado con una CONFIG_ENC_KEY distinta a la actual (o corrupto): el runtime NO puede leerlo
      // y todo consumidor ve "faltan credenciales". La UI lo señala en rojo con la acción concreta.
      indescifrable?: boolean
      cryptoIssue?: 'key_mismatch' | 'decrypt_error'
      fingerprint?: 'matches' | 'legacy' | 'mismatch'
    }
  > = {}
  for (const f of ALL_FIELDS) {
    const inDb = dbRows[f.key]?.value
    const inEnv = process.env[f.key]
    if (inDb) {
      const inspection = f.secret ? inspectEncryptedSecret(inDb, dbRows[f.key]?.key_fingerprint) : null
      const indescifrable = inspection?.decryptable === false
      const cryptoIssue =
        inspection?.status === 'fingerprint_mismatch'
          ? ('key_mismatch' as const)
          : inspection?.status === 'decrypt_error'
            ? ('decrypt_error' as const)
            : undefined
      const fingerprint = inspection
        ? inspection.fingerprintMatches === true
          ? ('matches' as const)
          : inspection.fingerprintMatches === false
            ? ('mismatch' as const)
            : ('legacy' as const)
        : undefined
      state[f.key] = f.secret
        ? indescifrable
          ? { source: 'db', secret: true, preview: '••••••', indescifrable: true, cryptoIssue, fingerprint }
          : { source: 'db', secret: true, preview: '••••••', length: decryptedLength(inDb), fingerprint }
        : { source: 'db', secret: false, preview: inDb, value: inDb }
    } else if (inEnv) {
      state[f.key] = f.secret
        ? { source: 'env', secret: true, preview: mask(inEnv), length: inEnv.length }
        : { source: 'env', secret: false, preview: inEnv, value: inEnv }
    } else {
      state[f.key] = { source: 'none', secret: f.secret, preview: '' }
    }
  }
  // Estado real de cada integración: credenciales + última comprobación contra su API + si sus
  // sincronizaciones pueden funcionar. Es lo que decide la luz verde/gris/roja, en vez de pintar
  // "conectado" por el simple hecho de que exista un token escrito.
  const lastChecks = parseLastChecks(dbRows[HEALTH_KEY]?.value)
  const [rowCounts, lastRuns, googleOauth] = await Promise.all([
    countSyncTables(svc(), auth.tenantId),
    // Última ejecución de cada sincronización: es lo que convierte "la tabla está vacía" en "la
    // última sincronización falló por esto". Sin esto el panel mandaba a "revisar el último error
    // del sync" sin que ese error se guardara en ninguna parte.
    lastRunsByJob(svc(), auth.tenantId),
    svc()
      .from('google_oauth_connections')
      .select('provider,status')
      .eq('tenant_id', auth.tenantId)
      .in('provider', ['ga4', 'youtube', 'youtube_publish']),
  ])
  const configuredKeys = new Set(
    Object.entries(state)
      .filter(([, v]) => v.source !== 'none' && v.indescifrable !== true)
      .map(([k]) => k)
  )
  if (
    (googleOauth.data ?? []).some(
      (connection) => connection.provider === 'youtube_publish' && connection.status === 'conectada'
    )
  ) {
    // Clave lógica para el motor de health: el secreto real nunca vuelve a integration_settings.
    configuredKeys.add('YOUTUBE_REFRESH_TOKEN')
  }
  const facts = {
    configuredKeys,
    rowCounts,
    vercelScheduled: VERCEL_CRON_ROUTES,
    pgCronReady: PG_CRON_READY,
    lastRuns,
  }

  // Claves de BD indescifrables con la CONFIG_ENC_KEY actual: suben en la respuesta para que el
  // panel avise (banner + badge por campo) en vez de que la integración aparezca "conectada" con un
  // token muerto — o al revés, "sin configurar" sin explicación.
  const clavesIndescifrables = Object.entries(state)
    .filter(([, v]) => v.indescifrable === true)
    .map(([k]) => k)
    .sort()
  const problemasCifrado = clavesIndescifrables.map((key) => ({
    key,
    reason: state[key]?.cryptoIssue ?? 'decrypt_error',
  }))
  const health = INTEGRATION_ONLY_GROUPS.map((g) =>
    assessIntegration(
      { id: g.id, required: g.required, requiredAny: g.requiredAny, testable: g.test === true },
      { facts, lastCheck: lastChecks[g.id] }
    )
  )
  // Google y YouTube ya no se configuran mediante claves del catálogo. Su fuente de verdad es la
  // conexión OAuth tenant-scoped; se reemplaza únicamente su cabecera, conservando el diagnóstico
  // de sincronizaciones que ya calculó assessIntegration.
  for (const [groupId, provider] of [
    ['google', 'ga4'],
    ['youtube', 'youtube'],
  ] as const) {
    const index = health.findIndex((item) => item.id === groupId)
    if (index < 0) continue
    const connection = (googleOauth.data ?? []).find((item) => item.provider === provider)
    health[index] = {
      ...health[index],
      status: connection?.status === 'conectada' ? 'conectada' : connection ? 'error' : 'sin_configurar',
      headline: connection?.status === 'conectada' ? 'Conectada' : connection ? 'Requiere atención' : 'Sin conectar',
      detail:
        connection?.status === 'conectada'
          ? 'Cuenta de Google autorizada mediante OAuth.'
          : connection
            ? 'La autorización ya no es válida. Vuelve a conectar la cuenta.'
            : 'Pulsa Conectar y autoriza la cuenta de Google.',
      fix: connection ? 'Vuelve a conectar la cuenta con Google.' : undefined,
      stale: false,
    }
  }

  // ── Webhooks ENTRANTES: la mitad receptora de las integraciones ──
  // Estado del secreto esperado + última recepción con evidencia real por webhook. La evidencia
  // NUNCA se deduce de las filas de negocio: el pull del cron escribe en las mismas tablas que
  // los webhooks, y presentar sus fechas como "último evento recibido" fue exactamente la
  // confusión que hizo indetectable que el webhook de GHL nunca entró en producción.
  const [actasAudit, rawEntregas] = await Promise.all([
    // Historial del tenant (audit_logs es global por tenant; las firmas de evaluación filtran).
    // Limita a 400: la evidencia del webhook vive en actas recientes, no en todo el histórico.
    svc()
      .from('audit_logs')
      .select('entity_type,action,created_at,new_values')
      .eq('tenant_id', auth.tenantId)
      .order('created_at', { ascending: false })
      .limit(400)
      .then(({ data }) => (data ?? []) as Parameters<typeof ultimoEventoEnAudit>[1]),
    // Entregas crudas de los webhooks que escriben la suya en raw_events (Stripe, Hotmart, Whop),
    // incluidos los rechazos de firma que registran. Una sola query para las tres fuentes.
    svc()
      .from('raw_events')
      .select('source,received_at,processing_status')
      .eq('tenant_id', auth.tenantId)
      .in('source', ['stripe', 'hotmart', 'whop', 'typeform', 'ghl-launch'])
      .order('received_at', { ascending: false })
      .limit(150)
      .then(({ data }) => (data ?? []) as Parameters<typeof eventosPorFuente>[0]),
  ])
  const entregasPorFuente = eventosPorFuente(rawEntregas)
  const webhooksEntrantes: WebhookEntranteEstado[] = WEBHOOKS_ENTRANTES.map((webhook) => {
    const secret: EstadoSecretInfo = evaluarSecret(state[webhook.auth.configKey])
    let ultimoEvento: UltimoEvento = null
    let ultimoRechazo: UltimoEvento = null
    if (
      webhook.evidencia === 'raw_stripe' ||
      webhook.evidencia === 'raw_hotmart' ||
      webhook.evidencia === 'raw_whop' ||
      webhook.evidencia === 'raw_typeform' ||
      webhook.evidencia === 'raw_lanzamiento'
    ) {
      // La fuente de raw_events del lanzamiento es `ghl-launch`, no el nombre de la evidencia.
      const fuente = webhook.evidencia === 'raw_lanzamiento' ? 'ghl-launch' : webhook.evidencia.replace('raw_', '')
      const r = entregasPorFuente[fuente] ?? {
        ultimo_valido: null,
        ultimo_rechazo: null,
      }
      ultimoEvento = r.ultimo_valido
      ultimoRechazo = r.ultimo_rechazo
    } else if (webhook.evidencia) {
      ultimoEvento = ultimoEventoEnAudit(webhook.evidencia, actasAudit)
    }
    return {
      id: webhook.id,
      groupId: webhook.groupId,
      titulo: webhook.titulo,
      descripcion: webhook.descripcion,
      path: webhook.path,
      metodo: webhook.metodo,
      auth: webhook.auth,
      eventos: webhook.eventos,
      aviso: webhook.aviso ?? null,
      doc: webhook.doc ?? null,
      guia: webhook.guia,
      secret,
      ultimoEvento,
      ultimoRechazo,
    }
  })
  // `groups` son los grupos pintables en Integraciones; `state` sigue cubriendo ALL_FIELDS, así
  // que Datos de empresa puede leer IG_BUSINESS_CONTEXT/IG_BRAND_ASSETS del mismo endpoint.
  return NextResponse.json({
    encReady,
    encError,
    groups: INTEGRATION_ONLY_GROUPS,
    state,
    health,
    runs: lastRuns,
    webhooksEntrantes,
    clavesIndescifrables,
    problemasCifrado,
  })
}

// POST — guardar cambios. body: { updates: { KEY: value } }.
// Secreto con valor vacío => NO se toca (para no borrar al no reescribir el campo enmascarado).
// Para BORRAR una clave: enviar { clear: ["KEY", …] }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireAdmin(tenant)
  if (!auth.ok) return auth.res

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    group?: string
    // Token recién pegado y TODAVÍA NO guardado: sirve para poder listar las cuentas antes de
    // guardar nada, que es el orden natural (pegas el token, eliges cuenta, guardas). No se
    // persiste aquí ni se escribe en ningún log.
    token?: string
    updates?: Record<string, string>
    clear?: string[]
  }

  if (body.action === 'test') return runTest(body.group || '', auth.tenantId)
  if (body.action === 'meta-accounts') return listMetaAccounts(auth.tenantId, body.token)
  if (body.action === 'ia-modelos') return listarModelosIa(auth.tenantId, body.token)

  const updates = body.updates || {}
  const clear = body.clear || []

  const oauthValidationError = oauthCredentialValidationError(updates)
  if (oauthValidationError) return NextResponse.json({ error: oauthValidationError }, { status: 400 })

  // F33 · Al guardar un token de Meta nuevo en una subcuenta SIN cuenta publicitaria elegida, si el
  // token ve exactamente una cuenta activa se selecciona sola: sin selección no se sincroniza
  // gasto (D10) y la pantalla se quedaba en «conectada pero sin sincronizar». Con varias cuentas
  // no se elige nada: lo decide la persona.
  if (updates.META_ACCESS_TOKEN?.trim() && !updates.META_AD_ACCOUNT_ID?.trim()) {
    try {
      const cfgActual = await getTenantConfigWithFallback(auth.tenantId, true)
      if (parseAccountIds(cfgActual.META_AD_ACCOUNT_ID).length === 0) {
        const unica = cuentaUnicaActiva(
          await fetchAdAccounts(
            updates.META_ACCESS_TOKEN.trim(),
            cfgActual.META_API_VERSION || META_API_VERSION,
            (updates.META_APP_SECRET || cfgActual.META_APP_SECRET || '').trim() || undefined
          )
        )
        if (unica) updates.META_AD_ACCOUNT_ID = unica
      }
    } catch {
      // Best-effort: si Meta no responde, se guarda el token y la selección queda para la persona.
    }
  }
  const client = svc()
  const rows: {
    key: string
    tenant_id: string
    value: string
    is_secret: boolean
    key_fingerprint: string | null
    updated_by: string
  }[] = []
  const needsEnc = ALL_FIELDS.some((f) => f.secret && updates[f.key])

  if (needsEnc) {
    try {
      assertConfigEncryptionReady()
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'CONFIG_ENC_KEY no es válida' },
        { status: 503 }
      )
    }
  }

  for (const [key, raw] of Object.entries(updates)) {
    if (!isKnownKey(key)) continue
    const val = (raw ?? '').trim()
    const secret = SECRET_KEYS.has(key)
    if (secret && val === '') continue // no reescribir secreto en blanco
    rows.push({
      key,
      tenant_id: auth.tenantId,
      value: secret ? encryptSecret(val) : val,
      is_secret: secret,
      key_fingerprint: secret ? getConfigEncryptionKeyFingerprint() : null,
      updated_by: auth.callerId,
    })
  }

  if (rows.length) {
    // El índice único original era (key) global, lo que habría hecho que dos subcuentas guardando
    // la misma clave (p.ej. META_ACCESS_TOKEN) se pisaran entre sí.
    // 20260911160000_fix_cron_unique_constraints lo sustituyó por (tenant_id, key): VERIFICADO en
    // producción el 2026-09-13 — existe integration_settings_tenant_key_key UNIQUE (tenant_id, key)
    // y ya no hay unique global sobre `key`. (Este comentario decía "pendiente de aplicar": era
    // información obsoleta, no un pendiente real.)
    const { error } = await client.from('integration_settings').upsert(rows, { onConflict: 'tenant_id,key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Prueba el dato que ACABA de persistirse. Antes el navegador mostraba «guardado» solo porque
    // el upsert no lanzó; ahora cada secreto debe volver de la BD con el fingerprint actual y pasar
    // AES-GCM en la misma petición.
    const savedKeys = rows.map((row) => row.key)
    const { data: persisted, error: verifyError } = await client
      .from('integration_settings')
      .select('key,value,is_secret,key_fingerprint')
      .eq('tenant_id', auth.tenantId)
      .in('key', savedKeys)
    if (verifyError)
      return NextResponse.json({ error: `Guardado sin verificar: ${verifyError.message}` }, { status: 500 })
    if ((persisted ?? []).length !== rows.length) {
      return NextResponse.json({ error: 'El servidor no pudo verificar todas las claves guardadas.' }, { status: 500 })
    }
    for (const stored of persisted ?? []) {
      if (!(stored as { is_secret: boolean }).is_secret) continue
      const inspection = inspectEncryptedSecret(
        (stored as { value: string | null }).value,
        (stored as { key_fingerprint: string | null }).key_fingerprint
      )
      if (!inspection.decryptable || inspection.fingerprintMatches !== true) {
        console.error('[config] fallo de verificación tras guardar secreto', {
          tenantId: auth.tenantId,
          key: (stored as { key: string }).key,
          reason: inspection.status,
        })
        return NextResponse.json(
          { error: `La clave ${(stored as { key: string }).key} se guardó pero no superó la verificación de cifrado.` },
          { status: 500 }
        )
      }
    }
  }
  // Borrar de verdad: se cuentan las filas borradas en vez de dar por hecho que se fueron (una
  // escritura bloqueada por RLS afecta a 0 filas SIN error). Ya no hace falta retirar nada de
  // process.env: `ensureConfig` —lo que volcaba las credenciales ahí y hacía que un secreto borrado
  // siguiera vivo el resto de la vida de la lambda— se ha eliminado; ahora la configuración se pasa
  // como argumento a cada integración.
  let cleared: string[] = []
  const clearable = clear.filter(isKnownKey)
  if (clearable.length) {
    const { data: deleted, error: delErr } = await client
      .from('integration_settings')
      .delete()
      .eq('tenant_id', auth.tenantId)
      .in('key', clearable)
      .select('key')
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
    cleared = (deleted ?? []).map((r) => (r as { key: string }).key)
  }

  invalidateConfigCache(auth.tenantId)
  // Una clave que sigue en el entorno de Vercel no se puede borrar desde aquí: decirlo es lo único
  // honesto, porque el valor seguirá usándose como fallback.
  const enEntorno = clearable.filter((k) => !!process.env[k])
  return NextResponse.json({
    ok: true,
    saved: rows.length,
    savedKeys: rows.map((row) => row.key),
    cleared: cleared.length,
    clearedKeys: cleared,
    stillInEnv: enEntorno,
  })
}

// ── Probar conexión por integración ─────────────────────────────────────────

/**
 * Cuentas publicitarias que ve un token de Meta, para poder ELEGIR en vez de tener que averiguar el
 * `act_…` por tu cuenta. Acepta un token sin guardar: si el usuario tuviera que guardarlo primero,
 * guardaría uno inválido para descubrir que lo es.
 */
// Los modelos que la cuenta puede usar DE VERDAD, preguntándoselos al proveedor. Mismo patrón que
// "Buscar cuentas" de Meta: sin esto el modelo se escribía a mano y una errata —o un modelo que el
// proveedor retira— dejaba la IA muerta sin que el panel dijera nada.
async function listarModelosIa(tenantId: string, claveSinGuardar?: string): Promise<NextResponse> {
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  const clave = (claveSinGuardar || '').trim() || cfg.DEEPSEEK_API_KEY
  if (!clave) {
    return NextResponse.json({ ok: false, message: 'Pega antes la clave de API de DeepSeek.' }, { status: 400 })
  }
  try {
    const modelos = await listarModelos(clave)
    const { modelo, aviso } = resolverModelo(cfg.DEEPSEEK_MODEL, modelos, DEEPSEEK_MODELOS_PREFERIDOS)
    return NextResponse.json({ ok: true, modelos, sugerido: modelo, aviso })
  } catch (e) {
    const err = e instanceof ModelosError ? e : null
    return NextResponse.json(
      { ok: false, code: err?.code, message: err?.message ?? 'No se pudieron leer los modelos.' },
      { status: err?.code === 'token_invalido' ? 400 : 502 }
    )
  }
}

async function listMetaAccounts(tenantId: string, tokenSinGuardar?: string): Promise<NextResponse> {
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  const token = (tokenSinGuardar || '').trim() || cfg.META_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({ ok: false, message: 'Pega antes el token de acceso de Meta.' }, { status: 400 })
  }
  const version = cfg.META_API_VERSION || META_API_VERSION
  if (isDeprecatedMetaVersion(cfg.META_API_VERSION)) {
    return NextResponse.json(
      {
        ok: false,
        message: `La versión ${cfg.META_API_VERSION} está deprecada por Meta: bórrala en opciones avanzadas.`,
      },
      { status: 400 }
    )
  }
  try {
    const accounts = await fetchAdAccounts(token, version, cfg.META_APP_SECRET)
    if (accounts.length === 0) {
      return NextResponse.json({
        ok: false,
        message:
          'El token funciona pero no ve ninguna cuenta publicitaria. Dale el permiso ads_read sobre la cuenta en Meta Business y vuelve a buscar.',
      })
    }
    // `status` de Meta: 1 = activa. El resto (cerrada, con deuda, en revisión…) se marca para que no
    // elijas a ciegas una cuenta que no va a devolver datos.
    return NextResponse.json({
      ok: true,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, active: a.status === 1 })),
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      code: (e as { code?: string }).code,
      message: `No se pudieron listar las cuentas: ${(e as Error).message}`,
    })
  }
}

/** Veredicto de una comprobación. `code` es una pista ESTABLE para elegir el arreglo a mostrar. */
type ProbeResult = { ok: boolean; message: string; code?: string }

const PROBE_TIMEOUT_MS = 10_000

/** Evita que una API externa deje abierta una función de Vercel hasta agotar todo su presupuesto. */
function probeFetch(input: Parameters<typeof fetch>[0], init: RequestInit = {}) {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(PROBE_TIMEOUT_MS) })
}

/**
 * Traduce el código HTTP del proveedor a una causa. El mensaje lo escribe la API externa y cambia sin
 * avisar, así que la pantalla no puede depender de parsearlo para decir cómo arreglarlo.
 */
function codeFromStatus(status: number): string {
  if (status === 401) return 'token_invalido'
  if (status === 403) return 'sin_permisos'
  if (status === 429) return 'limite_de_uso'
  if (status >= 500) return 'red'
  return 'respuesta_inesperada'
}

/**
 * Comprueba una integración y GUARDA el resultado, que es lo que alimenta la luz de la pantalla.
 * Si no se guardara, la pantalla volvería a pintar "conectado" por tener un token escrito.
 */
async function runTest(group: string, tenantId: string): Promise<NextResponse> {
  const result = await probeGroup(group, tenantId)
  await guardarComprobacion(svc(), tenantId, group, result)
  return NextResponse.json({ ...result, checkedAt: new Date().toISOString() })
}

// Habla con la API de cada integración y devuelve un veredicto en claro.
//
// Devuelve datos, no una respuesta HTTP, por dos motivos: el resultado se GUARDA (es lo que alimenta
// la luz verde/gris/roja de la pantalla, que sin esto pintaría "conectado" por tener un token
// escrito), y así se puede probar la clasificación sin montar un servidor.
async function probeGroup(group: string, tenantId: string): Promise<ProbeResult> {
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  try {
    if (group === 'meta') {
      // La comprobación vive en `lib/meta/salud.ts`: el conector de Meta (F2) la usa también, y dos
      // comprobaciones del mismo proveedor terminan dando dos veredictos sobre la misma credencial.
      return comprobarSaludMeta(cfg)
    }
    if (group === 'instagram') {
      // La comprobación vive en `lib/instagram/salud.ts`: los crons guardan el mismo veredicto que esta
      // pantalla, y no pueden importar una función que vive dentro de una ruta.
      return comprobarSaludInstagram(cfg)
    }
    if (group === 'apify') {
      // §4/§12: comprobar conexión con /users/me (no gasta plataforma) y avisar si falta
      // configurar algún Actor — sin token no hay investigación, sin Actor tampoco.
      const token = cfg.APIFY_API_TOKEN
      if (!token) return { ok: false, message: 'Falta el API Token de Apify.' }
      const r = await fetch('https://api.apify.com/v2/users/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
      const j = (await r.json().catch(() => ({}))) as { data?: { username?: string }; error?: { message?: string } }
      if (!r.ok || !j.data) {
        return {
          ok: false,
          message: j.error?.message || `Apify respondió ${r.status}.`,
          code: codeFromStatus(r.status),
        }
      }
      const actors = [
        cfg.APIFY_INSTAGRAM_REELS_ACTOR_ID,
        cfg.APIFY_INSTAGRAM_PROFILE_ACTOR_ID,
        cfg.APIFY_TIKTOK_ACTOR_ID,
        cfg.APIFY_YOUTUBE_ACTOR_ID,
      ].filter((a) => a && String(a).trim())
      return {
        ok: true,
        message: actors.length
          ? `Conectado como ${j.data.username || 'OK'} · ${actors.length} Actor(es) configurado(s).`
          : `Conectado como ${j.data.username || 'OK'}, pero falta configurar al menos un Actor en Opciones avanzadas.`,
      }
    }
    if (group === 'calendly') {
      const token = cfg.CALENDLY_API_TOKEN
      if (!token) return { ok: false, message: 'Falta el PAT de Calendly.' }
      const r = await probeFetch('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      return r.ok
        ? { ok: true, message: `Usuario: ${j.resource?.name || 'OK'}` }
        : { ok: false, message: j.message || 'Token inválido', code: codeFromStatus(r.status) }
    }
    if (group === 'bunny') {
      const bunny = configBunny(cfg)
      if (!bunny) return { ok: false, message: `Falta ${faltaEnConfigBunny(cfg).join(', ')}.` }
      const r = await probarBunny(bunny)
      return r.ok
        ? { ok: true, message: r.message }
        : { ok: false, message: r.message, code: codeFromStatus(r.status ?? 0) }
    }
    if (group === 'fathom') {
      const key = cfg.FATHOM_API_KEY
      if (!key) return { ok: false, message: 'Falta la API key de Fathom.' }
      const r = await fetch('https://api.fathom.ai/external/v1/meetings?limit=1', {
        headers: { 'X-Api-Key': key, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      const j = (await r.json().catch(() => ({}))) as { items?: unknown[]; message?: string; error?: string }
      return r.ok
        ? {
            ok: true,
            message: `Fathom conectado; ${j.items?.length ? 'hay reuniones accesibles.' : 'sin reuniones accesibles todavía.'}`,
          }
        : {
            ok: false,
            message: j.message || j.error || `Fathom respondió ${r.status}.`,
            code: codeFromStatus(r.status),
          }
    }
    if (group === 'email') {
      const key = cfg.RESEND_API_KEY
      if (!key) return { ok: false, message: 'Falta la API key de Resend.' }
      const from = cfg.RESEND_FROM || ''
      const fromDomain = from.match(/@([^>\s]+)/)?.[1]?.toLowerCase() || null
      const r = await probeFetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (r.ok) {
        const j = (await r.json().catch(() => ({}))) as { data?: { name: string; status: string }[] }
        const domains = j.data ?? []
        const verified = domains.filter((d) => d.status === 'verified').map((d) => d.name.toLowerCase())
        if (!fromDomain) {
          return {
            ok: false,
            message: `Falta configurar el remitente (RESEND_FROM). Dominios verificados: ${verified.join(', ') || 'ninguno'}.`,
          }
        }
        if (!verified.includes(fromDomain)) {
          return {
            ok: false,
            message: `La API key es válida, pero el dominio "${fromDomain}" del remitente no está verificado. Dominios verificados: ${verified.join(', ') || 'ninguno'}.`,
            code: 'dominio_no_verificado',
          }
        }
        return { ok: true, message: `Conexión correcta. Dominio "${fromDomain}" verificado.` }
      }
      // Key de tipo "solo envío": no tiene permiso para listar dominios (401 restricted_api_key).
      // Sigue siendo válida para enviar, así que hacemos una comprobación real intentando un envío
      // de prueba sin destinatario válido para que Resend nos diga si el dominio está verificado.
      const j = (await r.json().catch(() => ({}))) as { name?: string }
      if (r.status === 401 && j?.name === 'restricted_api_key') {
        const probe = await probeFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: from || 'onboarding@resend.dev',
            to: ['verificacion@resend.dev'],
            subject: 'ping',
            html: '<p>ping</p>',
          }),
        })
        const pj = (await probe.json().catch(() => ({}))) as { message?: string; name?: string }
        if (probe.ok)
          return {
            ok: true,
            message: `Conexión correcta (key de solo envío). Remitente "${fromDomain || from}".`,
          }
        if (/not verified/i.test(pj.message || '')) {
          return {
            ok: false,
            message: `El dominio "${fromDomain}" del remitente NO está verificado en Resend.`,
            code: 'dominio_no_verificado',
          }
        }
        return { ok: false, message: pj.message || 'No se pudo enviar el correo de prueba.' }
      }
      return { ok: false, message: 'API key inválida.', code: 'token_invalido' }
    }
    if (group === 'stripe') {
      const key = cfg.STRIPE_SECRET_KEY
      if (!key) return { ok: false, message: 'Falta la Secret Key de Stripe.' }
      // Por `stripeGet` y no por un fetch a pelo: así esta comprobación tiene timeout (la anterior no
      // tenía ninguno: con Stripe colgado, la pantalla se quedaba esperando) y el error llega ya
      // traducido a una causa con arreglo en vez de en inglés para desarrolladores.
      try {
        const j = await stripeGet<{ data?: unknown[] }>('payment_intents', new URLSearchParams({ limit: '1' }), {
          secretKey: key,
          accountId: cfg.STRIPE_ACCOUNT_ID,
        })
        return {
          ok: true,
          message: `Stripe conectado; acceso de lectura de pagos confirmado${j.data?.length ? '.' : ' (sin pagos todavía).'}`,
        }
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : 'No se pudo conectar con Stripe.',
          code: (e as { code?: string }).code || 'respuesta_inesperada',
        }
      }
    }
    if (group === 'ghl') {
      const token = cfg.GHL_API_TOKEN
      const locationId = cfg.GHL_LOCATION_ID
      if (!token || !locationId) return { ok: false, message: 'Faltan el token o el Location ID de GoHighLevel.' }
      const r = await probeFetch(`https://services.leadconnectorhq.com/locations/${encodeURIComponent(locationId)}`, {
        headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' },
      })
      const j = (await r.json().catch(() => ({}))) as { location?: { name?: string }; message?: string }
      return r.ok
        ? { ok: true, message: `Subcuenta ${j.location?.name || locationId} conectada.` }
        : { ok: false, message: j.message || `GoHighLevel respondió ${r.status}.`, code: codeFromStatus(r.status) }
    }
    if (group === 'hotmart') {
      if (!cfg.HOTMART_CLIENT_ID || !cfg.HOTMART_CLIENT_SECRET) {
        return { ok: false, message: 'Faltan el Client ID o el Client Secret de Hotmart.' }
      }
      const query = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.HOTMART_CLIENT_ID,
        client_secret: cfg.HOTMART_CLIENT_SECRET,
      })
      // Hotmart EXIGE la cabecera `Authorization: Basic` además de los parámetros: sin ella responde
      // 401 siempre, con las credenciales correctas. Faltaba, así que esta integración no podía
      // conectar nunca. El valor es el "token Basic" que muestra su panel, que es exactamente
      // base64(client_id:client_secret); se acepta pegado a mano por si el suyo difiere.
      const basic =
        cfg.HOTMART_BASIC_TOKEN?.trim() ||
        Buffer.from(`${cfg.HOTMART_CLIENT_ID}:${cfg.HOTMART_CLIENT_SECRET}`).toString('base64')
      const r = await probeFetch(`https://api-sec-vlc.hotmart.com/security/oauth/token?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
      })
      const j = (await r.json().catch(() => ({}))) as { error_description?: string; access_token?: string }
      return r.ok && j.access_token
        ? { ok: true, message: 'Credenciales de Hotmart válidas.' }
        : { ok: false, message: j.error_description || 'Client ID o Secret inválidos.', code: 'token_invalido' }
    }
    if (group === 'whop') {
      if (!cfg.WHOP_API_KEY) return { ok: false, message: 'Falta la API Key de Whop.' }
      const r = await probeFetch('https://api.whop.com/api/v2/me', {
        headers: { Authorization: `Bearer ${cfg.WHOP_API_KEY}` },
      })
      const j = (await r.json().catch(() => ({}))) as { message?: string }
      return r.ok
        ? { ok: true, message: 'API Key de Whop válida.' }
        : { ok: false, message: j.message || `Whop respondió ${r.status}.`, code: codeFromStatus(r.status) }
    }
    if (group === 'ai') {
      if (!cfg.DEEPSEEK_API_KEY && !cfg.ANTHROPIC_API_KEY && !cfg.GEMINI_API_KEY && !cfg.OPENAI_API_KEY) {
        return {
          ok: false,
          message: 'Configura al menos un motor: DeepSeek o Anthropic para texto, Gemini u OpenAI para imágenes.',
        }
      }

      const motores: string[] = []
      if (cfg.DEEPSEEK_API_KEY) {
        try {
          const modelos = await listarModelos(cfg.DEEPSEEK_API_KEY)
          const { modelo, aviso } = resolverModelo(cfg.DEEPSEEK_MODEL, modelos, DEEPSEEK_MODELOS_PREFERIDOS)
          if (!modelo) {
            return {
              ok: false,
              message: aviso ?? 'El modelo guardado no está disponible.',
              code: 'modelo_no_disponible',
            }
          }
          motores.push(`DeepSeek (${modelo}${cfg.DEEPSEEK_MODEL ? '' : ', automático'})`)
        } catch (e) {
          const err = e instanceof ModelosError ? e : null
          return {
            ok: false,
            message: `DeepSeek falló: ${err?.message ?? 'no se pudo comprobar'}`,
            code: err?.code === 'token_invalido' ? 'token_invalido' : err?.code === 'red' ? 'red' : undefined,
          }
        }
      }

      if (cfg.ANTHROPIC_API_KEY) {
        const anthropic = await probeFetch('https://api.anthropic.com/v1/models?limit=1', {
          headers: { 'x-api-key': cfg.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        })
        if (!anthropic.ok) {
          return {
            ok: false,
            message: `Anthropic respondió ${anthropic.status}.`,
            code: codeFromStatus(anthropic.status),
          }
        }
        motores.push('Anthropic')
      }

      if (cfg.GROQ_API_KEY) {
        const groq = await probeFetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${cfg.GROQ_API_KEY}` },
        })
        if (!groq.ok) {
          return { ok: false, message: `Groq respondió ${groq.status}.`, code: codeFromStatus(groq.status) }
        }
        motores.push('Groq (transcripción)')
      }

      // Proveedores de IMAGEN (carruseles, flyers, historias): se comprueba solo que la clave sea válida
      // listando modelos; no se genera ninguna imagen (costaría dinero al pulsar «Probar»).
      if (cfg.GEMINI_API_KEY) {
        const gemini = await probeFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
          headers: { 'x-goog-api-key': cfg.GEMINI_API_KEY },
        })
        if (!gemini.ok)
          return { ok: false, message: `Gemini respondió ${gemini.status}.`, code: codeFromStatus(gemini.status) }
        motores.push('Gemini (imágenes)')
      }
      if (cfg.OPENAI_API_KEY) {
        const openai = await probeFetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
        })
        if (!openai.ok)
          return { ok: false, message: `OpenAI respondió ${openai.status}.`, code: codeFromStatus(openai.status) }
        motores.push('OpenAI (imágenes)')
      }

      return {
        ok: true,
        message: `${motores.join(' y ')} conectado${motores.length > 1 ? 's' : ''}.${cfg.GROQ_API_KEY ? '' : ' Groq no está configurado: el agente funciona, pero no la transcripción.'}`,
      }
    }
    if (group === 'youtube') {
      const sb = svc()
      const { data: connection, error } = await sb
        .from('google_oauth_connections')
        .select('id,refresh_token,access_token,access_token_expires_at')
        .eq('tenant_id', tenantId)
        .eq('provider', 'youtube')
        .maybeSingle()
      if (error || !connection) {
        return { ok: false, message: 'Conecta primero el canal de YouTube.', code: 'token_invalido' }
      }
      const token = await getValidGoogleAccessToken(sb, connection)
      if ('error' in token) return { ok: false, message: token.error, code: 'token_invalido' }
      const r = await probeFetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=1', {
        headers: { Authorization: `Bearer ${token.token}` },
      })
      return r.ok
        ? { ok: true, message: 'Canal y analíticas de YouTube conectados.' }
        : { ok: false, message: `YouTube respondió ${r.status}.`, code: codeFromStatus(r.status) }
    }
    if (group === 'sequra') {
      if (!cfg.SEQURA_MCP_TOKEN) return { ok: false, message: 'Falta el token MCP de SeQura.' }
      const r = await probeFetch('https://simba.sequra.com/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${cfg.SEQURA_MCP_TOKEN}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list', params: {} }),
      })
      return r.ok
        ? { ok: true, message: 'SeQura conectado.' }
        : {
            ok: false,
            message: `SeQura respondió ${r.status}; renueva el token si ha caducado.`,
            code: codeFromStatus(r.status),
          }
    }
    if (group === 'creatuagente') {
      if (!cfg.CREATUAGENTE_WEBHOOK_URL || !cfg.CREATUAGENTE_WEBHOOK_SECRET) {
        return { ok: false, message: 'Faltan la URL o el secreto del webhook.' }
      }
      try {
        new URL(cfg.CREATUAGENTE_WEBHOOK_URL)
      } catch {
        return { ok: false, message: 'La URL del webhook no es válida.' }
      }
      return { ok: true, message: 'Configuración válida. No se envió ningún evento de prueba.' }
    }
    return { ok: false, message: 'Esta integración no tiene prueba automática.' }
  } catch (e) {
    // Un fallo de red NO es una credencial inválida: decirlo así mandaría al usuario a rotar un
    // token que está perfecto.
    return { ok: false, message: `No se pudo hablar con la API: ${(e as Error).message}`, code: 'red' }
  }
}

// SONDA DE SOLO-LECTURA — ¿por qué solo la campaña VSL concentra la atribución Meta, y qué
// UTMs históricos de OTRAS campañas son recuperables en GHL? (petición de Alex, 23-oct).
//
// Parte 1 (BD producción): distribución real de UTMs en contact_attributions y contacts.campaign_id,
//          y de qué campañas vienen las ventas. Agregados: ningún dato personal impreso.
// Parte 2 (GHL): muestrea fichas de dos cohortes (compradores con venta activa y contactos SIN
//   atribución de campaña pagada) y resume qué traen firstAttributionSource / lastAttributionSource.
//   Imprime DISTRIBUCIONES y valores de utm_* (datos de campaña, no personales) — cero PII:
//   nunca nombres, teléfonos ni emails.
//
// Credenciales: POSTGRES_URL / SUPABASE_SERVICE_ROLE_KEY / CONFIG_ENC_KEY de .env.local (mismo
// patrón que scripts/sonda-ghl-conversaciones.mjs). Uso: node scripts/sonda-atribucion-meta.mjs
const { createClient } = await import('@supabase/supabase-js')
const { leerEnvLocal } = await import('./env-local.mjs')
const { createDecipheriv, createHash } = await import('node:crypto')
const postgres = (await import('postgres')).default

const env = leerEnvLocal()
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
const encKeyEnv = process.env.CONFIG_ENC_KEY || env.CONFIG_ENC_KEY
const pgUrl = process.env.POSTGRES_URL || env.POSTGRES_URL
if (!url || !key || !encKeyEnv || !pgUrl) {
  console.error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CONFIG_ENC_KEY / POSTGRES_URL en .env.local'
  )
  process.exit(1)
}

function descifrar(stored) {
  const ENCP = 'enc:v1:'
  if (!stored?.startsWith(ENCP)) return stored
  const k = createHash('sha256').update(encKeyEnv, 'utf8').digest()
  const raw = Buffer.from(stored.slice(ENCP.length), 'base64')
  const d = createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
}

const sb = createClient(url, key)

// El host directo `db.<ref>.supabase.co` es IPv6-only y no resuelve en todas las máquinas:
// si no responde, se cae al pooler de la región del proyecto (mismo password, usuario
// `postgres.<ref>`). Solo lectura: max 1 conexión y consultas de agregación.
function abrirPostgres() {
  // El host directo `db.<ref>.supabase.co` es IPv6-only y no resuelve en todas las máquinas:
  // se usa el pooler de la región del proyecto (mismo password, usuario `postgres.<ref>`).
  // Solo lectura: max 1 conexión.
  const u = new URL(pgUrl)
  const ref = u.hostname.replace(/^db\./, '').split('.')[0]
  return postgres({
    host: 'aws-1-eu-west-1.pooler.supabase.com',
    port: 6543,
    user: `postgres.${ref}`,
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'postgres',
    ssl: 'require',
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 8,
  })
}
const sql = abrirPostgres()

const corto = (v, n = 42) => {
  if (v == null) return '∅'
  const s = String(v)
  return s.length > n ? s.slice(0, n) + '…' : s
}

function tabla(titulo, filas, columnas) {
  console.log(`\n== ${titulo} ==`)
  if (!filas.length) {
    console.log('  (sin filas)')
    return
  }
  console.log('  ' + columnas.map((c) => c.padEnd(24)).join(' | '))
  for (const f of filas) console.log('  ' + columnas.map((c) => corto(f[c], 24)).join(' | '))
}

async function parteBD() {
  console.log('\n########## PARTE 1 — BD (agregados, sin PII) ##########')

  const camp = await sql`
    select t.slug, c.name, c.external_id, c.id
    from campaigns c join tenants t on t.id = c.tenant_id
    order by t.slug, c.name`
  tabla('catálogo de campañas de Meta sincronizadas', camp, ['slug', 'name', 'external_id'])
  console.log(`total campañas: ${camp.length}`)

  const attr = await sql`
    select t.slug,
           coalesce(nullif(a.first_utm_campaign, ''), '(vacío)') as first_camp,
           coalesce(nullif(a.first_utm_source, ''), '(vacío)')   as first_source,
           count(*) as n
    from contact_attributions a
      join contacts c on c.id = a.contact_id
      join tenants t on t.id = c.tenant_id
    group by 1, 2, 3
    order by 1, 4 desc`
  tabla('distribución de first_utm_campaign × first_utm_source en contact_attributions', attr, [
    'slug',
    'first_camp',
    'first_source',
    'n',
  ])

  const lastAttr = await sql`
    select t.slug,
           coalesce(nullif(a.last_utm_campaign, ''), '(vacío)') as last_camp,
           coalesce(nullif(a.last_utm_source, ''), '(vacío)')   as last_source,
           count(*) as n
    from contact_attributions a
      join contacts c on c.id = a.contact_id
      join tenants t on t.id = c.tenant_id
    group by 1, 2, 3
    order by 1, 4 desc`
  tabla('distribución de last_utm_campaign × last_utm_source', lastAttr, ['slug', 'last_camp', 'last_source', 'n'])

  const porContacto = await sql`
    select t.slug,
           (count(*) filter (where c.campaign_id is not null)) as con_campana,
           count(*) as total
    from contacts c join tenants t on t.id = c.tenant_id
    group by 1`
  tabla('contacts con campaign_id asignada vs total', porContacto, ['slug', 'con_campana', 'total'])

  const concentracion = await sql`
    select t.slug, coalesce(cp.name, '(sin campaña)') as campana, count(*) as n
    from contacts c
      join tenants t on t.id = c.tenant_id
      left join campaigns cp on cp.id = c.campaign_id
    group by 1, 2
    order by 1, 3 desc`
  tabla('concentración de contacts por campaña asignada', concentracion, ['slug', 'campana', 'n'])

  const ventas = await sql`
    select t.slug,
           coalesce(cp.name, '(sin campaña)') as campana,
           count(*) filter (where s.status = 'active') as ventas_activas,
           count(*) as total
    from sales s
      join contacts c on c.id = s.contact_id
      join tenants t on t.id = c.tenant_id
      left join campaigns cp on cp.id = c.campaign_id
    group by 1, 2
    order by 1, 3 desc`
  tabla('ventas por campaña del contacto', ventas, ['slug', 'campana', 'ventas_activas', 'total'])

  // ¿Y la atribución (no la asignación) de los compradores? La vista /meta/revenue-attribution
  // usa el ÚLTIMO toque con evidencia de contact_attributions.
  const ventasAttr = await sql`
    select t.slug,
           coalesce(nullif(a.last_utm_campaign, ''), '(sin utm last)') as last_camp,
           coalesce(nullif(a.last_utm_source, ''), '(sin utm last)')   as last_source,
           count(*) as n
    from sales s
      join contacts c on c.id = s.contact_id
      join tenants t on t.id = c.tenant_id
      left join contact_attributions a on a.contact_id = c.id
    group by 1, 2, 3
    order by 1, 4 desc`
  tabla('ventas por last_utm de su atribución', ventasAttr, ['slug', 'last_camp', 'last_source', 'n'])

  // ¿Los toques de ads apuntan TODOS al mismo id de campaña (copy-paste) o son de verdad de
  // campañas distintas? Correlación: detalles del catálogo y de los toques con id numérico.
  const detalle = await sql`
    select t.slug, c.name, c.external_id, c.status, c.start_date, c.end_date,
           c.adspend, c.meta_leads, c.funnel_leads, c.link_clicks, c.synced_at
    from campaigns c join tenants t on t.id = c.tenant_id
    order by c.adspend desc nulls last`
  tabla('detalle del catálogo (gasto y fechas de Meta)', detalle, [
    'slug',
    'name',
    'external_id',
    'adspend',
    'meta_leads',
    'funnel_leads',
  ])

  const toquesAds = await sql`
    select a.first_utm_campaign as camp,
           a.first_utm_source   as source,
           coalesce(a.funnel, '(sin funnel)') as funnel,
           coalesce(nullif(split_part(a.landing_url, '?', 1), ''), '(sin url)') as landing,
           to_char(a.first_touch_at, 'YYYY-MM') as mes,
           count(*) as n
    from contact_attributions a
      join contacts c on c.id = a.contact_id
    where a.first_utm_source ~ '^1\\d{14,17}$'
    group by 1, 2, 3, 4, 5
    order by 6 desc`
  tabla('toques con id de campaña Meta en utm_source: funnel, landing, mes', toquesAds, [
    'camp',
    'source',
    'funnel',
    'landing',
    'mes',
    'n',
  ])

  // Las agendas de los compradores llevan SUS PROPIAS columnas utm_* (bloque de la cita):
  // si ahí aparecen campañas distintas a VSL, hay UTMs de otras campañas capturados.
  const agendasCompradores = await sql`
    select coalesce(nullif(ap.utm_campaign, ''), '(vacío)') as camp,
           coalesce(nullif(ap.utm_source, ''), '(vacío)')   as source,
           to_char(ap.appointment_datetime, 'YYYY-MM')      as mes,
           count(*) as n
    from appointments ap
      join sales s on s.appointment_id = ap.id
    group by 1, 2, 3
    order by 4 desc`
  tabla('UTMs de las agendas de los COMPRADORES (columnas de la cita)', agendasCompradores, [
    'camp',
    'source',
    'mes',
    'n',
  ])

  // Y lo mismo para TODAS las agendas (no solo compradores): ¿hay UTMs de otras campañas?
  const agendasTodas = await sql`
    select coalesce(nullif(utm_campaign, ''), '(vacío)') as camp,
           coalesce(nullif(utm_source, ''), '(vacío)')   as source,
           count(*) as n
    from appointments
    group by 1, 2
    order by 3 desc
    limit 20`
  tabla('UTMs de TODAS las agendas (top 20)', agendasTodas, ['camp', 'source', 'n'])

  // ── FUENTES DE RECUPERACIÓN ──
  // Los blobs crudos (appointments.raw_payload de Calendly, raw_events de webhooks) pueden
  // llevar UTMs que las columnas tipadas no tienen. Se recorre el JSON recursivamente y se
  // agrega cada clave *utm* encontrada (valores de campaña, nunca datos personales).
  function recorrerUtm(nodo, colecta, ruta = '') {
    if (nodo == null || typeof nodo !== 'object') return
    if (Array.isArray(nodo)) {
      for (const item of nodo) recorrerUtm(item, colecta, ruta)
      return
    }
    for (const [k, v] of Object.entries(nodo)) {
      const nueva = `${ruta}.${k}`
      if (/utm/i.test(k) && (typeof v === 'string' || typeof v === 'number')) {
        const valor = String(v).trim()
        colecta[k] = colecta[k] ?? {}
        colecta[k][valor === '' ? '(vacío)' : valor] = (colecta[k][valor === '' ? '(vacío)' : valor] ?? 0) + 1
      } else if (typeof v === 'object') {
        recorrerUtm(v, colecta, nueva)
      }
    }
  }

  function imprimirColecta(titulo, colecta) {
    const claves = Object.keys(colecta).sort()
    console.log(`\n== ${titulo} ==`)
    if (!claves.length) return console.log('  (ninguna clave utm encontrada)')
    for (const k of claves) {
      const dist = colecta[k]
      const total = Object.values(dist).reduce((a, b) => a + b, 0)
      console.log(`  ${k}: ${total} valores, ${Object.keys(dist).length} distintos`)
      for (const [v, n] of Object.entries(dist)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)) {
        console.log(`     ${String(n).padStart(4)} × ${corto(v, 60)}`)
      }
    }
  }

  const blobsAgendas = await sql`select raw_payload from appointments where raw_payload is not null`
  const colectaAgendas = {}
  for (const fila of blobsAgendas) recorrerUtm(fila.raw_payload, colectaAgendas)
  imprimirColecta(`appointments.raw_payload (${blobsAgendas.length} blobs) — claves utm`, colectaAgendas)

  const blobsRaw = await sql`select source, payload from raw_events`
  const colectaRaw = {}
  for (const fila of blobsRaw) recorrerUtm(fila.payload, colectaRaw)
  imprimirColecta(`raw_events (${blobsRaw.length} sobres) — claves utm`, colectaRaw)

  // contacts: ¿columnas JSONB con UTMs de GHL (custom fields sincronizados)?
  const colsContacts = await sql.unsafe(
    `select column_name, data_type from information_schema.columns where table_name = 'contacts' and table_schema = 'public'`
  )
  const jsonb = colsContacts.filter((c) => c.data_type === 'jsonb').map((c) => c.column_name)
  console.log(`\ncontacts columnas JSONB: ${jsonb.join(', ') || '(ninguna)'}`)
  for (const col of jsonb) {
    const filas = await sql.unsafe(`select ${col} as v from contacts where ${col} is not null limit 2000`)
    const colecta = {}
    for (const fila of filas) recorrerUtm(fila.v, colecta)
    if (Object.keys(colecta).length) imprimirColecta(`contacts.${col} — claves utm`, colecta)
  }
}

async function credencialGhl(t) {
  const { data: cfg, error: cErr } = await sb
    .from('integration_settings')
    .select('key,value,is_secret')
    .eq('tenant_id', t.id)
    .in('key', ['GHL_API_TOKEN', 'GHL_LOCATION_ID'])
  if (cErr) return { error: `integration_settings ilegible: ${cErr.message}` }
  const tok = cfg?.find((r) => r.key === 'GHL_API_TOKEN')
  const loc = cfg?.find((r) => r.key === 'GHL_LOCATION_ID')
  if (!tok?.value || !loc?.value) {
    return { error: `sin credencial completa (token: ${!!tok?.value}, location: ${!!loc?.value})` }
  }
  try {
    const token = descifrar(tok.value)
    if (!token) return { error: 'token descifrado vacío' }
    return { token, location: loc.value }
  } catch (e) {
    return { error: `token NO descifrable con CONFIG_ENC_KEY local: ${e.message}` }
  }
}

// Qué traen los bloques de atribución de la ficha GHL: agrega claves y valores utm_*.
function resumenAtribucionGhl(bloque) {
  if (!bloque || typeof bloque !== 'object') return null
  const utms = {}
  let otras = 0
  for (const [k, v] of Object.entries(bloque)) {
    if (/^utm_/i.test(k)) utms[k] = String(v ?? '').slice(0, 60)
    else if (v != null && v !== '') otras++
  }
  return { utms, otras }
}

async function parteGhl() {
  console.log('\n########## PARTE 2 — GHL (fichas muestreadas, cero PII) ##########')
  const { data: tenants, error: tErr } = await sb.from('tenants').select('id, slug, name').eq('status', 'active')
  if (tErr) throw new Error(`tenants: ${tErr.message}`)

  for (const t of tenants) {
    const cred = await credencialGhl(t)
    if (!cred || cred.error) {
      console.log(`\n[${t.slug}] parte GHL omitida — ${cred?.error ?? 'credencial no utilizable'}`)
      continue
    }
    console.log(`\n[${t.slug}] credencial GHL presente`)

    // Cohortes: (a) compradores con venta activa; (b) contactos sin campaña pagada asignada.
    const compradores = await sql`
      select distinct c.id, c.ghl_contact_id
      from sales s join contacts c on c.id = s.contact_id
      where c.tenant_id = ${t.id} and s.status = 'active' and c.ghl_contact_id is not null
      limit 40`
    const sinCampana = await sql`
      select c.id, c.ghl_contact_id
      from contacts c
      where c.tenant_id = ${t.id} and c.campaign_id is null and c.ghl_contact_id is not null
        and not exists (select 1 from sales s where s.contact_id = c.id and s.status = 'active')
      order by c.created_at desc
      limit 40`

    for (const [nombre, cohorte] of [
      ['COMPRADORES (venta activa)', compradores],
      ['SIN CAMPAÑA (no compradores recientes)', sinCampana],
    ]) {
      console.log(`\n-- cohorte ${nombre}: ${cohorte.length} fichas GHL a muestrear --`)
      const porFuente = { first: {}, last: {} }
      let conUtm = 0
      let sinBloque = 0
      let errores = 0
      for (const c of cohorte) {
        if (!c.ghl_contact_id) continue
        let body
        try {
          const res = await fetch(
            `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(c.ghl_contact_id)}`,
            {
              headers: { Authorization: `Bearer ${cred.token}`, Version: '2021-07-28', Accept: 'application/json' },
              signal: AbortSignal.timeout(20_000),
            }
          )
          if (!res.ok) {
            errores++
            if (res.status === 429) await new Promise((r) => setTimeout(r, 1500))
            continue
          }
          body = await res.json()
        } catch {
          errores++
          continue
        }
        const ct = body?.contact ?? {}
        const first = resumenAtribucionGhl(ct.firstAttributionSource ?? ct.first_attribution_source)
        const last = resumenAtribucionGhl(ct.lastAttributionSource ?? ct.last_attribution_source)
        if (!first && !last) {
          sinBloque++
          continue
        }
        for (const [via, r] of [
          ['first', first],
          ['last', last],
        ]) {
          if (!r) continue
          const tieneUtm = Object.keys(r.utms).length > 0
          if (via === 'first' && tieneUtm) conUtm++
          for (const [k, v] of Object.entries(r.utms)) {
            const clave = `${via}.${k}`
            porFuente[clave] = porFuente[clave] ?? {}
            const etiqueta = v === '' ? '(vacío)' : v
            porFuente[clave][etiqueta] = (porFuente[clave][etiqueta] ?? 0) + 1
          }
        }
        await new Promise((r) => setTimeout(r, 120))
      }
      console.log(
        `fichas con bloque de atribución: ${cohorte.length - sinBloque - errores}, sin bloque: ${sinBloque}, errores HTTP: ${errores}, con UTMs en first: ${conUtm}`
      )
      for (const [clave, dist] of Object.entries(porFuente).sort()) {
        const total = Object.values(dist).reduce((a, b) => a + b, 0)
        console.log(`  ${clave}: ${total} valores, ${Object.keys(dist).length} distintos`)
        const orden = Object.entries(dist)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
        for (const [v, n] of orden) console.log(`     ${String(n).padStart(4)} × ${corto(v, 60)}`)
      }
    }
  }
}

async function main() {
  await parteBD()
  await sql.end()
  await parteGhl()
  console.log('\nSonda de solo-lectura terminada. Ningún dato personal ha sido impreso.')
}

main().catch(async (e) => {
  console.error('Sonda falló:', e.message)
  await sql.end().catch(() => {})
  process.exit(1)
})

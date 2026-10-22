// HERRAMIENTAS `search` y `fetch` DEL MCP (puras: construyen SQL y dan forma al resultado).
//
// ChatGPT (apps, investigación profunda, conocimiento de empresa) espera exactamente este par:
//   · search(query) → { results: [{ id, title, url }] }, serializado como JSON en un bloque de texto.
//   · fetch(id)     → { id, title, text, url, metadata }, también como JSON en un bloque de texto.
// Sin ellas, ChatGPT no tiene cómo «buscar o listar» y trata la app como no utilizable.
//
// SEGURIDAD: el texto viene del modelo, es decir, NO es de fiar. El ejecutor SQL no admite parámetros, así que
// el texto solo entra como LITERAL entre comillas con las comillas duplicadas y los comodines de LIKE escapados;
// los ids de `fetch` se validan como UUID antes de tocar el SQL. El aislamiento por subcuenta y por rol lo pone
// el RLS del usuario que autorizó (ver sql-executor.ts): aquí no se filtra nada «a mano».

export const MAX_BUSQUEDA = 100
export const MAX_RESULTADOS = 15

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Literal SQL seguro para un patrón LIKE «contiene». `null` si no queda texto buscable. */
export function literalContiene(texto: string): string | null {
  const limpio = texto
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BUSQUEDA)
  if (!limpio) return null
  const escapado = limpio.replace(/[\\%_]/g, '\\$&').replace(/'/g, "''")
  return `'%${escapado}%'`
}

export function sqlBuscar(query: string): string | null {
  const patron = literalContiene(query)
  if (!patron) return null
  return (
    `select c.id, c.full_name, c.email, c.instagram, t.slug as tenant_slug ` +
    `from contacts c join tenants t on t.id = c.tenant_id ` +
    `where c.full_name ilike ${patron} escape '\\' or c.email ilike ${patron} escape '\\' ` +
    `or c.phone ilike ${patron} escape '\\' or c.instagram ilike ${patron} escape '\\' ` +
    `order by c.created_at desc limit ${MAX_RESULTADOS}`
  )
}

type FilaBusqueda = {
  id: string
  full_name: string | null
  email: string | null
  instagram: string | null
  tenant_slug: string
}

export function resultadosDeBusqueda(filas: FilaBusqueda[], origen: string) {
  return {
    results: filas.map((f) => ({
      id: `contact:${f.id}`,
      title: [f.full_name || 'Sin nombre', f.email || f.instagram].filter(Boolean).join(' · '),
      url: `${origen}/${f.tenant_slug}/crm/contactos/${f.id}`,
    })),
  }
}

/** Id de `fetch` → consulta de UN contacto con sus citas, o `null` si el id no es válido. */
export function sqlFetch(id: string): { sql: string; uuid: string } | null {
  const m = /^contact:(.+)$/.exec(id.trim())
  const uuid = m?.[1] ?? ''
  if (!UUID.test(uuid)) return null
  return {
    uuid,
    sql:
      `select c.id, c.full_name, c.email, c.phone, c.instagram, c.lifecycle, c.notes, c.created_at, t.slug as tenant_slug, ` +
      `coalesce((select json_agg(json_build_object('id', a.id, 'status', a.status, 'result', a.result, 'created_at', a.created_at) ` +
      `order by a.created_at desc) from appointments a where a.contact_id = c.id), '[]'::json) as appointments ` +
      `from contacts c join tenants t on t.id = c.tenant_id where c.id = '${uuid}'`,
  }
}

type FilaContacto = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  instagram: string | null
  lifecycle: string | null
  notes: string | null
  created_at: string
  tenant_slug: string
  appointments: { id: string; status: string | null; result: string | null; created_at: string }[]
}

export function documentoDeContacto(f: FilaContacto, origen: string) {
  const citas = f.appointments ?? []
  const texto = [
    `Contacto: ${f.full_name || 'Sin nombre'}`,
    f.email ? `Email: ${f.email}` : '',
    f.phone ? `Teléfono: ${f.phone}` : '',
    f.instagram ? `Instagram: ${f.instagram}` : '',
    f.lifecycle ? `Estado: ${f.lifecycle}` : '',
    f.notes ? `Notas: ${f.notes}` : '',
    citas.length
      ? `Citas (${citas.length}):\n${citas.map((a) => `- ${a.created_at?.slice(0, 10)} · ${a.status ?? '?'}${a.result ? ` · ${a.result}` : ''}`).join('\n')}`
      : 'Sin citas.',
  ]
    .filter(Boolean)
    .join('\n')
  return {
    id: `contact:${f.id}`,
    title: f.full_name || 'Sin nombre',
    text: texto,
    url: `${origen}/${f.tenant_slug}/crm/contactos/${f.id}`,
    metadata: { tipo: 'contacto', subcuenta: f.tenant_slug, creado: f.created_at },
  }
}

/**
 * Endpoint MCP (Model Context Protocol) — JSON-RPC 2.0 por HTTP streamable.
 *
 * Autenticación: Bearer JWT HS256 emitido por el propio servidor OAuth 2.1 de esta app
 * (lib/mcp/oauth.ts). El JWT lleva el user_id real de Supabase; el ejecutor SQL lo inyecta
 * en request.jwt.claims y el RLS hace el resto — el modelo ve exactamente las filas que
 * ve la sesión web de quien conectó el cliente, ni una más.
 *
 * Herramientas expuestas:
 *  - list_tenants: subcuentas visibles para el usuario.
 *  - query_db: SQL read-only (SELECT/WITH) con límite de filas y timeout.
 *  - describe_table: columnas de una tabla (information_schema) para autocompletar consultas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { validarAccessToken } from '@/lib/mcp/oauth'
import { leerCanal, leerFiltros, sqlAgendas, sqlConversaciones, sqlVentas } from '@/lib/mcp/consultas'
import { documentoDeContacto, resultadosDeBusqueda, sqlBuscar, sqlFetch } from '@/lib/mcp/busqueda'
import { ejecutarSqlMcp } from '@/lib/mcp/sql-executor'

const PROTOCOL_VERSION = '2025-06-18'
// Versiones que sabemos servir. Se responde con la que pide el cliente si la soporta (la especificación manda
// negociar): ChatGPT y otros clientes piden la 2025-03-26 o la 2024-11-05 y rechazan una respuesta distinta.
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const INSTRUCCIONES =
  'Datos de GrowthOps en SOLO LECTURA. Cada usuario ve únicamente su subcuenta y lo que su rol permite; solo el super administrador ve todas. Usa search/fetch para contactos, y list_tenants, describe_table y query_db (SQL SELECT) para el resto.'
const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const MCP_JWT_SECRET = () => process.env.MCP_JWT_SECRET
const JSON_RPC_HEADERS = {
  'Content-Type': 'application/json',
  'MCP-Protocol-Version': PROTOCOL_VERSION,
}

function jsonRpc(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}
/** Fallo de una HERRAMIENTA: va como resultado con isError (el modelo lo lee y se corrige), no como error de protocolo. */
function errorDeHerramienta(id: unknown, texto: string) {
  return NextResponse.json(jsonRpc(id, { content: [{ type: 'text', text: texto }], isError: true }), {
    headers: JSON_RPC_HEADERS,
  })
}
function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

type RpcBody = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }

/**
 * Desafío `WWW-Authenticate` de un recurso protegido MCP. La especificación (2025-06-18, RFC 9728)
 * exige apuntar al documento de metadatos del recurso con `resource_metadata`: es lo que permite al
 * cliente descubrir el servidor de autorización sin adivinar rutas.
 */
function desafioBearer(request: { url: string }, error?: 'invalid_token'): string {
  const origin = new URL(request.url).origin
  const partes = ['realm="mcp"', `resource_metadata="${origin}/.well-known/oauth-protected-resource"`]
  if (error) partes.push(`error="${error}"`)
  return `Bearer ${partes.join(', ')}`
}

async function autenticar(
  request: NextRequest
): Promise<{ userId: string; email: string; clientId: string } | NextResponse> {
  const secret = MCP_JWT_SECRET()
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      { error: 'Servidor MCP sin MCP_JWT_SECRET configurado. Configúralo en Vercel (≥32 caracteres).' },
      { status: 503 }
    )
  }
  const header = request.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Falta el Bearer token. Conecta el cliente MCP vía OAuth en /api/mcp/oauth/authorize.' },
      { status: 401, headers: { 'WWW-Authenticate': desafioBearer(request) } }
    )
  }
  // Validación canónica única (lib/mcp/oauth.ts): firma + hash del token presente en BD y no revocado.
  // Comprobar contra BD es lo que permite revocar sesiones sin esperar a que caduque el token.
  const sesion = await validarAccessToken(header.slice(7).trim())
  if (!sesion) {
    return NextResponse.json(
      { error: 'Token inválido, revocado o caducado' },
      { status: 401, headers: { 'WWW-Authenticate': desafioBearer(request, 'invalid_token') } }
    )
  }
  return sesion
}

async function handleInitialize(id: unknown, params?: Record<string, unknown>) {
  const pedida = typeof params?.protocolVersion === 'string' ? params.protocolVersion : ''
  const version = PROTOCOL_VERSIONS.includes(pedida) ? pedida : PROTOCOL_VERSION
  return NextResponse.json(
    jsonRpc(id, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'growth-ops-mcp', title: 'GrowthOps', version: '1.1.0' },
      instructions: INSTRUCCIONES,
    }),
    { headers: { ...JSON_RPC_HEADERS, 'MCP-Protocol-Version': version } }
  )
}

async function handleToolsList(id: unknown) {
  return NextResponse.json(
    jsonRpc(id, {
      tools: [
        {
          name: 'search',
          title: 'Buscar contactos',
          description:
            'Busca contactos por nombre, email, teléfono o Instagram. Devuelve hasta 15 resultados con id, título y enlace; usa fetch con el id para ver el detalle.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Texto a buscar (nombre, email, teléfono o usuario de Instagram).',
              },
            },
            required: ['query'],
            additionalProperties: false,
          },
          annotations: { title: 'Buscar contactos', ...SOLO_LECTURA },
        },
        {
          name: 'fetch',
          title: 'Ver un contacto',
          description:
            'Devuelve el detalle de un contacto (datos y citas) a partir del id que dio search, con el formato contact:<uuid>.',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Id devuelto por search, p. ej. contact:3f2a…' } },
            required: ['id'],
            additionalProperties: false,
          },
          annotations: { title: 'Ver un contacto', ...SOLO_LECTURA },
        },
        {
          name: 'list_appointments',
          title: 'Listar agendas',
          description:
            'Lista agendas/citas (las más recientes primero) con contacto, closer, setter, estado, resultado y origen. Filtra por fechas (día UTC) y estado. Solo las que el usuario puede ver.',
          inputSchema: {
            type: 'object',
            properties: {
              desde: { type: 'string', description: 'Fecha inicial AAAA-MM-DD (opcional).' },
              hasta: { type: 'string', description: 'Fecha final AAAA-MM-DD, inclusive (opcional).' },
              estado: { type: 'string', description: 'Filtra por estado exacto, p. ej. scheduled (opcional).' },
              limite: { type: 'number', description: 'Máximo de filas, 1-100 (por defecto 50).' },
            },
            additionalProperties: false,
          },
          annotations: { title: 'Listar agendas', ...SOLO_LECTURA },
        },
        {
          name: 'list_sales',
          title: 'Listar ventas',
          description:
            'Lista ventas (las más recientes primero). gross_amount es lo pactado, NO lo cobrado, y una reserva sin completar (reservation_completed_at nulo) no cuenta como venta: no sumes sin tenerlo en cuenta. Para cobros usa query_db sobre collections.',
          inputSchema: {
            type: 'object',
            properties: {
              desde: { type: 'string', description: 'Fecha inicial AAAA-MM-DD (opcional).' },
              hasta: { type: 'string', description: 'Fecha final AAAA-MM-DD, inclusive (opcional).' },
              estado: { type: 'string', description: 'Filtra por estado exacto, p. ej. scheduled (opcional).' },
              limite: { type: 'number', description: 'Máximo de filas, 1-100 (por defecto 50).' },
            },
            additionalProperties: false,
          },
          annotations: { title: 'Listar ventas', ...SOLO_LECTURA },
        },
        {
          name: 'list_conversations',
          title: 'Listar conversaciones',
          description:
            'Lista conversaciones de la bandeja (más recientes primero): canal, estado, modo de IA, etiquetas, contacto y responsable. NO incluye los mensajes. Filtra por fechas (día UTC), estado (abierta, pendiente, aplazada, resuelta) y canal.',
          inputSchema: {
            type: 'object',
            properties: {
              desde: { type: 'string', description: 'Fecha inicial AAAA-MM-DD (opcional).' },
              hasta: { type: 'string', description: 'Fecha final AAAA-MM-DD, inclusive (opcional).' },
              estado: { type: 'string', description: 'abierta, pendiente, aplazada o resuelta (opcional).' },
              canal: { type: 'string', description: 'p. ej. instagram, facebook, whatsapp (opcional).' },
              limite: { type: 'number', description: 'Máximo de filas, 1-100 (por defecto 50).' },
            },
            additionalProperties: false,
          },
          annotations: { title: 'Listar conversaciones', ...SOLO_LECTURA },
        },
        {
          name: 'list_tenants',
          title: 'Listar subcuentas',
          description:
            'Lista las subcuentas (tenants) visibles para el usuario que autorizó esta conexión MCP. Devuelve id, slug, nombre y estado.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { title: 'Listar subcuentas', ...SOLO_LECTURA },
        },
        {
          name: 'query_db',
          title: 'Consulta SQL de solo lectura',
          description:
            'Ejecuta una consulta SQL de SOLO LECTURA (SELECT o WITH) sobre la base de datos de la app, con el aislamiento por subcuenta del usuario. Máximo 500 filas y 8 segundos por consulta. Las tablas principales: tenants, users, contacts, appointments, sales, collections, payment_plans, refunds, commissions, campaigns, contact_attributions, canonical_events, funnels, contracts, integration_sync_runs, stripe_payments.',
          inputSchema: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: 'Consulta SQL de solo lectura. Una sola sentencia.' },
            },
            required: ['sql'],
            additionalProperties: false,
          },
          annotations: { title: 'Consulta SQL de solo lectura', ...SOLO_LECTURA },
        },
        {
          name: 'describe_table',
          title: 'Columnas de una tabla',
          description: 'Devuelve las columnas de una tabla pública (nombre, tipo, nulo) para saber qué consultar.',
          inputSchema: {
            type: 'object',
            properties: { table: { type: 'string', description: 'Nombre exacto de la tabla' } },
            required: ['table'],
            additionalProperties: false,
          },
          annotations: { title: 'Columnas de una tabla', ...SOLO_LECTURA },
        },
      ],
    }),
    { headers: JSON_RPC_HEADERS }
  )
}

async function handleToolCall(
  id: unknown,
  name: unknown,
  args: Record<string, unknown>,
  userId: string,
  email: string,
  origen: string
) {
  if (name === 'list_conversations') {
    const f = leerFiltros(args)
    if (!f.ok) return errorDeHerramienta(id, f.error)
    const c = leerCanal(args)
    if (!c.ok) return errorDeHerramienta(id, c.error)
    const r = await ejecutarSqlMcp(sqlConversaciones(f.filtros, c.canal), {
      userId,
      email,
      clientId: 'list_conversations',
    })
    if (!r.ok) return errorDeHerramienta(id, r.error)
    return NextResponse.json(
      jsonRpc(id, {
        content: [
          { type: 'text', text: r.rows.length ? JSON.stringify(r.rows, null, 2) : 'Sin filas.' },
          { type: 'text', text: `— ${r.rowCount} filas en ${r.durationMs} ms` },
        ],
      }),
      { headers: JSON_RPC_HEADERS }
    )
  }

  if (name === 'list_appointments' || name === 'list_sales') {
    const f = leerFiltros(args)
    if (!f.ok) return errorDeHerramienta(id, f.error)
    const sqlText = name === 'list_appointments' ? sqlAgendas(f.filtros) : sqlVentas(f.filtros)
    const r = await ejecutarSqlMcp(sqlText, { userId, email, clientId: String(name) })
    if (!r.ok) return errorDeHerramienta(id, r.error)
    const meta = `— ${r.rowCount} filas en ${r.durationMs} ms`
    return NextResponse.json(
      jsonRpc(id, {
        content: [
          { type: 'text', text: r.rows.length ? JSON.stringify(r.rows, null, 2) : 'Sin filas.' },
          { type: 'text', text: meta },
        ],
      }),
      { headers: JSON_RPC_HEADERS }
    )
  }

  if (name === 'search') {
    const sqlText = sqlBuscar(String(args.query ?? ''))
    if (!sqlText) return errorDeHerramienta(id, 'Indica un texto para buscar')
    const r = await ejecutarSqlMcp(sqlText, { userId, email, clientId: 'search' })
    if (!r.ok) return errorDeHerramienta(id, r.error)
    const cuerpo = resultadosDeBusqueda(r.rows as never, origen)
    return NextResponse.json(jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(cuerpo) }] }), {
      headers: JSON_RPC_HEADERS,
    })
  }

  if (name === 'fetch') {
    const q = sqlFetch(String(args.id ?? ''))
    if (!q) return errorDeHerramienta(id, 'Id no válido: usa el que devolvió search (contact:<uuid>)')
    const r = await ejecutarSqlMcp(q.sql, { userId, email, clientId: 'fetch' })
    if (!r.ok) return errorDeHerramienta(id, r.error)
    // Sin fila = no existe o no tienes permiso: no se distingue, para no revelar contactos de otras subcuentas.
    if (r.rows.length === 0) return errorDeHerramienta(id, 'No encontrado')
    const doc = documentoDeContacto(r.rows[0] as never, origen)
    return NextResponse.json(jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(doc) }] }), {
      headers: JSON_RPC_HEADERS,
    })
  }

  if (name === 'list_tenants') {
    const result = await ejecutarSqlMcp('select id, slug, name, status, created_at from tenants order by name', {
      userId,
      email,
      clientId: 'list_tenants',
    })
    if (!result.ok) return errorDeHerramienta(id, result.error)
    return NextResponse.json(jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] }), {
      headers: JSON_RPC_HEADERS,
    })
  }

  if (name === 'describe_table') {
    const table = String(args.table ?? '')
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) {
      return errorDeHerramienta(id, 'Nombre de tabla inválido')
    }
    const result = await ejecutarSqlMcp(
      `select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='${table}' order by ordinal_position`,
      { userId, email, clientId: 'describe_table' }
    )
    if (!result.ok) return errorDeHerramienta(id, result.error)
    if (result.rowCount === 0) {
      return NextResponse.json(jsonRpc(id, { content: [{ type: 'text', text: `Tabla desconocida: ${table}` }] }), {
        headers: JSON_RPC_HEADERS,
      })
    }
    return NextResponse.json(jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] }), {
      headers: JSON_RPC_HEADERS,
    })
  }

  if (name === 'query_db') {
    const sqlText = String(args.sql ?? '')
    const result = await ejecutarSqlMcp(sqlText, { userId, email, clientId: 'query_db' })
    if (!result.ok) return errorDeHerramienta(id, result.error)
    const meta = `— ${result.rowCount} filas en ${result.durationMs} ms${result.truncated ? ' (TRUNCADO a 500: afina el filtro o añade LIMIT)' : ''}`
    return NextResponse.json(
      jsonRpc(id, {
        content: [
          { type: 'text', text: result.rows.length ? JSON.stringify(result.rows, null, 2) : 'Sin filas.' },
          { type: 'text', text: meta },
        ],
      }),
      { headers: JSON_RPC_HEADERS }
    )
  }

  return NextResponse.json(jsonRpcError(id, -32602, `Herramienta desconocida: ${String(name)}`), {
    headers: JSON_RPC_HEADERS,
  })
}

export async function POST(request: NextRequest) {
  // Detección de sesión activa para degradar con 401 accionable (no para autorizar: quien
  // decide es el Bearer token MCP).
  let body: RpcBody
  try {
    body = (await request.json()) as RpcBody
  } catch {
    return NextResponse.json(jsonRpcError(null, -32700, 'JSON inválido'), { status: 400 })
  }
  const id = body.id ?? null
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return NextResponse.json(jsonRpcError(id, -32600, 'Petición JSON-RPC inválida'), { status: 400 })
  }

  const auth = await autenticar(request)
  if (auth instanceof NextResponse) return auth
  const { userId, email } = auth

  switch (body.method) {
    case 'initialize':
      return handleInitialize(id, body.params)
    case 'notifications/initialized':
      return new NextResponse(null, { status: 202 })
    case 'tools/list':
      return handleToolsList(id)
    case 'tools/call':
      return handleToolCall(
        id,
        body.params?.name,
        (body.params?.arguments as Record<string, unknown>) ?? {},
        userId,
        email,
        new URL(request.url).origin
      )
    case 'ping':
      return NextResponse.json(jsonRpc(id, {}), { headers: JSON_RPC_HEADERS })
    default:
      // Toda notificación (mensaje sin respuesta, p. ej. `notifications/cancelled`) se acepta con 202:
      // contestarle un error HTTP a una notificación hace que algunos clientes marquen la conexión caída.
      if (body.method.startsWith('notifications/')) return new NextResponse(null, { status: 202 })
      return NextResponse.json(jsonRpcError(id, -32601, `Método no soportado: ${body.method}`), {
        status: 404,
        headers: JSON_RPC_HEADERS,
      })
  }
}

export async function GET(request: NextRequest) {
  // Transporte streamable HTTP (2025-06-18): un GET con `Accept: text/event-stream` pide el canal SSE
  // del servidor. Este servidor es sin estado y no lo ofrece, y la especificación manda responder 405
  // en ese caso. Antes devolvía 200 con JSON, que los clientes intentaban leer como un flujo SSE.
  if ((request.headers.get('accept') || '').includes('text/event-stream')) {
    return new NextResponse(null, { status: 405, headers: { Allow: 'POST, DELETE, OPTIONS' } })
  }
  // Para personas y comprobaciones: un GET normal informa de cómo conectarse y nunca expone nada.
  return NextResponse.json(
    {
      server: 'growth-ops-mcp',
      transport: 'streamable-http',
      endpoints: {
        mcp: 'POST /api/mcp',
        oauth: '/api/mcp/oauth/*',
        discovery: '/.well-known/oauth-protected-resource',
      },
      note: 'Autentícate vía OAuth 2.1 y envía JSON-RPC por POST con el Bearer token.',
    },
    { headers: JSON_RPC_HEADERS }
  )
}

// Cierre de sesión del cliente. El servidor es sin estado (no emite `Mcp-Session-Id`), así que no hay
// nada que cerrar: se responde 204 en vez de 405 para que el cliente se desconecte sin error.
export async function DELETE() {
  return new NextResponse(null, { status: 204 })
}

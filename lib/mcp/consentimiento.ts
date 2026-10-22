// HTML de la pantalla de consentimiento del MCP (puro y probable). TODO lo que viene del registro dinámico o de la
// query se escapa: el nombre del cliente lo elige quien lo registra y los parámetros los controla quien construye el enlace.

const PAGE_STYLES = `
  body{font-family:system-ui,sans-serif;background:#0b1120;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:32px;max-width:440px}
  h1{font-size:18px;margin:0 0 8px} p{color:#94a3b8;font-size:14px;line-height:1.6}
  code{background:#0b1120;padding:2px 6px;border-radius:4px;font-size:12px;color:#7dd3fc;word-break:break-all}
  form{display:flex;gap:12px;margin-top:24px}
  button{flex:1;padding:10px;border-radius:8px;border:1px solid #334155;cursor:pointer;font-size:14px}
  .si{background:#2563eb;color:white;border-color:#2563eb} .no{background:transparent;color:#94a3b8}
`

const CAMPOS_OAUTH = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'state',
]

function escaparHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hostDeRedirect(uri: string | null): string {
  try {
    return uri ? new URL(uri).host : 'desconocido'
  } catch {
    return 'desconocido'
  }
}

export function htmlConsentimiento(opts: {
  clientName: string
  clientId: string
  params: URLSearchParams
  error?: string
  superAdmin?: boolean
}) {
  const { clientName, clientId, params, error, superAdmin } = opts
  // El nombre lo elige quien registra el cliente (cualquiera puede llamarse «ChatGPT»): el dominio al que se
  // devolverá el código es lo único que no se puede falsear, así que se muestra.
  // Todo lo que viene del registro dinámico o de la query se escapa antes de entrar al HTML (antes el nombre del
  // cliente, el error y los nombres de parámetros se pegaban tal cual: XSS en el origen de la app).
  const nombre = escaparHtml(clientName)
  const idCorto = escaparHtml(clientId.slice(0, 24))
  const mensajeError = error ? escaparHtml(error) : ''
  const destino = escaparHtml(hostDeRedirect(params.get('redirect_uri')))
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autorizar acceso MCP</title><style>${PAGE_STYLES}</style></head><body><div class="card">
<h1>${error ? 'No se pudo autorizar' : `¿Autorizar acceso a «${nombre}»?`}</h1>
${
  error
    ? `<p>${mensajeError}</p>`
    : `<p><strong>${nombre}</strong> (<code>${idCorto}…</code>) pide acceso de <strong>solo lectura</strong> ${
        superAdmin
          ? 'a los datos de TODAS las subcuentas (eres super administrador): contactos, ventas, cobros, citas, campañas y métricas.'
          : 'únicamente a los datos de TU subcuenta y solo los que tu rol puede ver en la app (contactos, ventas, cobros, citas, campañas y métricas). Nunca verá otras subcuentas.'
      }</p>
<p>Tras autorizar volverás a <code>${destino}</code>. Si no reconoces ese dominio, pulsa Denegar.</p>
<p>No podrá modificar, borrar ni exportar nada que tu sesión no alcance. Puedes revocar el acceso en cualquier momento desde Configuración.</p>`
}
<form method="POST" action="/api/mcp/oauth/authorize">
${[...params.entries()]
  .filter(([k]) => CAMPOS_OAUTH.includes(k))
  .map(([k, v]) => `<input type="hidden" name="${escaparHtml(k)}" value="${escaparHtml(v)}">`)
  .join('\n')}
${error ? '' : '<button class="si" type="submit" name="approve" value="1">Autorizar</button><button class="no" type="submit" name="approve" value="0">Denegar</button>'}
</form></div></body></html>`
  return html
}

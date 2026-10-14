// Forma con SUFIJO DE RUTA del documento de metadatos: para el recurso `https://host/api/mcp`, los
// clientes MCP piden primero `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728 / RFC 8414 §3) y
// solo después la raíz. Devuelve exactamente lo mismo que la ruta raíz.
export { GET } from '../../route'

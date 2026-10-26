# Servidor MCP propio de la app

Servidor MCP (Model Context Protocol) integrado en la propia aplicación Next.js para conectar
**ChatGPT** y **Claude** a los datos de la app. El modelo responde cualquier pregunta sobre los
datos con SQL de **solo lectura**, bajo el **mismo aislamiento por subcuenta (RLS)** que tu sesión
web. No existe ninguna vía de escritura.

## Arquitectura

| Pieza        | Ruta / fichero                                                                      | Función                                                                  |
| ------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Endpoint MCP | `app/api/mcp/route.ts`                                                              | JSON-RPC 2.0 por HTTP (`initialize`, `tools/list`, `tools/call`, `ping`) |
| OAuth 2.1    | `app/api/mcp/oauth/*` + `lib/mcp/oauth.ts`                                          | authorization_code + PKCE S256, refresh rotativo, registro dinámico      |
| Discovery    | `/.well-known/oauth-protected-resource` y `/.well-known/oauth-authorization-server` | RFC 9728 / RFC 8414                                                      |
| Ejecutor SQL | `lib/mcp/sql-executor.ts`                                                           | read-only, RLS, timeout 8 s, máx. 500 filas                              |
| Store OAuth  | `lib/mcp/store.ts`                                                                  | clientes, códigos y tokens en Supabase (hashes SHA-256, nunca claro)     |
| Migración    | `supabase/migrations/20261009160000_mcp_server_oauth_and_reader.sql`                | rol `mcp_reader` + tablas `mcp_oauth_*`                                  |

## Conexión desde ChatGPT

1. Configuración → Aplicaciones → Configuración avanzada → activa el modo desarrollador.
2. Aplicaciones → Crear → nombre **GrowthOps**.
3. URL: `https://app.scalixsystems.com/api/mcp`; autenticación: **OAuth**.
4. Pulsa **Analizar herramientas**. ChatGPT descubre el servidor vía `/.well-known`, registra un
   cliente en `/api/mcp/oauth/register` y abre `/api/mcp/oauth/authorize`.
5. Inicia sesión en la app si no lo estás, pulsa **Autorizar** y termina con **Crear**.

La disponibilidad de aplicaciones MCP y el modo desarrollador depende del plan y los permisos del
workspace de ChatGPT.

## Conexión desde Claude (Custom Connector)

1. Claude → Settings → Connectors → **Add custom connector**.
2. URL: `https://app.scalixsystems.com/api/mcp`
3. Autenticación OAuth — mismo flujo que ChatGPT.

## Tokens y secretos

El usuario **no crea ni pega ningún token**. ChatGPT, Claude o el cliente compatible realiza el
registro dinámico y el flujo OAuth 2.1 con PKCE; el servidor entrega access token y refresh token
al cliente y los rota automáticamente. La pantalla Configuración → Conexiones IA (MCP) solo muestra
estado y revocación, nunca secretos.

La metadata anuncia `read offline_access`: `read` limita el servidor a lectura y `offline_access`
permite que clientes como ChatGPT renueven la sesión sin pedir autorización cada 15 minutos.

## Qué ve el modelo

Tres herramientas, todas de lectura:

- `list_tenants` — subcuentas visibles para el usuario que autorizó.
- `query_db` — SQL libre `SELECT`/`WITH` (una sentencia, máx. 20.000 caracteres, 500 filas, 8 s).
- `describe_table` — columnas de una tabla para saber qué consultar.

El aislamiento es el mismo del resto de la app: el access token lleva el `sub` real del usuario;
el ejecutor lo inyecta en `request.jwt.claims` y las policies RLS (`auth_tenant_ids`,
`is_super_admin`) filtran cada fila. Un usuario que solo pertenece a la subcuenta A no puede leer
ni una fila de la B, aunque el prompt lo pida.

## Seguridad por capas

1. **Rol `mcp_reader`** (Postgres, `NOLOGIN`): solo `GRANT SELECT` sobre tablas de negocio
   explícitas. Sin acceso a las tablas OAuth ni a las funciones de auth.
2. **Transacción `READ ONLY`**: cualquier escritura (incluso vía CTE o función) revienta.
3. **PKCE S256 obligatorio** y códigos de un solo uso de 60 s (canje atómico por `used_at`).
4. **Tokens cortos**: access 15 min (JWT HS256, revocable por `jti` en BD), refresh 30 días con
   **rotación**: reutilizar un refresh revoca la sesión.
5. **Consentimiento con sesión**: la aprobación exige sesión Supabase y fija `owner_user_id`;
   un cliente registrado dinámicamente no lee nada hasta que el usuario lo aprueba.
6. **Hashes**: códigos, tokens y client secrets se guardan solo como SHA-256.
7. **Sin reflexión de errores SQL** con datos: el mensaje de Postgres se trunca a 500 caracteres.

## Variables de entorno

| Variable         | Dónde          | Descripción                                                                                                |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| `MCP_JWT_SECRET` | Vercel + local | Secreto HS256, **≥32 caracteres**. Sin él, el servidor responde 503 (fail-closed).                         |
| `POSTGRES_URL`   | ya existente   | Conexión del ejecutor (rol de la conexión: `postgres`; la elevación la limita `mcp_reader` vía `SET ROLE`) |

> **Nota sobre el rol de conexión:** el ejecutor usa `SET LOCAL ROLE mcp_reader` dentro de la
> transacción para que los privileges SELECT sean los del rol lector y no los del propietario.

## Revoke

Los tokens de 15 min mueren solos; el refresh a los 30 días. Para revocar YA, borra el cliente o
sus filas de `mcp_oauth_tokens` (el usuario dueño puede hacerlo por RLS con su sesión).

## Alcance de los datos por usuario

El MCP nunca usa un rol propio con más visibilidad: ejecuta con las claims del usuario que autorizó y el rol
`mcp_reader` (sin `BYPASSRLS`), así que ve exactamente lo que vería en la app.

- **Super administrador**: todas las subcuentas.
- **Resto de usuarios**: solo su(s) subcuenta(s) y solo las filas que su rol puede leer (mismas políticas RLS que la web).

La pantalla de consentimiento muestra cuál de los dos alcances tendrá la conexión. Verificado en producción con un
usuario `member` (1 subcuenta, 1 contacto, 0 ventas) frente al super admin (4 subcuentas, 900 contactos, 51 ventas).

## Errores «Bad Request» al conectar (corregidos)

- El POST del consentimiento redirigía con 307 (conserva el método) y el navegador reenviaba el POST al callback de
  ChatGPT/Claude: ahora es **303**.
- El canje de código ignoraba `Authorization: Basic` (`client_secret_basic`): ahora se acepta y se anuncia.
- El registro rechazaba `http://localhost:…` (Claude Code, Inspector): ahora se admite http solo en loopback.

## Compatibilidad con ChatGPT (apps)

- **Negociación de versión**: se responde con la versión de protocolo que pide el cliente (2025-06-18, 2025-03-26 o
  2024-11-05); ChatGPT rechaza una respuesta distinta de la que pidió.
- **Anotaciones**: las 5 herramientas llevan `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.
  Sin ellas ChatGPT las trata como posibles escrituras.
- **`search` y `fetch`**: el par que ChatGPT espera para buscar/listar. Buscan contactos (nombre, email, teléfono,
  Instagram) y devuelven el detalle con sus citas; ids `contact:<uuid>`. Pasan por el mismo RLS del usuario: «no
  encontrado» no distingue entre «no existe» y «no tienes permiso».
- **Errores de herramienta** como resultado con `isError: true` (el modelo los lee y se corrige), no como error de protocolo.
- El servidor sigue siendo **solo lectura**: ChatGPT no puede crear ni modificar nada.

## Listados de agendas y ventas

- `list_appointments` y `list_sales`: filtran por `desde`/`hasta` (AAAA-MM-DD), `estado` y `limite` (1-100, 50 por defecto).
  Argumentos validados en `lib/mcp/consultas.ts`; el SQL devuelve columnas acotadas (sin transcripciones, análisis de IA,
  payloads, comprobantes ni documentos del alumno) y pasa por el RLS del usuario.
- **Dinero** (`docs/MONEY.md`): no calculan totales. `gross_amount` es lo pactado, no lo cobrado; una reserva sin completar
  (`reservation_completed_at` nulo) no es venta (D8). Para cobros, `query_db` sobre `collections`.
- Verificado en producción con RLS: un usuario `member` ve 1 cita de 1 subcuenta y 0 ventas; el super admin ve todas.
- Pendiente: un `list_conversations` necesita `GRANT SELECT` de `mcp_reader` sobre `conversations` (migración nueva,
  tabla fuera de la whitelist actual).

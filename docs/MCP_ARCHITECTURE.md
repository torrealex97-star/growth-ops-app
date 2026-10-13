# SPEC-11 — Secure Multi-Tenant MCP Gateway · Auditoría y línea base (PR-0)
13-oct-2026 · Buffy · rama `feat/spec11-pr0-mcp-audit` sobre `origin/main` (`b71dcf55`)

Especificación: SPEC-11. **Un servidor MCP YA existe, completo y documentado** ([mcp-server.md](mcp-server.md) +
2 migraciones de octubre). La spec dice «no implementar un segundo servidor si ya existe uno
equivalente y seguro» — se descarta construir otro: el delta es adaptar las HERRAMIENTAS del que hay
(SQL libre read-only) al catálogo canónico de la SPEC-11, respect有多大 las decisiones ya tomadas.

Clasificación: VERIFICADO (fichero/línea), INSPECCIONADO (parcial), PROBADO (test). Sin pruebas de
cliente en la sesión (eso exige sesión real de ChatGPT/Claude — PR-10).

## 1. Qué existe (VERIFICADO — cimentación sólida)

| Requisito de la SPEC-11 | Implementación actual | Estado |
|---|---|---|
| Servidor MCP remoto | `app/api/mcp/route.ts`: JSON-RPC 2.0 HTTP streamable, protocolo `2025-06-18`, `initialize`/`tools/list`/`tools/call`/`ping` | VERIFICADO |
| Transporte | mismo fichero: timeout, errores JSON-RPC estructurados, sin autenticación por query params | VERIFICADO |
| OAuth 2.1 | `lib/mcp/oauth.ts` + `app/api/mcp/oauth/*`: authorization_code + PKCE S256 obligatorio, registro dinámico (RFC 7591), códigos 60 s de UN solo uso con canje atómico (`used_at`), tokens access 15 min HS256 con `jti` revocable en BD, refresh 30 d con ROTACIÓN (reuso revoca la sesión), state y redirect_uri validados | VERIFICADO |
| Discovery | `/.well-known/oauth-protected-resource` (RFC 9728) y `/.well-known/oauth-authorization-server` (RFC 8414) | VERIFICADO |
| Tenant isolation | El JWT lleva el `sub` real del usuario; el ejecutor lo inyecta en `request.jwt.claims` y RLS limita cada fila a las subcuentas del usuario — el modelo ve exactamente lo que ve su sesión web | VERIFICADO |
| Límites de datos | `lib/mcp/sql-executor.ts`: rol `mcp_reader` (NOLOGIN) con whitelist `GRANT SELECT`, transacción `READ ONLY`, 8 s timeout, máx 500 filas / 20.000 chars por sentencia, errores SQL truncados (sin reflexión con datos) | VERIFICADO |
| Catálogo sincronizado | Migración `20261010140000`: whitelist corregidota contra catálogo vivo (6 tablas retiradas por desaparecidas, `vsl_embed_locations` añadida) y EXCEPTION si la lista deriva — detección de deriva del esquema | VERIFICADO |
| Token storage | `lib/mcp/store.ts`: códigos/tokens/secretos solo como SHA-256; tablas `mcp_oauth_*` (migración `20261009160000`) | VERIFICADO |
| Revocación | acceso al revocar de sesiones por `jti` en BD — robusta: la validación canónica consulta la BD, la revocación es inmediata sin esperar caducidad | VERIFICADO |
| Consentimiento | pantalla de consentimiento exige sesión Supabase y fija `owner_user_id`; cliente dinámico no lee nada hasta aprobación | VERIFICADO |
| Documentación de conexión | `docs/mcp-server.md`: pasos reales para ChatGPT (Connectors) y Claude (custom connector) con URL y flujo | VERIFICADO (doc) |

## 2. Huecos (delta que la SPEC-11 exige)

- **H-1 — Las tools son SQL libre, no canónicas (VERIFICADO).** Hoy: `list_tenants`, `query_db`
  (SQL SELECT/WITH read-only) y `describe_table`. La SPEC-11 prohíbe SQL arbitrario (§1.6) y pide un
  catálogo tipado que consuma los servicios canónicos con la firma del §12 (periodo, moneda, modelo
  de atribución, `data_status`, `metric_version`). El SQL actual es SEGURO, pero no es el contrato
  pedido y no aporta el vocabulario del negocio: un cliente puede escribir SQL correcto con
  definiciones equivocadas (la métrica equivocada es un problema de precisión, no solo de acceso).
  PR-1+ crea las tools canónicas y marca `query_db` para deprecación (decisión documentada en la PR).
  **DECIDIDO (usuario, 13-oct-2026): degradar primero, retirar tras paridad.** PR-1–PR-4 construyen
  las tools canónicas con `query_db` marcada deprecada pero sirviendo (el SQL actual es seguro, y
  retirarlo antes de la paridad dejaría/connectaría los clientes a ciegas en los huecos sin tool);
  PR-5 la retira solo cuando ChatGPT y Claude funcionen con las canónicas probadas en sesión real
  (PR-10, H-6), y `describe_table`/`list_tenants` se adaptan al mismo catálogo.
- **H-2 — Sin scopes granulares ni permisos por tool (VERIFICADOS ausentes de código).** El scope
  viaja en el authorize pero la UI de consentimiento no presenta la separación finance/CRM del §9 ni
  el router comprueba que cada tool requiera su scope. Hoy el límite es del TOKEN (usuario completo
  con todos sus accesos de app). PR-4: mapear scopes ↔ roles ya existentes y bloquear en el router.
- **H-3 — Sin MCP audit log (VERIFICADO por ausencia de código MCP audit).** Las llamadas no dejan
  traza de Connection/tenant/usuario/tool/resultado (§19): una tabla de acceso MCP con retención. PR-9.
- **H-4 — Sin pantalla de conexiones con revocación (VERIFICADO por grep).** Los tokens son
  revocables en BD, pero no hay UI de «AI Connections» (Settings → Integrations) con workspace y revocación del §7/§18. PR-8.
  La revocación por jti ya existe en BD; la UI es una página, no una nueva capa.
- **H-5 — Sin rate limits por herramienta/conexion/tenant (VERIFICADO).** Los límites son solo de
  tamaño/timeout de SQL: no hay presupuestos por conexión, ni alertas de abuso, ni límites
  para proteger los dashboards de otros tenants (§20). PR-9.
- **H-6 — Sin test de compatibilidad frontal (REGLA de la spec: no declarar sin probarlo).** La
  documentación de conexión existe, pero la compatibilidad con clientes solo se declarará en
  PR-10 con sesiones reales; hoy es INSPECCIONADO.
- **H-7 — Cambio de workspace sin re-autorización (VERIFICADO por diseño).** La conexión actual no
  selecciona un workspace en el consentimiento: da acceso a TODAS las subcuentas del usuario vía
  RLS (list_tenants las lista). El §7 exige vinculación explícita por autorización. PR-4 añade la
  selección en el consentimiento y un alcance fijo por autorización. Hoy solo existe el acceso multi-subcuenta vía usuario completo con RLS; el binding fijo se decide en PR-2 como cambio de consentimiento, no como fallback.

## 3. Plan de fases (adaptado: solo delta)

| Fase | Cubre | Sobre qué existente |
|---|---|---|
| **PR-0** (este) | Auditoría y diseño | docs |
| PR-1 — Canonical Tool Adapter | Primeras 3-5 tools canónicas (ventas/cash/campañas) consumiendo lib/metrics + SPEC-07; cortesía de esquema data_status/metric_version | mismo servidor MCP |
| PR-2 — Auth & Scopes | Scopes granulares + binding workspace×autorización + consentimiento visible | oauth.ts + consent UI |
| PR-3 — Marketing/Funnels/VSL/Sales Tools | Catálogo de SPEC-07/08/09 convertido en tools MCP | adapters |
| PR-4 — Data Health & Person Tools | Tools de salud agregadas; Person restringido al rol autorizado y por ID, sin enumeración | data-health + timeline |
| PR-5 — Deprecación de query_db | Migrar a tools canónicas y retirar (o degradar) el SQL libre | sql-executor |
| PR-6 — Rate limits & Audit log | Limites por conexión + tablas de auditoría MCP | sql-executor pattern |
| PR-7 — UI AI Connections | Conexiones, consentimiento, revocación, reconexión | store revocación |
| PR-8 — Observabilidad | Métricas de herramientas, latencia, abuso | TurnUsage pattern |
| PR-9 — Security battery | 20 escenarios adversariales del §25 | tests |
| PR-10 — Compatibilidad real | ChatGPT + Claude + cliente de pruebas, con evidencia conectada de sesiones reales | docs actualizados |

## 4. Limitaciones

- La plataforma de datos (data_status, metric_version) que las tools MCP deben devolver
  depende de las PRs SPEC-04…09 abiertas; se consume al fusionarlas.
- No se probaron sesiones reales de ChatGPT/Claude en esta PR: la compatibilidad queda INSPECCIONADA
  hasta resolver PR-10 con evidencia de cliente real (regla §1.19 de la spec).
- Sin datos de producción en la sesión (credenciales borradas por higiene); los veredictos de tabla
  (`mcp_oauth_*`) se re-verifican en PR-2+ con pruebas de flujo local (mock/е2e).

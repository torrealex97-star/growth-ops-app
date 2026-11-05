# Plan de CodeReview — growth-ops-app

Objetivo: revisión práctica y por secciones de toda la app, para ir corrigiendo errores de forma estructurada. El plan se organiza por capas/ámbitos, no por ficheros aislados. Cada sección define qué inspeccionar, cómo verificar y con qué comprobación canónica.

Reglas de trabajo aplicables a esta revisión:

- Calidad: `npm run quality` (format:check + lint + typecheck + test + test:metrics). Añadir `npm run build` si toca rutas/páginas; `npm run dead-code` si añado o borro exports.
- Tests: solo mediante los scripts de `package.json` (`npm test`, `npm run test:metrics`, `npm run test:e2e`). No `node --test` directo.
- Multi-tenant: rutas `[tenant]/…`, RLS en Supabase, `tenant_id` obligatorio en consultas.
- Nada de datos, secretos o credenciales reales en commits (repo público, gitleaks en CI).
- `docs/plan/` guarda la ruta de trabajo; hasta que se publique este plan, `docs/ACTIVE_HANDOFF.md` guarda el estado en curso.

---

## Sección 0 — Arquitectura, stack e invariante multi-tenant

Objetivo: confirmar que la estructura y las reglas de isolación son coherentes y que ninguna nueva dependencia o capa rompe la invariante de tenant.

Qué inspeccionar:

- `package.json`: versiones de Next, React, TypeScript, Tailwind, Radix, Supabase, Sentry, certs de build y del cliente.
- `next.config.js`: output, imagetag, dynamic import, `standalone`/`outputStandalone`, `transpilePackages`, manejo de entorno.
- `vercel.json`, `wrangler.toml`-style (o `cloudflare.toml`): generación de build, buildCommand, installCommand, hooks, timeouts, releases.
- `tsconfig.json`: include/exclude, paths, `verbatimModuleSyntax`, `strict`, `noUncheckedIndexedAccess`.
- `lib/types/`: generados vs escritos a mano; cómo se consume `Database`.
- `components/ui/`: primitivas Radix + tokens de Tailwind; si cualquier pantalla hardcodes colores (especialmente fuera de la escala ya usada y del accent `accent: #2563EB`).
- `app/layout.tsx`, `app/global-error.tsx`, `app/globals.css`: estructura base, favicon, metas, fuentes, reset.
- Comandos de `package.json`: `format`, `lint`, `typecheck`, `test`, `test:metrics`, `build`, `dead-code`, `test:e2e`; y sus flags de runners (test runner nativo vs Playwright).
- `scripts/`: utilidades (setup E2E, limpieza, backfills, QA) — revisar que no contengan secrets y que se ejecuten de forma idempotente.
- `docs/` top-level y `docs/SECURITY_PRIVACY.md`: vigencia, enlaces rotos y que estén alineados.

Cómo verificar:

- `npm run typecheck` → 0 errores.
- `npm run format:check` y `npm run lint` → limpios.
- `npm run dead-code` → solo reportes informativos, ninguno nuevo introducido por el trabajo del plan.
- `npm run test` + `npm run test:metrics` → `npm run quality` entero en verde.
- `npm run build` si la sección toca rutas o configuración de build.

Hallazgos esperados (no bloqueantes, pero declarar):

- Clientes Supabase sin genérico `Database` (deuda técnica documentada): las queries no validan columnas; la revisión debe tener un punto de vigilancia de columnas fantasma.
- Reportes de `dead-code` son backlog informativo; no borrar nada solo por aparecer ahí.

---

## Sección 1 — Base de datos / Supabase: migraciones, RLS, tenant_id, constraints, índices

Objetivo: garantizar integridad de datos, aislamiento multi-tenant y migraciones reproducibles.

Qué inspeccionar:

- `supabase/migrations/`: orden cronológica, idempotencia, sin DDL destructivo sin PR aprobada.
- `supabase_migrations.schema_migrations`: registros, versiones en producción vs disco,gap de versiones.
- Tablas principales con `tenant_id`: `tenants`, `tenant_members`, `contacts`, `sales`, `appointments`, `campaigns`, `conversations`/`launches`, `payments`, `events` y cualquier otra con datos de subcuenta.
- Políticas RLS: `(select auth.uid())`, `(select auth.role())` o equivalente para InitPlan; cero grants a `authenticated`/`anon` sobre tablas de negocio; `EXCEPCIONES_SIN_TENANT` solo para datos globales de plataforma.
- Constraints: `NOT NULL`, `UNIQUE`, rangos de moneda, `CHECK` de fechas, UUID v4, estado finito (estados declarados en un diccionario, no texto libre).
- Índices: FK soportados, queries medidadas, sin índices innecesarios; búsqueda por `tenant_id` siempre presente.
- Funciones y RPCs: `SECURITY DEFINER` con `search_path` fijo, `WITH (security_invoker)` donde aplica, sin datos que vayan por defecto a usuarios no autorizados.
- Triggers, `GENERATED ALWAYS`/`BY DEFAULT`, secuencias, audit perfilado (`inserted_at`, `updated_at`, `created_by` según aplique).
- Restaurar/backup: configuración de snapshots (`pgss` o equivalente), magia de retention, respaldo de `schema_migrations`.
- Migraciones sin aplicar aún (sobre `main` o en etiquetas atrasadas del disco) vs ya en producción; registrar lo que falta en el plan/estado.

Cómo verificar:

- Dry-run obligatorio: `BEGIN … ROLLBACK` comprobando comportamiento (constraint rechaza lo que debe, único global, upsert idempotente, sin duplicar).
- Prueba de aislamiento OWNER / OTHER_TENANT / ANON contra un tenant sintético; 0 filas corruptas tras la prueba.
- `npm run test` incluyendo suites de integridad (invariante tenant, RLS, campos unicos, fechas UTC).
- Si añado una migración, registro la versión en `schema_migrations` con el mismo número que el fichero; no usar `supabase db push`.

Hallazgos que ya se dieron (y que este plan reitera):

- `supabase`/`postgres` no lanza: comprobar `{ error }` en todas las queries, incluidas lecturas y counts.
- Fechas "solo día": siempre con los helpers UTC de `lib/sales/plan-cuotas.ts`; nunca `new Date()` local + `toISOString()` ni `setMonth()`.
- Migraciones de producción que el repo aún no reproduce (ver `docs/ACTIVE_HANDOFF.md` o `PENDIENTES.md`).

---

## Sección 2 — API routes / servidores: validación de entrada, auth, tenant check, errores, idempotencia

Objetivo: nunca escribir datos sin validar, nunca devolver datos ajenos, nunca dejar una escritura a medias.

Qué inspeccionar:

- `app/api/[tenant]/evergreen/**`: `requireTenant()` correcto, provider service-role o anon según corresponda, scope de operación (`user`/`admin`/`guest`).
- `lib/auth/`: `requireTenant`, `getUser`, `requireUser`, `isSuperAdmin`, `isInTenant`, helpers de auditoría; `request_id` en rutas server; timeouts y `AbortSignal` en peticiones externas.
- Validación: `zod` (o equivalente) en entradas externas; `supercharge`/formidable en formularios; validación de tipo en BD para inputs que pasan por `any`.
- Errores: respuestas `{ error: { code, message, ...(debug?)} }` con código constante; nunca `500` genérico con stack trace expuesta; `401`/`403` diferenciados.
- Idempotencia: `idempotency_key` en escrituras críticas (pagos, reservas, webhooks, formularios); `INSERT … ON CONFLICT` o `UPSERT` controlado; sin claves compuestas que permitiesen duplicados.
- Webhooks: firma verificada, reintento con exponenciación, payload registrado, idempotencia por `event_id`/`objectId`; `plainText` o JSON bien formado; ningún webhook que mute estado sin auditar.
- Secreto y keys: `SUPABASE_SERVICE_ROLE_KEY` solo server; nunca en client bundles; keys de terceros en Vercel/Sites Secrets o `.env` local fuera de commits; rotación y rotation de claves.
- Archivos subidos / filas de base de datos: validación de tipo, size, MIME; denegar tipos peligrosos.
- Tiempos de espera: peticiones externas dentro de `maxDuration` (Vercel Hobby 60 s); truncado transparente con `fees_pendientes`/`truncated` si aplica; ledger que no se pierda.
- Redirects y `next.config`: `rewrites`/`redirects` de `[tenant]` sin leakage; absorber siempre `/_next` o `/_vercel` externos; prevenir path traversal.

Cómo verificar:

- Llamadas de cada ruta típica (GET/POST/PATCH/DELETE) con `curl` o Playwright, verificando código 200/401/403/404/422 y payload de error.
- Tres contingentes de tenant: propio, otro y anónimo; sin sesión, anon, user no miembro de ese tenant → 401/403.
- Reintento del webhook con mismo `id` → resultado idempotente (sin duplicados).
- `npm run build` si hay rutas nuevas o cambios de configuración.
- Revisión de cada función de modelo con `console.log` estructurado (o variante 법적인idad), sin dejar debug en producción.

---

## Sección 3 — Frontend: formularios, estados, accesibilidad, `next/image`, rutas `[tenant]`, estados de carga/empty/error

Objetivo: UI coherente, accesible, sin huecos de dato ni estados fantasma, y UI que no se rompa si una consulta falla.

Qué inspeccionar:

- Formularios: `react-hook-form` + `zod` (o equivalente); `defaultValues` inline vs estado persistente (reset por identidad que borra lo tecleado); validación sincrónica + asíncrona; mensajes de error vinculados al campo; `noValidate` en campos de foco.
- Estados de carga/error/empty: siempre renderizan un `Skeleton`/`EmptyState` con acción de reintento; nunca sumar parciales ni "0" cuando la fuente es ilegible. La propuesta de hueco ya está documentada: `pantallas-hueco-no-es-cero.test.mjs`.
- `next/image`: nómina `fill`/`layout`/`priority`; fuentes locales o `localConfiguration`; nunca `unoptimized` sin justificación; imágenes externas proxyadas.
- Rutas `[tenant]`: layout que resuelva `getUser()` y llame a `useTenant()` una sola vez; redirect de slug inválido a `/[tenant]/dashboard`; 404 por slug desconocido; no exponer `[tenant]` en la ruta de un tenant sin datos.
- Componentes UI: `components/ui/` como única fuente de primitivas; no duplicar botones/inputs/tabs en pantallas; tokens de color y contrastes (WCAG AA mínimo).
- Navegación y breadcrumbs: breadcrumbs coherente con el nombre de la sección, no solo slug; pestañas/panel de contextualización; "por dónde estoy?", "qué cambió?", "qué necesita atención?".
- Accesibilidad: `aria-label`/`aria-describedby` en formularios con errores; `role` correcto; keyboard completo en modales/drawers/tabs; focus trap; `lang` y `dir` correctos; contrastes reales de los tokens (no solo copia).
- Mobile: `useResizeObserver`/`useMediaQuery` en componentes sensibles a tamaño; tablas `overflow-x` solo cuando haga falta; no apretar horizontal.
- Servicios: `lib/supabase/client.ts` y `server.ts` con mismo flujo; `createClient` con `auth`, `global`, `query` timeout; null/errores manejados.
- Carga y "loading states": `Suspense`/`loading.tsx` para rutas; `not-found.tsx` por slug inválido.
- Sin "pending" sin fin: `isLoading`/`isFetching` bien tipados; no dejar `undefined` en `data` si el consumer espera un objeto.
- `next/image` y `next/link`: `priority` solo en first load; `fill` no en bg-only images.
- Evidencia de errores: `error.tsx` global, `error.tsx` por segment, `page.tsx` con `not-found.tsx` y `loading.tsx`.

Cómo verificar:

- Navegar por las 90+ rutas incluidas en el inventario de pantallas (o `find app \[tenant\] -name page.tsx`), priorizando dashboard, CRM, ventas, finanzas, configuración, captación, tests E2E.
- `npm run test` (incluye suites de calidad de UI/forms si existen) y `npm run test:e2e` en desarrollo.
- `npm run build` si toca rutas o pages.

---

## Sección 4 — Lógica de dominio: CRM, ventas, finanzas, marketing, IA, integraciones

Objetivo: mantener una sola fuente de verdad por operación, sin duplicación, sin deriva de valores, y sin que la IA o los conectores escriban datos que no ha visto.

Qué inspeccionar:

- Librerías separadas: `lib/CRM`, `lib/sales`, `lib/finanzas`, `lib/marketing`, `lib/ai`, `lib/integraciones` (ads, ghl, stripe, typeform, sequra, calendly, youtube, mcp, etc.).
- Premisas de negocio: estados finitos, reglas de comisión, ventanas de devolución, vencimientos, restricción de cobro, facturación, backfill por subcuenta.
- Modelos y almacen de datos: camino canónico (por ejemplo, `lib/<módulo>/<model>.ts` o equivalente), y usar ese camino para todas las consultas; no duplicar consultas a través de diferentes archivos.
- Idempotencia y claim atómico: backfills y escribe con `UPDATE … SET status='uploading' WHERE id=… AND status='pending'`, verificando el UPDATE posterior al efecto.
- IA: allowlist de modelos, límite diario per-user, ciclo de loopback de desarrollo; uso de `ANTHROPIC_API_KEY` en servidor; prompt allowlist y sanitización; no escribir en BD algo que no pudo leer (si falla, no aparecer "fuente ilegible + reintentar").
- Integraciones externas: timeout, errores, rate limits, reintentos e idempotencia; `webhooks` firmados; sin "pasar por alto" errores; eventos de audit en `audit_logs`.
- Números monetarios: `decimals`/`cents` apropiados; nunca `toFixed`/`parseFloat` para renderizado; `formatNumber`/`formatPercent` de `@/lib/utils`.
- Filtros y paginación: limites de página, orden, no `SELECT *`, no fetcheos inseq de listados; queries paginadas no bloquean al UI (indicador de más/carrousel).
- Reprocesos y "retry": si la función falla, no escribir nada si no se puede garantizar que el estado es consistente; tiempo de espera y truncation siempre con `truncated` + `fechas_pendientes`.
- Aislamiento de datos entre subcuentas: consultas con `tenant_id` por defecto, nunca `WHERE email` sin `tenant_id`.

Cómo verificar:

- Selección de un caso concreto (una venta, una comisión, un backfill) y ejecución desde el modelo al dato en BD; verificar que los datos en pantalla concuerdan con la base.
- `npm run test` sobre suites de negocio y de integración; `npm run test:metrics` si existen.
- Seguimiento de un campo clave (ej. `campaign_id`, `contact_id`, `tenant_id`) en tres puntos: escritura → BD → lectura en pantalla; resolver desvíos.

---

## Sección 5 — Infraestructura y operaciones

Objetivo: despliegue, configuración y operación reproducibles, sin secretos en el repo, sin dobles ejecuciones, sin crons que excedan su presupuesto.

Qué inspeccionar:

- `vercel.json` y `next.config.js`: buildStep, installCommand, buildCommand, functions, routes, headers, redirects, rewrites, securityHeaders, `ignoreCommand` (docs-only).
- Variables de entorno: la lista de `.env.local.example`; el `NEXT_PUBLIC_*` son clientes; el resto son server; `config` y `version` para feature flags; no hardcodear URLs de entorno; `APP_ORIGIN` para callbacks (nunca derive de `Host`).
- Crons: en `vercel.json` y GitHub Actions, cómo funcionan, cuándo, con qué `CRON_SECRET`, con budget dentro de `maxDuration` y sin doble ejecución.
- Observabilidad: `SENTRY_DSN` (solo server), `SENTRY_OVERRIDE_DSN`, capture de errores ambientales, web vitals, `X-Request-Id`, logs estructurados; `SENTRY_BUILD_CONFIG` si existe.
- Email y notificaciones: `RESEND_API_KEY` (recomendado) o equivalente; plantillas en `lib/emails/` o similar; no hardcodear URLs; remitente verifiable; failure paths con `NOTIFICATION_ERROR` etc.
- Backups: `pg_dump`/`r2` o equivalente, `SUPABASE_DATABASE_URL`, retention y verificación de integridad; snapshot en `schema_migrations`.
- Monitoreo: `SUPABASE_METRICS_URL` o equivalente; métricas y alertas; `SENTRY` configurado para ambiente.

Cómo verificar:

- `npm run build` local + `next build` (si está cara de configuración); revisar logs del build con output completo.
- Verificación de `vercel ls --prod` / `vercel inspect` sobre el proyecto; revisar deploy status, logs y `x-vercel-cache` (si aplica).
- `npm run quality` + `npm run build` + `npm run test` cuando modifiqué código de infraestructura.
- Revisión de `.gitignore` vs `.env*` y `*.pem`; `gitleaks` en PRs; `npm run lint` y `npm run typecheck`.

---

## Sección 6 — Seguridad y privacidad

Objetivo: negar acceso a datos ajenos, no dejar secrets en el repo, auditar y mejorar la privacidad.

Qué inspeccionar:

- `SECURITY.md` y `docs/SECURITY_PRIVACY.md`: vigencia, enlaces rotos, y que reflejen el estado actual.
- Políticas de acceso: RLS, `EXCEPCIONES_SIN_TENANT`, `SECURITY DEFINER`, `search_path` fijo. Revisar si alguna tabla concede `GRANT SELECT` a `authenticated`/`anon` sin whitelist explícito.
- Credenciales y secrets:Ninguna key, token, password, o valor sensible en `*.ts`, `*.tsx`, `*.js`, `*.json`, `*.md` o `docs/`; la exposición en `vercel.json`/`wrangler.toml` remota, no en el repo.
- Validación de sesión y rol: `getUser()` vs `requireUser()` vs `isSuperAdmin()`; `isSameOriginRequest` en mutaciones; nunca confiar en `req.headers` para identificar tenant.
- Auditoría: `audit_logs` creando `event_name`, `tenant_id`, `user_id`, `payload` y `ip` (si aplica) para operaciones sensibles; `action` fijo, `entity_type` y `entity_id` bien tipados.
- Privacidad: `erase_person`, `anonymize_tenant`, `opt_out`, `consent` y `NOTICE_PERSONA` (si aplica); minimización de payload; `select()` proyectado no `SELECT *`.
- Filtros CSS/HTML, CSP y headers de seguridad (si usan `next.config` o `vercel.json`) — sin explicación en el código, solo en docs y por que el negocio lo aprueba.
- Contraseñas y "gestión": rotación de `CONFIG_ENC_KEY`, `RESEND_API_KEY` y `CRON_SECRET` en Secrets del hosting, no en `.env`.
- "Esquemas": `SUPABASE_PASSWORD` y `SUPABASE_URL`/`DATABASE_URL`; no almacenar en variables de entorno por defecto; `initOpenNextCloudflareForDev` para desarrollo local.

Cómo verificar:

- `gitleaks` en todos los commits (incluido histórico) y en PRs; `npm run quality` incluye gitleaks.
- `information_schema` verificando grants en `contacts`, `sales`, `appointments`, `campaigns` y `conversations` → 0 grants a `authenticated`/`anon`.
- Escaneo con `npm run test` (incluye suites de auditoría y seguridad en el arnés) y `npm run test:e2e` con dos cuentas.
- Revisión de logs de `SENTRY` y `pg_stat_statements` para detectar queries lentas o que filtran datos (pero no en la sección actual).
- `README` y `AGENTS.md`/`CLAUDE.md` actualizados con un puntero a este plan.

---

## Sección 7 — Tests: ejecutar `npm run quality` y revisar fallos por fichero; `npm run test:e2e` en desarrollo

Objetivo: no confiar en que "pasan todos"; revisar cíclicamente y dejar la suite indicando qué probó y qué no.

Qué inspeccionar:

- `tests/`: suites por fichero; ejemplos: `tests/funnels/*.test.mjs`, `tests/meta/*.test.mjs`, `tests/panel-*.test.mjs`, `tests/formularios-...test.mjs`, etc.
- `tests/register.mjs`: setup de cargador, antes de cada suite de pruebas (`before`/`beforeEach`); no decorar el entorno con variables globales; `process.env` solo leída.
- `tests/e2e/*.spec.mjs`: Playwright; consignas de ejecución; `global-setup`/`global-teardown`; no rotar credenciales mientras corren; `limpiarActividadTenant` con orden FK-safe en `lib/e2e/limpieza.ts`.
- Instrucciones de `package.json`: `test`, `test:metrics`, `test:e2e`; limpiar CI de "fake": no lanzar tests con `npm run test` si el script usa otro runner.
- Cobertura: puedes añadir métricas con `c8` o similar si no existe; no perjudicar el tiempo.
- Vulnerable: no añadir tests que estén "aprobando" código no revisado; cada test debe aclarar un bug aislado (no un refactor).

Cómo verificar:

- Ejecutar `npm run quality` (todo) o `npm run test` + `npm run test:metrics` si solo quisiste revisar pruebas unitarias.
- Si hay fallos conocidos, registrar en `docs/ACTIVE_HANDOFF.md` o en la sección correspondiente del plan: qué prueba falla, qué hace, estado de `main`.
- `npm run test:e2e` en desarrollo: levantar `next build` + `next start` en puerto 3100, y ejecutar `npm run test:e2e` contra ese servidor con las credenciales de QA. Solo si tienes el arnés listo (ver `scripts/e2e/setup-tenant.mjs`).
- Si no puedes ejecutar una suite por falta de infraestructura (credenciales, claves), decílo explícitamente como hueco. No decir "código probado" si no corriste la suite.

---

## Sección 8 — Flujo de trabajo de revisión: si tocas rutas/páginas añade `npm run build`; si añades/borras exports añade `npm run dead-code`

Objetivo: cada PR es una unidad de trabajo, y al terminar el plan, el estado del repositorio refleja sólo lo que está aplicado.

Qué inspeccionar:

- `docs/plan/README.md`: orden de fases y `MATRIZ_DE_CARGA`.
- `docs/ACTIVE_HANDOFF.md`: filas de relevo; antes de empezar una unidad, revisar si hay una fila que cubra ese ámbito (si hay, coordinar en la fila; no tocar trabajo reclamado por otro agente sin validar).
- `PENDIENTES.md`, `docs/CONVERSACIONES.md`, `docs/F6-MAPA-PII.md`: estado de destino y productos pendientes.
- `docs/SECURITY_PRIVACY.md`: lista de obligaciones de privacidad; verificada si hay cambio en datos personales.
- `docs/DEVELOPMENT_RULES_FULL.md`: separación de conocimiento y reglas de revisión aplicables a la sección.

Tareas por hacer:

1. Leer este plan (este documento) y confirmar el alcance.
2. Decidir qué sección empieza o si se aplica por secciones en el orden propuesto. En cada paso: identificar los ficheros que toca, revisar una a una, registrar hallazgos en `docs/ACTIVE_HANDOFF.md` y escribir PRs.
3. Montar los "checks" de verificación de cada sección.
4. Al finalizar, generar un resumen con: qué sección se revisó, hallazgos, cambios aplicados, comprobaciones que se ejecutaron (con su resultado) y riesgos pendientes.

---

## Índice de secciones (por orden sugerido)

| #   | Sección                                                                     | Ficheros/ámbitos                                                                                              | Verificación                                                   |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 0   | Arquitectura, stack, invariante multi-tenant                                | `package.json`, `next.config.js`, `vercel.json`, `tsconfig.json`, `components/ui/`, `app/layout.tsx`, `docs/` | `npm run quality` + `build` + `dead-code`                      |
| 1   | Base de datos / Supabase: migraciones, RLS, tenant_id, constraints, índices | `supabase/migrations/*`, `supabase_migrations.schema_migrations`, tablas con `tenant_id`                      | Dry-run, pruebas de aislamiento, `npm run test`                |
| 2   | API routes / servidores: validación, auth, errores, idempotencia            | `app/api/[tenant]/evergreen/**`, `lib/auth/**`                                                                | `curl`/`Playwright`, 3 contingentes, uidempotencia de webhooks |
| 3   | Frontend: formularios, estados, a11y, `next/image`, rutas `[tenant]`        | `app/[tenant]/**`, `components/**`                                                                            | `npm run test:e2e`, `build` si toca rutas                      |
| 4   | Lógica de dominio: CRM, ventas, finanzas, marketing, IA, integraciones      | `lib/**`, `components/**`                                                                                     | `npm run test` + seguimiento por trail de datos                |
| 5   | Infraestructura y operaciones                                               | `vercel.json`, variables, crons, `SENTRY`, emails                                                             | `npm run build`, `vercel ls/inspect`, `npm run quality`        |
| 6   | Seguridad y privacidad                                                      | `SECURITY.md`, `docs/SECURITY_PRIVACY.md`, grants, secrets, auditoría                                         | `gitleaks`, `information_schema`, `npm run test`               |
| 7   | Tests                                                                       | `tests/**`, `package.json`, `scripts/e2e/**`                                                                  | `npm run quality` (código), `npm run test:e2e` (desarrollo)    |
| 8   | Flujo de trabajo y ruta de entrega                                          | `docs/plan/`, `docs/ACTIVE_HANDOFF.md`, `PENDIENTES.md`, `docs/CONVERSACIONES.md`, `docs/F6-MAPA-PII.md`      | `npm run quality` completo de la rama                          |

---

## Reglas de escala de la revisión

- No añadir dependencias, capas ni abstracciones por "mejora"; la revisión vale por qué el cambio se hace.
- No corregir errores de diseño sin decidir si se incluye en este plan; si no lo está, registrarlo como hallazgo en `docs/ACTIVE_HANDOFF.md`.
- Si una ruta que toca es crítica (pagos, reservas, webhooks, IA), no aplicar cambios sin tener el check de idempotencia y audit redactado (ver Sección 2 y 4).
- Las migraciones aplicadas en producción sin registrarse en `schema_migrations` deben registrarse; no reaplicar. La lista de migraciones es la fuente para `supabase_migrations.schema_migrations`.
- Nada de datos, secretos o credenciales reales en commits; `gitleaks` es el gate.
- Cuando no se puede probar algo (tests E2E, métricas, cobertura), informarlo como "no verificado en este punto", no como "probado".

---

## Estado del recorrido (2026-11-05 — tras fusionar #735 y #736 en main)

Estado real de cada sección al cerrar el recorrido por secciones (PR #735 = informe del
recorrido + higiene de temporales; PR #736 = fixes de lint, `src/prompts`, 404 global,
README de worker/ y este estado). Cada ítem queda como COMPLETADO, RECORRIDO o BLOQUEADO
con su causa externa: nada queda en "pendiente" sin ser accionable en repo o bloqueado.

| #   | Sección                                        | Estado                                                  | Detalle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Arquitectura · stack · invariante tenant       | COMPLETADA                                              | Checks de sección ejecutados en verde (typecheck, lint 0/0, format, test 2609/2609, metrics 789/789, build 0, dead-code sin cambios nuevos). Hallazgos resueltos: drift de tipos BD (regenerado con `npm run tipos:bd`, sincronizado en #735); `src/prompts/*` borrado por dead-code verificado (#736); untracked con sufijo « 2» depurado por lotes (90 byte-idénticos, cero pérdida, #736). Vigilancia permanente que queda: clientes Supabase sin genérico `Database` (deuda documentada, no incidencia).                                                                                                                                                                                                                                                                                                                                                                      |
| 1   | BD · migraciones · RLS · tenant_id             | RECORRIDA; desbloqueada 5-nov vía conector Supabase     | Ficheros de `supabase/migrations/` inspeccionados (0 `DROP TABLE`; `SECURITY DEFINER` con `search_path` fijo; fechas "solo día" con helpers UTC). 5-nov: acceso SQL real vía conector — catálogo leído y auditoría de drift completa (ver "Verificación con conectores, 5-nov"). Hallazgo mayor: la lista "4 tablas sin migración" era falsa a medias — `vsl_videos`/`vsl_sessions` SÍ están en disco (`20260910110000_restore_original_features`, tenant_id en `20260911150000`, RLS en `20260911130000`); `resource_links`/`resource_link_divisions` se crean DELIBERADAMENTE en runtime vía `app/api/[tenant]/evergreen/admin/migrate-resource-links/route.ts` (DDL idempotente documentado; el DDL real capturado coincide). Queda como decisión: ~28 ficheros de disco sin fila en el registro de migraciones de producción y 7 filas de registro sin fichero (ver informe). |
| 2   | API · routes · server actions                  | RECORRIDA                                               | Código revisado completo: `requireTenant`, firma de webhooks fail-closed + idempotencia, secrets solo server. BLOQUEADO por credenciales QA: verificación runtime de cada ruta (GET/POST con 3 contingentes de tenant) necesita una sesión real de subcuenta QA.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3   | Frontend · formularios · estados · a11y        | COMPLETADA en lo code-revisable; BLOQUEADA la QA manual | 31 warnings de ESLint → 0/0 con fixes de raíz (#736). Estados de segmento: aparece `app/not-found.tsx` global (#736; antes el 404 caía en el default de Next); segmentos críticos con error/loading y "fuente ilegible + reintentar" ya presentes. BLOQUEADO por credenciales QA: revisión manual del módulo Formularios (envío, envío repetido, revisión de respuestas) en una subcuenta real.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4   | Dominio (CRM, ventas, finanzas, marketing, IA) | RECORRIDA                                               | Reglas críticas verificadas en código (claims atómicos antes de efectos externos, truncado declarado de crons, no inventar datos financieros, vocabulario canónico). BLOQUEADO por acceso externo: el seguimiento real de un caso de datos (escritura → BD → pantalla de un campo tipo `campaign_id`) necesita acceso a la BD.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | Infraestructura y operaciones                  | RECORRIDA; despliegue VERIFICADO 5-nov                  | `vercel.json` (ignoreCommand docs-only y presupuesto de build), crones con presupuesto interno menor que `maxDuration`, Sentry/env vars revisadas. 5-nov: via conector Vercel, `list_deployments` target=production → el último deploy READY (sha `2142813a`, PR #737) es exactamente el HEAD de `main` al momento; cadena lista: `21c949c9` → `c1abf8a6` → `c1c5867f` → `154fc4d8` → `2142813a`, todas READY. VERIFICADO (no solo inspeccionado): producción sirve el último commit de `main`.                                                                                                                                                                                                                                                                                                                                                                                   |
| 6   | Seguridad y privacidad                         | COMPLETADA en recorrida y documental                    | Cero secretos filtrados (`gitleaks` SUCCESS en las PRs del recorrido); CSRF: auditoría cerrada (sin capa explícita; mitigaciones reales: cookies Lax, sin CORS general, webhooks fail-closed — capa explícita es decisión de arquitectura, no deuda del review). BLOQUEADO por acceso externo: comprobar grants reales en `information_schema`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 7   | Tests                                          | COMPLETADA en local; BLOQUEADA la E2E                   | `npm test` 2609/2609 y `test:metrics` 789/789 en verde tras cada ciclo (#735 y #736). BLOQUEADO por credenciales QA: `npm run test:e2e` (Playwright contra servidor con sesión real).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 8   | Flujo de entrega                               | COMPLETADA                                              | Ruta respetada: rama nueva desde `origin/main`, commit con pathspec acotado, PR + CI SUCCESS + squash + rama borrada; el estado vivo del relevo vive en `docs/ACTIVE_HANDOFF.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Verificación con conectores (5-nov, misma sesión): acceso SQL real a `growth-ops-app` (Supabase /
`rgcbveflosqgxrcqlqzv`) y a Vercel (`prj_gCUOHbX1SgpY1LOBKIiqTza4HIZM`). Solo lectura en la BD;
ninguna escritura (ni DDL ni registro). Resultado:

- **Estado del catálogo real**: 142 migraciones registradas en producción, 142 ficheros en disco.
- **"4 tablas sin migración" era falso a medias.** `vsl_videos`/`vsl_sessions` sí están en disco
  (`20260910110000_restore_original_features`; tenant_id en `20260911150000_multi_tenant_domain_tables`
  con `IF NOT EXISTS` sobre lista de tablas; RLS y políticas en `20260911130000_fix_rls_p0_round2`;
  uniques y deleted_at en las siguientes). `resource_links`/`resource_link_divisions` no tienen
  `CREATE TABLE` en migraciones POR DISEÑO: se crean en runtime vía
  `app/api/[tenant]/evergreen/admin/migrate-resource-links/route.ts` (CREATE+ALTER idempotentes,
  índices y RLS incluidos ahí). El DDL real capturado del catálogo (columnas, PK/FK, triggers
  `updated_at`, políticas `rl_select/rl_modify`/`rld_select/rld_modify`) CONCUERDA con lo que esa
  ruta crea. No se escribe una migración espejo: duplicaría la única fuente de verdad.
- **Drift del registro de migraciones (informe, pendiente de decisión).** Supabase reescribe la
  `version` con el timestamp de aplicación y guarda el fichero en `name` (patrón visible desde el
  13-sep; también los aplicados 3-nov vía MCP). Comparando nombre (suffixo) y no versión:
  ~28 ficheros de disco sin fila en el registro de producción y 7 filas del registro sin fichero:
  `contacts_get_or_create_revoke_authenticated`, `appointments_result_vocabulario_y_marcado` (=
  `20260915110000_appointments_result_vocabulario` aplicada con otro nombre), `career_schema_v1`,
  `career_rls_deny_by_default_v1`, `drop_empty_career_schema`,
  `restore_team_scheduling_scope_contacts`, `conversaciones_solo_lectura`. Muestras verificadas
  de facto: `stripe_payments`, `launch_*`, `email_*`, `platform_settings`,
  `user_fathom_connections`, `sale_expected_installments.is_monitoring`, `tenants.status` y la
  política `tasks_select_team` (con el filtro affiliate ya integrado) existen en producción:
  la mayoría de los 28 se aplicaron sin registro. Los tres `career_*` y el drop final se
  autoanulan (`drop_empty_career_schema`), así que su estado neto es nulo.
- **Grants reales (hallazgo, requiere decisión).** `role_table_grants` a `anon`/`authenticated`
  sobre 115 tablas de `public` (patrón por defecto de Supabase), incluidas las 4 del hallazgo y
  núcleo como `contacts`/`sales`. Los módulos endurecidos (`forms_*`, `conversation*`, `launch*`,
  `tenants`, `pgss_*`, tracking VSL) ya los revocaron. El dato NO está expuesto en la práctica:
  bloquean las políticas RLS (p. ej. en las 4 tablas el `SELECT` exige rol de subcuenta y el
  `ALL` exige `auth_tenant_ids()`). Acción pendiente: decidir si se revocan por lotes siguiendo
  el patrón de `forms_hardening`/`conversaciones_solo_lectura` con dry-run `BEGIN…ROLLBACK` y
  advisors antes del commit.
- **Despliegue verificado**: el último deploy de producción en Vercel está `READY` con el SHA de
  `main` al momento (`2142813a`, PR #737); cadena sin errores en los cinco deploys previos.

Ítems que SOLO quedan pendientes, cada uno con su requisito literal:

1. **QA manual del módulo Formularios** — necesita credenciales de sesión de una subcuenta QA real.
2. **QA E2E en desarrollo** (`tests/e2e/*.spec.mjs`) — necesita el arnés con credenciales QA.
3. **Tres stash etiquetados de la hebra paralela** (`git stash list`) — relevo de trabajo ajeno:
   solo una hebra con contexto de esas tareas puede aplicarlos.

Decisiones de producto e infraestructura que NO bloquea el code review (quedan en el tablero de
`docs/ACTIVE_HANDOFF.md`): registrar (o validar de facto) las ~28 migraciones sin fila y las 7 sin
fichero, y revocar los grants por defecto a `anon`/`authenticated` en `public`.

_Plan creado: 2026-11-04. Última actualización de estado: 2026-11-05 (#738, verificación con
conectores): el recorrido por secciones está cerrado y verificado (BD por catálogo, despliegue por
API); queda lo listado arriba, con su requisito literal._

---

## Recorrido con la skill `code-review` (5-nov, tarde)

Esta tarde se instaló la skill `mattpocock/skills@code-review` en
`.codebuff/skills/code-review/SKILL.md` (editable, misma convención que `design-taste-frontend`)
y se volvió a recorrer la app por secciones aplicando su metodología de dos ejes sobre el estado
actual de `main` (`96e9f66a`):

- **Standards** = los estándares documentados del repo (AGENTS.md, `docs/DEVELOPMENT_RULES_FULL.md`,
  `docs/SECURITY_PRIVACY.md`, `docs/FREE_TIER_OPERATIONS.md`) + el smell baseline de Fowler que
  trae la skill (12 smells; aquí, sin diff, actúan como heurística puntual, no como checklist).
- **Spec** = el «Qué inspeccionar / Cómo verificar» de cada sección de este mismo plan.

El recuento del repo al recorrer: 272 `route.ts` en `app/api`, 123 `page.tsx`, 142 migraciones,
~90 suites de tests. Método: búsquedas dirigidas por regla sobre todo el árbol más verificación
ad hoc de endpoints sensibles; sin escrituras en BD. Los tres bloqueos externos de arriba siguen
idénticos (credenciales QA ×2 y los stash de la hebra paralela).

| #   | Sección                                  | Veredicto del segundo recorrido                                         | Evidencia nueva (5-nov tarde)                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Arquitectura · stack · invariante tenant | Sin cambios: COMPLETADA                                                 | `package.json` scripts canónicos intactos; `vercel.json` con `ignoreCommand` docs-only, `maxDuration` 60 y 2 crons; 0 clases imposibles (`h-4.5` sigue despejado).                                                                                                                                                                                                                                    |
| 1   | BD · migraciones · RLS                   | Sin cambios: RECORRIDA + 2 decisiones (drift ~28/7 y grants)            | No se re-abrió la auditoría del conector; lo verificado esta mañana sigue vigente.                                                                                                                                                                                                                                                                                                                    |
| 2   | API · routes                             | RECORRIDA de nuevo; mismo bloqueo de QA runtime                         | 272 rutas: las que no llaman `requireTenant` usan el guard módulo canónico (`requirePantalla` en `funnel-eventos`/`trafico-web`/`vsl/metrics`, `authorizeForms` en forms, auth de Supabase en callback/set-password y en `ver-como` (superadmin)); webhooks con firma verificada (Stripe/Calendly/Fathom/contract/GHL/Whop). Ofuscados: sin arnés QA no hay prueba runtime por contingente de tenant. |
| 3   | Frontend                                 | Sin cambios: COMPLETADA en lo code-revisable + bloqueo QA manual        | Solo el hallazgo STD-02(b) nuevo (fallback de marca fuera de tokens, judgement call).                                                                                                                                                                                                                                                                                                                 |
| 4   | Dominio                                  | RECORRIDA de nuevo; mismo bloqueo de trazabilidad con BD                | Claim atómico con token confirmado en `lib/social/apify.ts` (`started_at` + `error_message = claimToken`); truncado de Stripe con su test (`tests/stripe-fees-deadline.test.mjs`); `setMonth` de facturas es un selector de mes de UI (falso positivo, no fecha "sólo día").                                                                                                                          |
| 5   | Infraestructura                          | VERIFICADO esta mañana (deploy READY)                                   | Sin cambios.                                                                                                                                                                                                                                                                                                                                                                                          |
| 6   | Seguridad y privacidad                   | Sin cambios; 0 secretos en código                                       | Búsqueda de `service_role`/keys: los 250+ matches son nombres de variables/docs/migraciones, ningún valor. `.DS_Store` locales no trackeados (gitignored). Grants = decisión pendiente de Alex.                                                                                                                                                                                                       |
| 7   | Tests                                    | Verde en el estado de esta mañana (`npm test` 2609/2609, metrics)       | No se re-ejecutó: árbol idéntico salvo docs.                                                                                                                                                                                                                                                                                                                                                          |
| 8   | Flujo de entrega                         | Esta PR es la demo: rama desde `origin/main`, pathspec acotado, PR + CI | —                                                                                                                                                                                                                                                                                                                                                                                                     |

**Standards (hallazgos del eje estándares):** un hallazgo duro nuevo — **STD-01** en
`docs/AUDIT_LEDGER.md`: `any` en 3 ficheros de `app` (atribución ×3, Instagram ×2: `sb: any`);
resto del árbol: 0 `as any`/`@ts-ignore`. Dos juicios menores agrupados en **STD-02** (timing log
no estructurado en `lib/instagram/sync.ts:56`; fallback de marca `#8b8b93` en
`settings/integraciones` line 1423). Deuda conocida que NO es hallazgo nuevo:
`select('*')` en 85 ficheros (patrón vigente documentado; el caso sensible de `users` ya está en
tablero). Smells sin diff materio no se evaluan: la skill trae el baseline para diffs, y aquí no hay
una unidad de trabajo en curso.

**Spec (eje requisitos):** cada sección del plan mantiene su estado de arriba; se han revisado
todos los requisitos ejecutables sin credenciales y ninguno ha cambiado. Lo único externo y
pendiente sigue siendo exactamente ítem 1 (QA Formularios), ítem 2 (QA E2E) e ítem 3 (stashes).

Resumen según la skill: 1 hallazgo en Standards (STD-01, "No `any`") y 0 en Spec.
_Plan creado en 2026-11-04; última actualización 2026-11-05 (recorrido con la skill)._

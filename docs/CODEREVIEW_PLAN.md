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

| # | Sección | Ficheros/ámbitos | Verificación |
|---|---------|------------------|--------------|
| 0 | Arquitectura, stack, invariante multi-tenant | `package.json`, `next.config.js`, `vercel.json`, `tsconfig.json`, `components/ui/`, `app/layout.tsx`, `docs/` | `npm run quality` + `build` + `dead-code` |
| 1 | Base de datos / Supabase: migraciones, RLS, tenant_id, constraints, índices | `supabase/migrations/*`, `supabase_migrations.schema_migrations`, tablas con `tenant_id` | Dry-run, pruebas de aislamiento, `npm run test` |
| 2 | API routes / servidores: validación, auth, errores, idempotencia | `app/api/[tenant]/evergreen/**`, `lib/auth/**` | `curl`/`Playwright`, 3 contingentes, uidempotencia de webhooks |
| 3 | Frontend: formularios, estados, a11y, `next/image`, rutas `[tenant]` | `app/[tenant]/**`, `components/**` | `npm run test:e2e`, `build` si toca rutas |
| 4 | Lógica de dominio: CRM, ventas, finanzas, marketing, IA, integraciones | `lib/**`, `components/**` | `npm run test` + seguimiento por trail de datos |
| 5 | Infraestructura y operaciones | `vercel.json`, variables, crons, `SENTRY`, emails | `npm run build`, `vercel ls/inspect`, `npm run quality` |
| 6 | Seguridad y privacidad | `SECURITY.md`, `docs/SECURITY_PRIVACY.md`, grants, secrets, auditoría | `gitleaks`, `information_schema`, `npm run test` |
| 7 | Tests | `tests/**`, `package.json`, `scripts/e2e/**` | `npm run quality` (código), `npm run test:e2e` (desarrollo) |
| 8 | Flujo de trabajo y ruta de entrega | `docs/plan/`, `docs/ACTIVE_HANDOFF.md`, `PENDIENTES.md`, `docs/CONVERSACIONES.md`, `docs/F6-MAPA-PII.md` | `npm run quality` completo de la rama |

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

| # | Sección | Estado | Detalle |
|---|---------|--------|---------|
| 0 | Arquitectura · stack · invariante tenant | COMPLETADA | Checks de sección ejecutados en verde (typecheck, lint 0/0, format, test 2609/2609, metrics 789/789, build 0, dead-code sin cambios nuevos). Hallazgos resueltos: drift de tipos BD (regenerado con `npm run tipos:bd`, sincronizado en #735); `src/prompts/*` borrado por dead-code verificado (#736); untracked con sufijo « 2» depurado por lotes (90 byte-idénticos, cero pérdida, #736). Vigilancia permanente que queda: clientes Supabase sin genérico `Database` (deuda documentada, no incidencia). |
| 1 | BD · migraciones · RLS · tenant_id | RECORRIDA; BLOQUEADA para lo externo | Ficheros de `supabase/migrations/` inspeccionados (0 `DROP TABLE`; `SECURITY DEFINER` con `search_path` fijo; fechas "solo día" con helpers UTC). BLOQUEADO por acceso externo: consultar `schema_migrations` en producción, comprobar grants y capturar las 4 tablas vivas sin `CREATE TABLE` en migraciones (fila del tablero en `docs/ACTIVE_HANDOFF.md`). Desbloqueo: acceso SQL o pg_catalog a la BD. NO se inventará DDL. |
| 2 | API · routes · server actions | RECORRIDA | Código revisado completo: `requireTenant`, firma de webhooks fail-closed + idempotencia, secrets solo server. BLOQUEADO por credenciales QA: verificación runtime de cada ruta (GET/POST con 3 contingentes de tenant) necesita una sesión real de subcuenta QA. |
| 3 | Frontend · formularios · estados · a11y | COMPLETADA en lo code-revisable; BLOQUEADA la QA manual | 31 warnings de ESLint → 0/0 con fixes de raíz (#736). Estados de segmento: aparece `app/not-found.tsx` global (#736; antes el 404 caía en el default de Next); segmentos críticos con error/loading y "fuente ilegible + reintentar" ya presentes. BLOQUEADO por credenciales QA: revisión manual del módulo Formularios (envío, envío repetido, revisión de respuestas) en una subcuenta real. |
| 4 | Dominio (CRM, ventas, finanzas, marketing, IA) | RECORRIDA | Reglas críticas verificadas en código (claims atómicos antes de efectos externos, truncado declarado de crons, no inventar datos financieros, vocabulario canónico). BLOQUEADO por acceso externo: el seguimiento real de un caso de datos (escritura → BD → pantalla de un campo tipo `campaign_id`) necesita acceso a la BD. |
| 5 | Infraestructura y operaciones | RECORRIDA | `vercel.json` (ignoreCommand docs-only y presupuesto de build), crones con presupuesto interno menor que `maxDuration`, Sentry/env vars revisadas. BLOQUEADO por credenciales de despliegue: `vercel ls/inspect` y verificar el deploy de producción con un SHA real (el conector de Vercel rechaza la operación en este entorno). |
| 6 | Seguridad y privacidad | COMPLETADA en recorrida y documental | Cero secretos filtrados (`gitleaks` SUCCESS en las PRs del recorrido); CSRF: auditoría cerrada (sin capa explícita; mitigaciones reales: cookies Lax, sin CORS general, webhooks fail-closed — capa explícita es decisión de arquitectura, no deuda del review). BLOQUEADO por acceso externo: comprobar grants reales en `information_schema`. |
| 7 | Tests | COMPLETADA en local; BLOQUEADA la E2E | `npm test` 2609/2609 y `test:metrics` 789/789 en verde tras cada ciclo (#735 y #736). BLOQUEADO por credenciales QA: `npm run test:e2e` (Playwright contra servidor con sesión real). |
| 8 | Flujo de entrega | COMPLETADA | Ruta respetada: rama nueva desde `origin/main`, commit con pathspec acotado, PR + CI SUCCESS + squash + rama borrada; el estado vivo del relevo vive en `docs/ACTIVE_HANDOFF.md`. |

Ítems que SOLO quedan pendientes por acceso externo (requisito literal para desbloquear):

1. **Migración de las 4 tablas sin historial de migraciones** — necesita acceso SQL a la BD de
   producción (SQL directo o pg_catalog con permiso de lectura) para capturar el DDL real; no se
   inventa.
2. **Grants reales / `information_schema` / `schema_migrations` de producción** — mismo requisito de
   acceso SQL.
3. **QA manual del módulo Formularios** — necesita credenciales de sesión de una subcuenta QA real.
4. **QA E2E en desarrollo** (`tests/e2e/*.spec.mjs`) — necesita el arnés con credenciales QA.
5. **Verificación del despliegue en producción con `vercel ls/inspect`** — necesita credenciales de
   Vercel.
6. **Tres stash etiquetados de la hebra paralela** (`git stash list`) — relevo de trabajo ajeno:
   solo una hebra con contexto de esas tareas puede aplicarlos.

*Plan creado: 2026-11-04. Última actualización de estado: 2026-11-05 (#736): el recorrido por
secciones está cerrado; queda lo listado arriba, que solo se desbloquea con acceso externo.*

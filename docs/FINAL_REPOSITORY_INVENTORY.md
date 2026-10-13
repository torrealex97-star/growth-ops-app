# SPEC-18 PR-0 — Inventario forense del repositorio (consolidación)

Enlace, no duplicación: la base detallada por módulo vive en las 10 auditorías de PR-0 ya
fusionadas (PRs #479–#487, #493, #494, #497). Este documento es su índice operable para la
decisión de lanzamiento, con la evidencia fresca de ejecución del 13-oct.

## 1. Stack y entornos verificados

- **App:** Next.js App Router (Vercel Hobby, Fluid, `maxDuration` 60 s), Node ESM + TS.
- **Datos:** Supabase Free (PostgreSQL + RLS en ~108 tablas y políticas RESTRICTIVE), Data API
  - pooler 6543; cliente autenticado por request, service-role solo en rutas críticas con
    requireTenant como primera barrera.
- **Pagos del negocio del cliente:** Stripe (webhooks idempotentes, espejo de pagos). El
  billing PROPIO del SaaS NO EXISTE (especificado en [PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md)).
- **Jobs:** 2 crons en `vercel.json` + 7 delegados a GitHub Actions; presupuesto global por
  invocación anclado ([lib/perf/presupuesto-cron.ts](../lib/perf/presupuesto-cron.ts), #497).
- **Integraciones activas reales:** Meta Ads, GHL, Calendly, Google Calendar, Stripe, Apify,

  Resend, Bunny/VSL. Google Ads y TikTok Ads NO implementadas.

- **IA:** Copilot multi-proveedor con gateway de tools tipadas y frontera de autoridad
  (determinista primero, LLM para redactar); anomalías con fingerprint semanal.
- **MCP:** servidor completo (OAuth 2.1+PKCE, rol `mcp_reader`, transacción READ ONLY) con
  descubrimiento RFC; herramientas actualmente SQL read-only; sin cliente real verificado.
- **Evidencia de ejecución fresca (13-oct, SHA `d0addd5b`):**
  `npm test` 1682/1682 PASS (8 s) · `npm run test:metrics` 788/788 PASS (9 s) · CI verde del
  SHA fusionado #498 (Build, FLTC+dead code, Smoke E2E, gitleaks, Vercel).

## 2. Entidades canónicas y fuentes de verdad (certificación de arquitectura canónica §7)

| Entidad                 | Fuente de verdad                                                                    | Índice de evidencia       |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------- |
| Tenants (subcuentas)    | `tenants` + `tenant_members`                                                        | #494, batería aislamiento |
| Usuarios/roles          | `users` + resolver rol acotado (`requireTenant`/`rol-efectivo`)                     | #494 §1                   |
| Personas                | `contacts` (+ `stripe_customers`, `vsl_viewer_identities`, agenda ext:source:id)    | PERSON_360_ARCHITECTURE   |
| Eventos crudos          | `raw_events` (inmutable; Calendly fuera = H-1 SPEC-04)                              | AUTOMATION/MASTER doc     |
| Eventos canónicos       | `canonical_events` con correcciones versiónadas                                     | #479                      |
| Campañas                | `campaigns` (Meta sincronizadas) + resolver por identidad                           | #481                      |
| Agendas                 | `appointments` con actas y cancelación/reprogramación                               | #479, citaciones          |
| Ventas / página de pago | `sales` + `payment_plans` NOT NULL (decisión humana #486)                           | REVENUE_OPERATIONS        |
| Cash                    | canonicalCash con refunds (única definición; 10 consumidores)                       | `lib/canonical/cash.ts`   |
| Atribución              | `contact_attributions` first/last con evidencia; 3 clasificadores divergentes (H-1) | #481                      |
| Suscripción SaaS propia | **AUSENTE** (bloquea CRC comercial)                                                 | PRODUCTION_READINESS      |
| Permisos de plataforma  | `is_super_admin()` (único rol binario hoy) + matriz fail-closed #494                | SAAS_ADMIN_AUDIT          |

## 3. Tablas principales (huella testada el 6-oct)

~108 tablas con RLS; mayor footprint: `appointments` 7,7 MB, `knowledge_chunks` 4,8 MB,
`audit_logs` 3,6 MB, `contacts` 1,8 MB — total ~48 MB (10% del límite).
Métricas operativas: FREE_TIER_OPERATIONS (baseline del 6-oct, sin duplicar aquí).

## 4. Tests por nivel (matriz §31 en SPEC_TO_CODE_TRACEABILITY)

| Nivel                        | Ejemplo canónico                                        | Evidencia ACCESIBLE hoy              |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------ |
| Unit (contratos puros)       | cash, dedup, señales, presupuesto cron                  | 1682 tests locales                   |
| Integration (módulos reales) | payment-inbox con Postgres real (`tests/integration/*`) | suites locales                       |
| Database                     | invariante-tenant + escáner fuga + batería 11/11        | PROBADO; live RLS requiere creds     |
| E2E                          | Playwright `tests/e2e/*.spec.mjs`                       | en CI (green SHA fusionado)          |
| Security                     | batería adversarial + gitleaks + scraping de secretos   | CI permanente                        |
| Performance                  | helper anclado,#497; sin dataset de carga               | SUSPECTED/UNMEASURED                 |
| Operational                  | crons con actas; auditoría persistente                  | PROBADO levemente en CI              |
| Accessibility                | QA del 1-oct (axe en pantallas clave)                   | parcial; visual regression pendiente |

## 5. Riesgos conocidos (estado 13-oct)

1. **Billing SaaS MISSING** — bloquea cobro/plan/entitlements `real`; el resto lo usa hoy solo
   interno. Decisión BUSINESS pendiente (SPEC-13 §5).
2. **Restauración de backup nunca ejecutada** (P1 DR) — control UNVERIFIED; Supabase Free sin
   backups diarios administrados.
3. **Calendly fuera de `raw_events`** (H-1 SPEC-04): un conector usado a diario no deja rastro
   en el libro mayor para replay; actas en `audit_logs` compensan a medias.
4. **Tres clasificadores de fuente divergentes** (H-1 SPEC-05) con riesgo de incoherencia entre
   pantallas (mitigado por alertas de Data Health, no resuelto).
5. **Sin staging ni plataforma de pruebas de carga** — los gates de integración en vivo no son
   verificables hoy; no se afirma nada que no se haya ejecutado.
6. **Jerarquía de personas única (binaria `is_super_admin`)** — impulsada por la matriz
   fail-closed de #494, pendiente de decisión de roles (SPEC-16).
7. **Ademanes de growth_signals pendientes de DDL** (#493): nada nuevo se activa sin aprobación.

## 6. Lo que este PR NO es

No re-audita cada módulo: para detalles y deltas de cada uno, ve a su baseline propia
(AUTOMATION, SAAS_ADMIN, SCALABILITY, DATA_HEALTH, MCP, REVENUE, PERSON_360, PRODUCTION_READINESS,
UX_UI, ATTRIBUTION). Trazabilidad completa en [SPEC_TO_CODE_TRACEABILITY.md](SPEC_TO_CODE_TRACEABILITY.md).

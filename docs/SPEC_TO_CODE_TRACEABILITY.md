# SPEC-18 PR-0 — Trazabilidad SPEC → código (14 módulos)

Método: cada fila se apoya en la auditoría PR-0 real de su SPEC (link), en las suites que corre
`npm test` (1682/1682 PASS hoy) y en la CI de los SHA fusionados. **No se atribuye estado superior
al probado:** TESTED_WITH_MOCKS ≠ INTEGRATION_VERIFIED ≠ PRODUCTION_OBSERVED. Estados autorizados:
NOT_IMPLEMENTED / PARTIALLY_IMPLEMENTED / IMPLEMENTED_UNTESTED / TESTED_WITH_MOCKS /
INTEGRATION_VERIFIED / E2E_VERIFIED / PRODUCTION_OBSERVED / BLOCKED / OUT_OF_SCOPE.

| #   | Módulo                   | SPEC / PR           | Código responsable                                                                      | Test asociado                             | Estado                                                                                                            |
| --- | ------------------------ | ------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Data Integrity           | SPEC-04 · #479      | `lib/eventos/*`, `lib/canonical/*`, webhooks GHL/Stripe, `raw_events` inmutable         | suites eventos/dedup + replay dry-run     | PARTIALLY_IMPLEMENTED (H-1: Calendly fuera de raw_events)                                                         |
| 2   | Attribution              | SPEC-05 · #481      | `lib/contacts/atribucion.ts`, revenue-attribution, resolver-campana + backfills         | resolver/backfill/trajectory (PROBADO)    | PARTIALLY_IMPLEMENTED (H-1 clasificadores divergentes; last non-direct MISSING)                                   |
| 3   | Person 360               | SPEC-06 · #482      | `lib/contact-timeline.ts`, identidad con refs externas                                  | pruebame afinamiento + dedup (PROBADO)    | PARTIALLY_IMPLEMENTED (timeline sin marketing/VSL; H-1)                                                           |
| 4   | Analytics/Dashboards     | SPEC-07 · #483      | `docs/METRICS.md` + `lib/metrics/*` + canonicalCash (10 consumidores)                   | 74 ficheros de métricas (npm test run)    | PARTIALLY_IMPLEMENTED (Contratado/Cobrado/Neto únicos; delta exportaciones/scorecard)                             |
| 5   | AI Copilot               | SPEC-08 · #484      | `lib/ai/agent/gateway.ts` lista blanca, 16 tools tenant-fijadas, detección determinista | contenido hostil 12 tests + test de tools | PARTIALLY_IMPLEMENTED (evidence-first y datasets de evaluación MISSING)                                           |
| 6   | Revenue Operations       | SPEC-09 · #485      | `lib/canonical/cash.ts`, cuotas plan (helpers UTC), espejo Stripe                       | cash/refunds/dedup (PROBADO)              | PARTIALLY_IMPLEMENTED (sin entidad Opportunity — decisión no-crear; billed NOT_APPLICABLE por decisión)           |
| 7   | Data Health              | SPEC-10 · #486      | `lib/data-health/*`, 15 checks en 4 módulos, dedupe manual                              | 4 secciones propuestas en #486            | PARTIALLY_IMPLEMENTED (sin incidencias persistentes/score)                                                        |
| 8   | MCP                      | SPEC-11 · #487      | `app/api/mcp`, `lib/mcp/oauth.ts`, rol mcp_reader                                       | migraciones + EXCEPTION de deriva         | PARTIALLY_IMPLEMENTED (servidor completo; tools canónicas missing; cliente real sin prueba)                       |
| 9   | Arquitectura integración | SPEC-12             | `docs/MASTER_ARCHITECTURE_INVENTORY.md` (#479-487 consolidados)                         | —                                         | INTEGRATION_VERIFIED como mapeo; no hay build monolítico adicional                                                |
| 10  | SaaS Launch Foundation   | SPEC-13 · #483 (PR) | aprovisionador tenant (`lib/tenants/provision.ts`), auditoría super admin               | tenant-archivado 8 tests                  | PARTIALLY_IMPLEMENTED como operación interna (billing MISSING, self-serve MISSING, restore drill nunca ejecutado) |
| 11  | UX/UI                    | SPEC-14 · #484      | sistema real (23 componentes ui), KpiCard canónico, filtros                             | QA visual 1-oct parcial                   | PARTIALLY_IMPLEMENTED                                                                                             |
| 12  | Autonomous Ops           | SPEC-15 · #493      | detectores deterministas + señales (`lib/growth/signals.ts`), colas humanas             | 9 tests de señales                        | PARTIALLY_IMPLEMENTED (tabla growth_signals pendiente de DDL aprobado)                                            |
| 13  | Platform Admin           | SPEC-16 · #494      | `lib/platform/rbac.ts` (matriz fail-closed), ver-como ticket cifrado                    | 9 tests adversariales RBAC                | PARTIALLY_IMPLEMENTED (sin staff memberships de jerarquía real)                                                   |
| 14  | Scalability              | SPEC-17 · #497      | helper anclado de presupuesto, Baseline FREE_TIER                                       | 7 tests presupuesto + suites crons        | PARTIALLY_IMPLEMENTED (sin pruebas de carga real)                                                                 |

## Requisito → código → test (plantilla por requisito)

Cada fila de la matriz se puede trazar con: (a) SPEC origen, (b) fichero，(c) API/pantallas, (d)
tabla principal, (e) suite, (f) resultado. **Sin bloqueo de lanzamiento sindical**, salvo estos:

| Requisito                     | Bloqueo de lanzamiento    | Resolución                   |
| ----------------------------- | ------------------------- | ---------------------------- |
| Billing SaaS + entitlements   | SÍ (comercial)            | decisión BUSINESS SPEC-13 §5 |
| Restore drill ejecutado       | SÍ (operación)            | ejecutar en entorno aislado  |
| Self-serve signup→value       | SÍ (comercial)            | SPEC-13/16                   |
| Cliente real MCP/session live | NO para operación interna | PR-10 SPEC-11                |

Los demás hallazgos son delta de PRs abiertos, no bloqueadores para el alcance interno actual.

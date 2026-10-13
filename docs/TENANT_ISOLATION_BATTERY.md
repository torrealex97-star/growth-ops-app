# Batería adversarial transversal de tenant isolation — PR-1 master

13-oct-2026 · Buffy · resuelto en `feat/pr1-master-tenant-bateria` sobre `origin/main`.
Cierra T-5 de `docs/MASTER_ARCHITECTURE_INVENTORY.md` ("identificado en SPEC-06/09/11").

## Qué es

Una batería ejecutable (`tests/bateria-tenant-isolation-master.test.mjs`, corre en `npm test`) con
los 10 escenarios adversariales que atacan la barrera entre subcuentas. Cada escenario re-ejecuta
la guarda de un módulo distinto — la lógica canónica NO se duplica: vive en su módulo/suite de
siempre, y la batería la invoca. Si una regresión de aislamiento aparece en cualquier módulo rompe
en la batería tanto como en su suite canónica.

## Los 10 escenarios

| #   | Escenario                         | Ataque (lado atacante)                                                                     | Guarda que lo rechaza                                                                                                                                                         | Canónica                                   |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| E1  | SQL-MCP: escrituras y ofuscación  | `INSERT`/`DELETE`, CTE con `INSERT`, `set_config` de claims, `DO`, `COPY` a disco, `GRANT` | `esConsultaSoloLectura` (barrera 1) + transacción `READ ONLY` + `set local role mcp_reader` (barreras 2–3); whitelist GRANT con aborto si deriva                              | `lib/mcp/sql-executor.ts`, SPEC-11         |
| E1b | MCP degenera fail-closed          | consulta vacía/innecesariamente larga, o válida sin `POSTGRES_URL`                         | guardas ANTES de tocar red; error accionable, sin fingir resultados                                                                                                           | idem                                       |
| E2  | Cash cross-tenant                 | la misma `payment_reference` en dos subcuentas                                             | `canonicalCash` puro y per-tenant + UNIQUE `(tenant_id, payment_id)` del espejo + los consumidores (`lib/metrics/consulta.ts`, `unit-economics`) filtran tenant en cada query | `lib/canonical/cash.ts`                    |
| E3  | Webhook-IDs-coincidentes (Fathom) | id externo ya estampado / empate de candidatas                                             | `decideMatch`: determinista con id, cola `ambigua` con duda — nunca «escribir en todas»; cola idempotente por `(tenant_id, fathom_meeting_id)`                                | `lib/fathom/match.ts`                      |
| E4  | Atribución entre subcuentas       | RPC RPC con EXECUTE para authenticated llamas                                              | `attribution_funnel_for_tenant`: `SECURITY INVOKER`, membership `p_tenant_id ∈ auth_tenant_ids()` y las 4 tablas filtran tenant                                               | `tests/atribucion-aislamiento.test.mjs`    |
| E5  | Colaboradores sin sesión          | `/rest/v1/rpc/attribute_ghl_contacts_for_collaborator` directo                             | REVOKE a `PUBLIC, anon, authenticated` (mig `20261001162712`) + ruta exige pertenencia y contactos "EN ESTA subcuenta"                                                        | PENDIENTES 01-oct (P0 cerrado)             |
| E6  | Fugas service-role                | queries con service_role a tabla con tenant sin `.eq('tenant_id')`                         | escáner con saneo (≥100 rutas, ≥400 queries, 0 candidatos)                                                                                                                    | `tests/fase3-tenant-queries.test.mjs`      |
| E7  | Excepciones de esquema            | tabla de negocio sin `tenant_id` NOT NULL                                                  | lista ÚNICA y motivada en `lib/seguridad/invariante-tenant.ts` (la suite del esquema la importa; ninguna copia propia)                                                        | `tests/esquema-tenant-invariante.test.mjs` |
| E8  | Storage público                   | buckets de `contratos`/`facturas` públicos o retorno directo pares                         | migración `20260913100000` los fija privados con 4 políticas por segmento `<tenant_id>/` del path; ninguna ruta de `app/` toca `storage.buckets`                              | idem                                       |
| E9  | Agente IA fuera de tenant         | cuerpo del modelo/cliente lleva el tenant                                                  | `requireTenant` server-side + `ToolContext.tenantId` fijo en las tools; sin `service_role`                                                                                    | SPEC-08 (frontier de autoridad)            |
| E10 | Sondeo live descuidado            | ejecutar la sonda de RLS live por accidente                                                | exige `RLS_LIVE_CONFIRM=1` y fixtures autolimpiables; job registrado `test:rls:live`                                                                                          | `scripts/qa/rls-multitenant.mjs`           |

## Batería live A/B (cuando se quiera evidencia real, no solo estática)

```
RLS_LIVE_CONFIRM=1 npm run test:rls:live
```

La sonda crea fixtures sintéticos A/B con usuario solo-A y dual (se limpian en `finally`), prueba
SELECT/INSERT/UPDATE/DELETE cruzadas y devuelve PASS solo si RLS rechaza todo lo cruzado. Requiere
crédenciales reales de Supabase en el entorno (en CI y local se salta sin ellas — nunca corre a
ciegas).

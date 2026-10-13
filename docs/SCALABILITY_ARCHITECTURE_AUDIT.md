# SPEC-17 PR-0 — Scalability, Performance & Cost: auditoría del repositorio real

Auditoría previa a optimizar (AUDIT → BASELINE → PROFILE → PRIORITIZE). El baseline general vive
en [FREE_TIER_OPERATIONS.md](FREE_TIER_OPERATIONS.md) (medido el 6-oct-2026) y NO se duplica aquí:
este documento lo indexa, registra lo que este PR midió y clasifica cada componente con los
estados del entregable: MEASURED (con medición), SUSPECTED (sospecha con evidencia de código,
sin medición en carga), UNMEASURED, OPTIMIZED, VERIFIED.

## 1. Stack y cargas reales (INSPECCIONADO)

Next.js App Router en Vercel Hobby (Fluid, `maxDuration` voluntario 60 s, 2 crons en `vercel.json`

- 7 delegados a GitHub Actions), Supabase Free (Data API + pooler 6543), Stripe, Meta/Calendly/GHL/

Apify/YouTube, MCP Gateway (OAuth 2.1 + rol `mcp_reader`), Copilot IA con tools canónicas.
Clases de trabajo presentes: webhooks idempotentes (Stripe/GHL/Calendly valida-persiste-ACK),
syncs con candado `recordSyncRun` y presupuesto por invocación, backfills con claim atómico y
esqueletos, dashboards sobre agregados semánticos canónicos (`lib/metrics`), IA con timeout ≤45 s

y máx. 1 retry, MCP con whitelist + READ ONLY + máx 500 filas/8 s.

## 2. Matriz de componentes

| Componente                                         | Clase de trabajo | Cuello de botella                                                                  | Evidencia                                           | Estado                                           | Riesgo/Prioridad                                                                |
| -------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Ingesta (webhooks pixel/track)                     | Escritura rápida | Rate limiter y timeouts existentes; persistencia antes de responder                | `lib/tracking/ingest.ts`, doc webhook Stripe        | SUSPECTED (no hay p95 HTTP medido)               | Bajo                                                                            |
| Backfills (Meta/Calendly/GHL/Stripe/YouTube/Reels) | P3 masivo        | **Reparto de presupuesto desanclado** (hallazgo de este PR, ver §3)                | 4 rutas cron con `Date.now()+budget/n` por vuelta   | MEASURED (por inspección de código; no en carga) | **P1 a escala; mudo con 2 tenants**                                             |
| Dashboards/agregados (appointments top)            | P1 interactivo   | `pg_stat_statements`: lecturas de `appointments` son el coste top                  | FREE_TIER_OPERATIONS §Capacidad                     | MEASURED (advisor)                               | Mitigado por `20261006090000` (InitPlans/índices) — VERIFICAR plan tras aplicar |
| Data Health                                        | P2               | Sin incidencias persistentes ni MTTD/MTDR (SPEC-10 H-2/H-4)                        | DATA_HEALTH_ARCHITECTURE                            | UNMEASURED                                       | P2                                                                              |
| Revenue/cash                                       | P0 exactitud     | Cash canónico con dedupe/refunds probado; sin floats                               | `lib/canonical/cash.ts` + tests                     | OPTIMIZED (semántica protegida por 20+ tests)    | Bajo                                                                            |
| AI Copilot                                         | P2 intermitente  | Coste por llamada no agregado en pantalla de plataforma; timeout y retry acotados  | `lib/ai/provider`, rutas ai max 60/45 s             | SUSPECTED                                        | P2 (PR-6)                                                                       |
| MCP                                                | P2               | Presupuesto dura de 8 s/500 filas in-code; sin telemetría de conexiones por client | `lib/mcp/sql-executor.ts`, MCP_ARCHITECTURE H-3/H-5 | SUSPECTED                                        | P2 (PR-6)                                                                       |
| Platform Admin                                     | P1 staff         | No existe directorio ni telemetría por tenant (SPEC-16) — no hay carga que medir   | SAAS_ADMIN_ARCHITECTURE_AUDIT                       | UNMEASURED (NOT_APPLICABLE hoy)                  | —                                                                               |
| Person 360 / ambient                               | P1               | Timeline paginada por diseño; merges con guard                                     | PERSON_360_ARCHITECTURE                             | SUSPECTED                                        | P2                                                                              |

## 3. Los cinco hallazgos priorizados (con evidencia)

1. **[Fixed en este PR — cableado] Reparto de presupuesto de cron desanclado (P1):** en
   `cron/reminders` y `cron/monthly` (y el mismo patrón en `analyze-calls`/`reels`), el deadline de
   la subcuenta i-ésima se calculaba `Date.now() + budget/n` DESPUÉS de ejecutar las anteriores:
   el peor caso global era `n × budget`, no el presupuesto global (licencia exacta de la lección
   del 25-sep: 35+25=60 s murió con 504). Con 2 tenants es inofensivo hoy; a escala (20+), el run
   entero superaría 60 s y caería con 504 aunque cada proveedor respetara su franja.
   Corrección: `lib/perf/presupuesto-cron.ts` reparte cuotas **ancladas** al `stopAt` del run
   (`min(stopAt, franja+cuota)`), con corte declarado y sin fallos silenciosos (7 tests). Los crons
   `monthly` y `reminders` van cableados; `analyze-calls`/`reels` quedan para PR-4 con su propia
   validación (no se tocan aquí para acotar el blast radius).
2. **Lecturas de `appointments` dominan `pg_stat_statements` (P1 de DB):** mitigación preparada en
   `20261006090000_optimize_rls_and_foreign_key_indexes.sql` (InitPlans + índices selectivos).
   Pendiente VERIFICAR el plan del query después de aplicar — se hará en PR-2 con evidence
   before/after, no especulativamente.
3. **Sin p95 HTTP por ruta (P1 observabilidad):** ni Vercel ni la app exponen latencia por ruta;
   los objetivos del §8 (p95 <300/500/1500 ms) quedan como candidatos SIN baseline. PR-1 debe
   definir SLIs y empezar a registrar duración por ruta (sin PII, con tenant_id interno).
4. **Sin presupuesto ni telemetría por tenant para IA (P2):** `ai_usage_tracking` existe; no hay
   coste por consulta agregado ni shields de cuota — PR-6 con datos reales de uso.
5. **Capacidad sin hipótesis declaradas (PENDIENTE):** los escenarios 10/100/1000
   tenants de la SPEC son objetivos de simulación; cualquier afirmación de soportarlos es
   UNMEASURED y se documenta como hipótesis, no como capacidad.

## 4. Reglas preservadas (no negociables del repositorio)

- RLS intacta: el helper es puro y no toca datos; no hay caché nueva ni índice especulativo.
- Semántica: la corrija del reparto NO cambia contratos de salida de los crons (`ok`/`tenants`
  /`cortado`), solo cambia el deadline absoluto asignado a cada subcuenta.
- Idempotencia y corte-declarativo: `TIME_BUDGET_MS` sigue siendo 45 s; un corte por presupuesto
  no es fallo (misma política operativa).
- Sin secrets, sin PII nueva, sin crons nuevos en `vercel.json`.

## 5. Delta PR-1..PR-10 (adaptado al real)

| PR                      | Alcance                                                                               | Bloqueo                                                           |
| ----------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| PR-1 Obs & budget       | SLIs por ruta, duración en logs del gateway, objetivos propuestos tras medir 1 semana | ninguno técnico                                                   |
| PR-2 Query opt          | EXPLAIN de top queries + efecto del `20261006090000` (antes/después)                  | credenciales de prod para leer planes (dry-run en Supabase local) |
| PR-3 Aggregates         | Contrato de agregado versionado (`aggregate_contract`) sobre `lib/metrics`            | decisión del dueño de cuándo materializar                         |
| PR-4 Workload control   | Cablear `analyze-calls`/`reels` + clases P0-P3 documentadas                           | ninguno                                                           |
| PR-5 Backfill hardening | Checkpoints统一的 por backfill (hoy: esqueletos/cursors ad-hoc)                       | ninguno                                                           |
| PR-6 AI/MCP             | Cuota por tenant + costes agregados desde `ai_usage_tracking`                         | datos de uso reales                                               |
| PR-7 Frontend           | Web Vitals → p75 reales (Vercel ya los expone)                                        | activar medición                                                  |
| PR-8 Cost per tenant    | Modelo Direct vs Allocated con FREE_TIER números                                      | decisión business de precios (SPEC-13)                            |
| PR-9 Load tests         | Harness offline con datasets sintéticos (no producción)                               | infra de staging                                                  |
| PR-10 Resilience        | Noisy-neighbor AS medido tras PR-4 + failure tests offline                            | staging                                                           |

## 6. Límites de este PR (honestidad de cobertura)

- Medición real ejercitable: CI y unitarias; no hubo p95 de producción ni `EXPLAIN` de producción
  (requiere credenciales/owner). Todo lo no medido queda marcado SUSPECTED/UNMEASURED con su
  ruta de medición.
- Baseline DB: el del 6-oct (~48 MB) sigue vigente; re-medir al aplicar la migración de índices.

# SPEC-04 Motor de Integridad de Datos — Línea base y auditoría (PR-0) · 13-oct-2026 · Buffy

Especificación: SPEC-04 Growth Data Integrity Engine. **Regla de la spec aplicada desde el minuto
cero: no rehacer lo que funciona.** Este PR es la fase PR-0 (auditoría y línea base), obligatoria
antes de PR-1..PR-8: ninguna propuesta de tabla, servicio o fórmula nueva entra sin demostrar en la
matriz de abajo que no existe equivalente y cuál es el cambio mínimo.

Cada hallazgo se clasifica: **VERIFICADO** (confirmado leyendo el código fuente y las migraciones en
`origin/main`, 851d53c6, o mediante grep de detalle), **INSPECCIONADO** (solo lectura parcial,
pendiente de reproducir) o **PROBADO** (hay test de regresión que lo cubre hoy). No se declara
ningún problema que no se haya comprobado antes.

---

## 1. Mapa del pipeline ACTUAL frente al modelo lógico de la spec (§2)

El modelo lógico pedido ya existe casi entero, con otros nombres. No hay que construir un
«ingestion gateway» nuevo: hay que extender la cobertura a las piezas que hoy quedan fuera.

| Bloque de la spec (§2) | Implementación actual (hub) | Estado |
|---|---|---|
| Ingestion gateway | `app/api/[tenant]/evergreen/webhooks/{ghl,stripe,calendly}` (fail-closed con verificación de firma), `app/api/webhooks/{resend,apify}`, `app/api/track/[site]` (pixel first-party), `app/api/vsl/{track,identify,session}` | VERIFICADO |
| Raw event ledger | `raw_events`: sobre inmutable con `source`, `source_event_id`, `received_at`/`processed_at`, `normalizer_version`, `processing_status` (`received\|normalized\|rejected\|skipped`), `rejection_reason`, `payload_bytes`, `correlation_id`, `ip_hash`; índice único parcial por `(tenant_id, source, source_event_id)`. `canonical_events` inmutable con correcciones `*.corregido`. Migraciones `20260915100000_tracking_sites_and_raw_layer.sql` y `20260923193000_raw_events_unique_total_para_upsert.sql` | VERIFICADO |
| Validation engine | firma por webhook (timing-safe, fail-closed), tamaño, clasificación de bots (`bot_classification` en tres estados, nunca un booleano), constraints SQL (`rejected_needs_reason`) | VERIFICADO |
| Normalization engine | normalizadores por fuente versionados en `lib/eventos/{ghl,stripe,hotmart,whop}.ts`; `canonical_events.properties` sin PII | VERIFICADO |
| Deduplicación | `lib/canonical/dedup.ts` (funciones puras para leads, agendas, ventas y pagos) + índices únicos en BD | VERIFICADO |
| Identity resolution | `lib/contacts/resolve.ts` (email → teléfono → crea), `lib/contacts/atribucion.ts` (primer toque de atribución inmutable), `lib/fathom/match.ts` (candidato ambiguo → cola humana) | VERIFICADO |
| Agendas | webhook GHL idempotente por `external_id`; `lib/integrations/citas-sync.ts`; estados externos en `lib/appointments/status.ts`; cancelación y reprogramación con actas en `audit_logs` | VERIFICADO |
| Lifecycle / atribución | `contact_attributions` (first/last UTM + `attribution_status`); resolver por identidad de campaña (`lib/contacts/resolver-campana.ts`: cruce por external_id / id) | VERIFICADO |
| Cash / pagos | `lib/stripe/webhook.ts` (guarda evidencia, no inventa venta), `lib/finance/stripeBackfill.ts` (cola de decisión humana), `lib/canonical/cash.ts`, conciliación interna + Stripe (`lib/finance/{reconciliation,stripeReconciliation,stripePaymentsSync}.ts`), refunds | VERIFICADO |
| Reprocesamiento | `lib/eventos/replay.ts` (reejección sobre → hecho con dry-run, cursor reanudable, deadline, idempotente, registro de normalizadores por fuente) + backfills (`backfill-atribucion`, `backfill-campaign-id`) | VERIFICADO |
| Métricas | `lib/metrics/*` (contratos y agregados), `lib/funnels/*`; invariantes parciales ya testeadas (p. ej. `tests/appointment-attendance-summary.test.mjs`) | VERIFICADO |
| Data health | `lib/data-health/{webhooks,cross-source,conectores}.ts`: silencio ≠ rotura, hueco ≠ cero, `sin_configurar` no avisa; controles cruzados (pago Stripe sin venta, agenda sin contacto, sync obsoleta…) | VERIFICADO |
| IA / MCP | `lib/ai/*` + `lib/mcp/*`; reglas del repo (AGENTS.md): la IA no inventa datos financieros ni vocabulario; `event_name` lo elige el usuario | VERIFICADO |

**Hueco estructural (VERIFICADO por grep): el webhook de Calendly no escribe en `raw_events`.** Solo
registra `audit_logs` en las ramas de cancelación/reprogramación
(`app/api/[tenant]/evergreen/webhooks/calendly/route.ts` líneas 343 y 489; cero menciones de
`raw_events` en el fichero). El propio módulo de salud lo reconoce («actas en `audit_logs` para el que
aún no escribe sobre») y el replay solo tiene derivadores para `ghl` y `stripe`. Consecuencia: la
mitad de las reservas no es reprocesable y su reentrega re-ejecuta la proyección sin evidencia de
ingesta. `resend`/`apify`: sin menciones de `raw_events`/`audit_logs` por grep (INSPECCIONADO, por
confirmar el detalle en PR-1).

---

## 2. Matriz (§1) capacidad por capacidad

### 2.1 Ingestión

| # | Lo que hay | Lo que falla (VERIFICADO salvo indicación) | Cambio mínimo (PR) |
|---|---|---|---|
| 2.1a | Webhook GHL idempotente y reprocesable: sobre + hecho en la misma operación | — | — |
| 2.1b | Webhook Stripe: firma sobre bytes crudos, guarda el evento y no toca `collections` (decisión humana por diseño) | — | — |
| 2.1c | Reto de idempotencia de ingesta por índice único parcial: dos entregas del mismo evento → una fila | — | — |
| 2.1d | Calendly sin sobre | **H-1**: entregas de Calendly no reprocesables ni con evidencia de ingesta; reentrega = re-proyección sin huella | Llevar Calendly al mismo sitio que GHL (existe el patrón; no se inventa nada) (PR-1) |
| 2.1e | Estados del sobre: `received\|normalized\|rejected\|skipped` | **H-2**: no distinguen «aplicado» con su aspecto técnico (`canonical_event_id` lo expresa), ni cuarentena de reenvío sano | Mapear el vocabulario de la spec al existente sin tocar consumidores (PR-1) |
| 2.1f | Escritura sobre+proyección en una misma función | Sin test que pruebe la semántica de «falla la mitad → no responde 200» | Fixtures §16 (reintento y reintento fallido) (PR-1) |
| 2.1g | Pixel `/api/track`: allowlist de origin, rate limit, bots, sin PII clara | — | — |

### 2.2 Normalización

| # | Lo que hay | Lo que falla | Cambio mínimo (PR) |
|---|---|---|---|
| 2.2a | Normalizadores versionados por fuente, valor crudo preservado en el sobre | — | — |
| 2.2b | Atribución: raw preservado en `contact_attributions`; primer toque inmutable | **H-3** (INSPECCIONADO): no hay tabla de reglas `source_normalization_rules` versionadas; los alias (`FB` → meta) viven dispersos si es que existen como reglas | Tabla de reglas versionada y tenant-scoped + evaluador puro + `evidence_type` (PR-2) |
| 2.2c | Prohibiciones de la spec (no organic inventado, no website como canal, no direct sobre paid) | apoyos: el primer toque nunca se machaca; falta el suite de fixtures del §16 con los Casos A–E | Suite de fixtures de origen (PR-2) |

### 2.3 Identidad (§8)

| Lo que hay | Lo que falla | Cambio mínimo (PR) |
|---|---|---|
| Matching fuerte (ids externos, referencias booking↔formulario) y condicionado con fallback (email → teléfono → crea) — cabe más de un toque de identidad, no fusiona por parecido | **H-4** (INSPECCIONADO): `canonicalizeLeads` une por email exacto incondicionado. Dos contactos reales con un email compartido (rol/corporativo) colapsan en métricas de leads | Reglas de matching versionadas: email exacto solo basta si no es dominio de rol o si hay segunda señal (PR-3) |
| Fathom: ambiguo → cola humana (referente ya aceptado en el repo) | — | — |

### 2.4 Agendas (§9)

| Lo que hay | Lo que falla | Cambio mínimo (PR) |
|---|---|---|
| Reconciliación por referencias exactas externas (`ext:source:id`, `ce:`, `gc:`) | — | — |
| Reprogramación/cancelación con estados del proveedor y actas | — | — |
| Fallback `cs:contacto:minuto` en `canonicalizeAppointments` | **H-5** (INSPECCIONADO): dos reservas legítimas del mismo contacto en la misma hora colapsan en los KPIs que usan este matcher (caso D del §15). Es cálculo de métrica, no fusión persistente — la fila en `appointments` sigue distinta. Pero el KPI cuenta una de menos | Ceder el fallback solo si cada fila aporta su propio ID externo (dos fueron agendadas por refs distintas): PR-3 + fixture «dos agendas legítimas» |

### 2.5 Ventas y pagos (§10)

- Separación venta/checkout/PaymentIntent/refunds representada (venta con `opportunity_id`, espejo
  `stripe_payments`, `collections` interno, fees y refunds con tests) — VERIFICADO por módulos.
- El webhook de Stripe no crea venta (exige producto/plan que el pago no declara): diseño, no fallo.
- **H-6** (PROBADO que falta la señal): pagos «pendientes» de registro humano no disparan alerta de
  antigüedad (umbral por subcuenta). PR-4: salud, no pipeline nuevo.

### 2.6 Métricas (§12)

| Lo que hay | Lo que falta | Cambio mínimo (PR) |
|---|---|---|
| Invariantes parciales automatizadas: agendas con/sin closer (`appointment-attendance-summary`), funnel, cash con refunds (`cash-refunds.test.mjs`), dedup puro de ventas/pagos | **H-7** (INSPEC.): no hay una SUITE canónica que barre TODAS las invariantes declaradas de un solo sitio (el resto de pantallas se testea a trozos) | Contrato único de invariantes + test que las recorre todas (PR-6), ampliado en `docs/METRICS.md` |

### 2.7 Reprocesamiento (§11)

| Lo que hay | Lo que falta | Cambio mínimo (PR) |
|---|---|---|
| Replay determinista con dry-run, cursor, deadline, muestra y estados `al_dia`/`sin_normalizador` | **H-8** (VERIFICADO por lectura): el replay re-deriva el hecho (`canonical_events`), pero las proyecciones downstream (atribuciones, cash, vueltas del dashboard) no se invalidan en cascada cuando una relación cambia DEPUÉS de procesado el evento origen. El caso «pago antes que lead» se resuelve hoy por backfill manual, no por invalidación declarada | PR-5: registro de dependencias + invalidación ligera al llegar la evidencia retrazada (sin recalcular tenant entero) |
| Backfill idempotente con claim atómico (regla del repo) | — | — |

### 2.8 Data health, IA y aislamiento (§13/§14/§19)

- Data health: VERIFICADO y sólido en principios. Falta umbral por integración para el silencio y
  `% de duplicados / referencias no resueltas` como señales — PR-4/PR-7.
- IA/MCP: reglas del repo ya encajan con §14 (no inventar cifras, no escritura arbitraria, claim
  atómico antes del efecto externo). Los tools de diagnóstico propuestos (`inspect_event_lineage`,
  `explain_source_classification`, `compare_metric_definitions`) reutilizan el ledger existente y el
  `correlation_id` — PR-7. `confidence_level` no autoriza nunca una modificación (regla ya presente).
- Aislamiento: invariantes testeadas (`tests/esquema-tenant-invariante.test.mjs`, `atribucion-aislamiento`,
  `colaboradores-aislamiento`), RLS con helpers InitPlan. Nada nuevo sin necesidad.

---

## 3. Plan de fases adaptado

| Fase | Cubre | Nota |
|---|---|---|
| **PR-0** (este) | Línea base y matriz. Sin código productivo | Docs |
| **PR-1** | H-1 (Calendly → sobre), H-2 (mapa de estados), fixtures §16 1–6 | Extender el patrón GHL, no construir |
| **PR-2** | H-3 (reglas versionadas), fixtures Casos A–E | |
| **PR-3** | H-4 (email compartido), H-5 (dos agendas legítimas) | |
| **PR-4** | H-6 (alertas pagos pendientes), unidades monetarias, umbrales de salud | |
| **PR-5** | H-8 (invalidación ligera de proyecciones) | Dry-run y before/after ya existen |
| **PR-6** | H-7 (invariantes canónicas de dashboards) | Amplía `docs/METRICS.md` |
| **PR-7** | Copilot de diagnóstico sobre evidencia | |
| **PR-8** | E2E, RLS, rendimiento y cierre §21 | |

Cada fase: una unidad = una rama = un PR con CI; antes de tocar una fórmula, sus consumidores;
antes de una tabla nueva, demostrar en la matriz que no hay equivalente.

---

## 4. Limitaciones de esta línea base

- Auditoría de lectura: código y migraciones de `origin/main` (851d53c6) con greps de detalle. No se
  ejecutó con datos de producción; las cifras de cobertura quedan para PR-4+ junto con las métricas
  de `docs/FREE_TIER_OPERATIONS.md`.
- `resend`/`apify` marcados como INSPECCIONADO en H-1: falta confirmar si llevan algún registro
  equivalente en PR-1.
- La PR #478 (`codex/revenue-attribution-funnel`, de otro autor) quedó fuera de este análisis: no se
  ha tocado por la regla de no pisar trabajo no fusionado de otra persona.

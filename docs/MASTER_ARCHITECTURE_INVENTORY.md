# SPEC-12 — Master Architecture Audit · Inventario transversal (PR-0)
13-oct-2026 · Buffy · rama `feat/spec12-pr0-master-audit` sobre `origin/main` (`b71dcf55`)

Especificación: SPEC-12. Este PR-0 **consolida** las 8 auditorías de la Fase 2 (PRs #479/#481/#482/
#483/#484/#485/#486/#487, todas abiertas sobre la misma base) en un único inventario del sistema
real: qué existe en código (no en documentación), qué estado honesto tiene cada módulo y qué planea
el delta. Enfoque: el detalle por módulo está en su baseline; aquí se trazan los CORTES
TRANSVERSALES que ninguna auditoría de módulo cubría (integración entre módulos, duplicación, prioridad).

Método: lectura de código cruzada con las 8 baselines + greps de totales del stack. La sesión SIN
datos de producción (credenciales borradas por higiene) y SIN re-ejecución de suites: el estado de
tests se toma de CI previa de PRs de código y se declara como tal.

## 1. Inventario de los ocho módulos — estado REAL

| Módulo | Implementación principal (hub real) | Tests | Estado REAL |
|---|---|---|---|
| **Tracking** (SPEC-04) | Ingesta `app/api/[tenant]/evergreen/webhooks/{ghl,stripe}` fail-closed reprocesable, `raw_events` inmutable + `canonical_events` con correcciones, replay con dry-run (lib/eventos), dedup puro (lib/canonical) + índices únicos BD | suites de eventos y dedup (PROBADO) | **PARTIAL** — H-1 pendiente clase: **Calendly no escribe en raw_events** (verificado por grep) y resend/apify INSPECCIONADO; PR-1 de #479 |
| **Attribution** (SPEC-05) | `lib/contacts/atribucion.ts` (primer toque immutable, evidence por fuente), resolver campañas por identidad (resolver-campana + backfills), **revenue-attribution nueva de #478** (cohorte de agenda → venta → cash con cobertura declarada) | resolver/backfill/attribution-trajectory/tests de #478 (PROBADO) | **PARTIAL** — H-1: trzy clasificadores divergentes (deriveChannel/isPaidSource/originLabel) sin motor común; H-4/H-5 second touch, last non-direct y modelos MISSING (por diseño del backend en PR-3/4 de #481) |
| **Person 360** (SPEC-06) | `lib/contact-timeline.ts` (13 tipos, vista de lectura) consumida por `app/[tenant]/crm/contactos/[id]` y por el gateway IA; identidad con refs externas (agenda ext:source:id, stripe_customers, vsl_viewer_identities) | invariantes de aislamiento + dedup (PROBADO) | **PARTIAL** — H-1: la timeline no integra marketing/VS/canonical_events (el perfil no muestra páginas ni VSL); conversaciones solo agregadas por tenant. PR-2/3 de #482 |
| **Metrics/dashboards** (SPEC-07) | `docs/METRICS.md` canónico + `lib/metrics/*` + `lib/ads/funnel` + **cash canónico unificado** (canonicalCash en dashboard, resumen, metrics, unit-economics, #478) + cohortes con contacto único | 74 ficheros de tests de métricas + CI (PROBADO) | **PARTIAL (avanzado)** — P1-1 del plan del 25-sep CONSUMADO (10 consumidores); delta: contrato global de consulta, exportaciones, scorecard closers |
| **Revenue** (SPEC-09) | cash/dedup/installments PROBADOS; espejo Stripe con sync canónico | cash-refunds, dedup, salúd-pagos (PROBADO) | **PARTIAL** — H-1 sin entidad Opportunity; H-2 setter_id 0/610 (25-sep, a re-verificar); H-4 «Billing» no existe. Decisión BUSINESS pendiente |
| **IA** (SPEC-08) | Gateway con lista blanca en código (lectura/escritura_memoria/accion_material), 16 tools tipadas tenant-fijado, anomalías deterministas-primero con fingerprint | TurnUsage medido; suite de evaluación ausente | **PARTIAL** — H-1 validador evidence-first MISSING, H-2 intent planner MISSING, H-4 dataset de evaluación MISSING |
| **Data Health** (SPEC-10) | 15 checks reales en 4 módulos (webhooks silencio≠rotura, conectores 4 luces con «parcial», cross-source 10 tipos, sync-runs con actas), dedupe manual GET/POST, 4 suites de tests (PROBADO) | — | **PARTIAL** — sin catálogo versionado (H-1), sin incidencias persistentes (H-2), sin contrato de reparación aunque los mecanismos EXISTEN (H-3) |
| **MCP** (SPEC-11) | Servidor COMPLETO: JSON-RPC 2025-06-18, OAuth 2.1+PKCE+rotación, rol mcp_reader (whitelist GRANT SELECT + READ ONLY), discovery RFC 9728/8414, doc de conexión ChatGPT/Claude | migraciones con EXCEPTION de deriva (VERIFICADO); cliente real INSPECCIONADO | **PARTIAL** — tools actuales = SQL libre read-only; tools canónicas MISSING; COMPATIBILICCION no declarable sin prueba real (PR-10 de #487) |

## 2. Mapa de integración REAL (lo que une los módulos hoy)

```text
webhooks GHL/Stripe ─→ raw_events ─→ canonical_events ─→ proyecciones (contacts/appointments)
                                                      │
webhooks Calendly ✗(sobre escrito) ────────────────────┘   [HUECO SPEC-04 H-1]
                                                      │
pixel /api/track + VSL ─→ tracking_events / vsl_* ─┐   │
                                                   │   │
contact_attributions (first/last/booking) ←────────┘   │
        │                                              │
        ▼                                              ▼
resolveMetaAttribution ← campaigns (Meta sync)    contact-timeline (CRM + IA)
        │                                              │
        ▼                                              ▼
revenue-attribution #478 ─→ dashboards + coverage      AI gateway (16 tools)
        │
        ├──→ canonicalCash (Stripe + collections + refunds) ← data-health cross-source
        └──→ MCP (query_db SQL libre) ← mcp_oauth_* + RLS   [Los tres pasan por los mismos datos]
```

Consolidación: los tres consumidores de métricas (dashboards, IA, MCP) ya parten de la misma capa de
datos — la invariante del §7 de la spec es alcanzable; la brecha no es arquitectura, es cubertura.

## 3. Hallazgos TRANSVERSALES (nuevos en este PR-0)

- **T-1 — Riesgo de colisión al fusionar las 8 PRs (VERIFICADO por diseño).** Las 8 PRs editan el
  MISMO ancla del `docs/ACTIVE_HANDOFF.md` (insertan su fila antes de «# LISTO PARA FUSIONAR»).
  Fusión secuencial provocará conflictos triviales (mismo hunk). Cambio mínimo: fusionar en orden
  y resolver a mano tomando el orden cronológico; o rebasar cada rama cuando la anterior se fusione.
  No es bloqueo técnico, es planeamiento.
- **T-2 — Decisiones BUSINESS transversales en espera (VERIFICADO por lo auditado).** Entidad
  Opportunity (SPEC-09 H-1), facturación aplicable (SPEC-09 H-4), nomenclatura Cash/Revenue (25-sep
  P3-2) y deprecación de `query_db` (SPEC-11 H-1) — las 4 bloquean PRs de módulos distintos y las
  puede desbloquear el dueño del producto en una sola decisión.
- **T-3 — Cobertura VERIFICADO-dependiente de datos de producción (honestidad).** Los conteos de
  cobertura (`setter_id` 0/610, `result` 4/610, `offered` 3/610; cash dividido en dos realidades
  hasta P1-1) proceden con las credenciales borradas por higiene y se re-verificarán cuando las PRs
  tácticas tomen las pantallas — nunca con datos de la sesión.
- **T-4 — Sin recorrido E2E integral del negocio (ya pedido por SPEC-06/09/10 en sus §20).** No existe una
  prueba única que recorra Meta→Landing→VSL→Form→Lead→Calendly→GHL→Google→Show→Closer→Sale→Stripe
  como la que pide la SPEC-12; los cubren trozos por módulo — delta asignado al PR-10 master.
- **T-5 — Sin batería adversarial transversal de tenant isolation (identificado en SPEC-06/09/11).**
  Existen invariantes por módulo (esquema-tenant-invariante, atribucion-aislamiento). Falta la
  batería del §6 con los 10 escenarios (cache cross-tenant, lista cross-tenant MCP,
  webhook-IDs-coincidentes…). PR-1 master la consolida — no la crea desde cero.
- **T-6 — No hay duplicación de fuentes de verdad (VERIFICADO por las 8 audits).** Todos los
  intentos de 2ª fuente detectados (record source como adquisición en SPEC-05 H-2, cash en dos
  realidades) ya están documentados como pendientes en su módulo, ninguno sembró una tabla nueva;
  el inventario del §4 del orígenes de verdad no requiere nuevas entidades salvo las que el
  usuario decida (Opportunity, facturación).

## 4. Prioridad de consolidación (adaptado de §23)

1. **La seguridad e integridad del dinero ya está dominada por el diseño actual**: consolidar
   las verificaciones (rol mcp_reader, RLS, cash con dedup) y reparar solo si aparece algo.
2. **SPEC-04 PR-1 (Calendly→raw_events) es el punto de estrangulamiento**: da evidencia a 3 módulos
   downstream (replay de SPEC-04, clasificación de SPEC-05, Person 360 y health de SPEC-10).
3. **SPEC-05 PR-1 (motor único de clasificación)**: desbloquea la coherencia de dashboards e IA —
   dependencia directa de 4 de las 8 specs.
4. **SPEC-06 PR-2 (timeline con marketing/VSL)**: la mejora más visible para el usuario del listado.
5. **SPEC-07/09 + SPEC-10/11 PRs 1-2**: catálogos (métricas, ingresos, health, tools MCP).
6. **PRs finales de cada módulo (**E2E** con el gran recorrido de negocio del §20.

## 5. Limitaciones

- Esta es una auditoría de consolidación: sus conclusiones proceden de las 8 baselines (todas
  verificadas por lectura/grep sobre `b71dcf55`) y de greps de totales del stack; NO re-ejecuté
  suites ni accedí a producción en esta sesión.
- El inventario de componentes que NO existen (segundo toque, modelos de atribución, incidentes,
  tools MCP canónicas) se marca MISSING con su plan en la baseline del módulo correspondiente.

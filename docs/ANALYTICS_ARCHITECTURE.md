# SPEC-07 — Growth Intelligence & Analytics · Auditoría y línea base (PR-0)
13-oct-2026 · Buffy · rama `feat/spec07-pr0-analytics-audit` sobre `origin/main` (`b71dcf55`)

Especificación: SPEC-07 (dashboards/KPIs/cohortes/comparativas). **Preserve → Discover → Audit está
literalmente servido:** la auditoría pedida en el §1 EXISTE (`docs/DASHBOARD_AUDIT.md`, 25-sep, con
evidencia de BD real y marco VERIFICADO/PROBADO/INSPECCIONADO), el contrato de métricas compartidas
también (`docs/METRICS.md`, §1–§8 con reglas para no romper la definición) y alguien ya dejó `P1-1..P4`
planificado ([DASHBOARD_CORRECTION_PLAN.md](docs/DASHBOARD_CORRECTION_PLAN.md)). Este PR-0 **no
duplica** ese trabajo: establece qué sigue vigente tras los merges de #478 (revenue-attribution del
13-oct) y #480, mapea los KPIs que la SPEC-04/05/06 ya normalizan, y lista qué falta evaluar.

Método: lectura de código de `origin/main` + la auditoría heredada; sin datos de producción en la
sesión (credenciales borradas por higiene). Clasificación estándar: VERIFICADO / INSPECCIONADO / PROBADO.

## 1. Estado de cada punto del plan de corrección del 25-sep (verificado hoy)

| Punto del plan | Estado hoy | Evidencia |
|---|---|---|
| **P1-1** Cash canónico unificado | **Consumado** después: `canonicalCash`/`serieCanonicaCash` ya consumidos por `lib/metrics/consulta.ts`, `lib/analytics.ts`, `lib/unit-economics.ts`, `app/[tenant]/dashboard/page.tsx` (ahora lee `collections` Y `stripe_payments`, no solo la cola interna), `app/[tenant]/finanzas/analitica/resumen/page.tsx` y la revenue-attribution nueva de #478. | grep de consumidores (7 módulos + 3 pantallas, frente a 1 solo en la audit original) |
| P1-2 Muestra mínima en ratios por persona | INSPECCIONADO — estado no re-verificado en pantalla | pendiente de PR-6 |
| P2-1 Banner de datos parciales en cash | deprecable: P1-1 cerrado | — |
| P2-2 Scorecard de closers (`closer_id` 583/610) | INSPECCIONADO — datos disponibles | PR-6 |
| P2-3 Base de comisiones sobre cash canónico | INSPECCIONADO — depende de P1-1 ya cerrado | PR-6 |
| P2-4 Tracking VSL/onsite | **Consumado** después: pixel first-party + modelo VSL PR-1b (vsl_playback_sessions, watch intervals) + rev-attribution | módulo VSL |
| P3-1 Filtros por defecto restantes | INSPECCIONADO (re-verificar tras rebase) | PR-4 |
| P3-2 Renombrar Revenue/Facturación/Cobros | BUSINESS — decisión del usuario | — |
| P4 Representación (donut, tooltips, cohortes inmaduras) | INSPECCIONADO | PR-9 |

## 2. Mapa de la capa de métricas ACTUAL (contratos que la SPEC-07 consume)

| Bloque de la SPEC-07 | Implementación actual | Estado |
|---|---|---|
| Semantic Metrics Layer (§3) | `docs/METRICS.md` (8 secciones canónicas con regla §4 para no denominar dos cosas igual); `lib/metrics/{modelo,operativo,consulta,objetivos,registro}.ts`; `getMetricDefinition` en `lib/ai/metrics/registry.ts` (la IA ya consulta el catálogo) | VERIFICADO |
| Command Center | `app/[tenant]/dashboard/page.tsx` — KPIs de fijo/cash con posición, serie + `scopedSaleIds` por permisos de registro | VERIFICADO |
| Marketing perf | `app/[tenant]/marketing/adquisicion/campanas/page.tsx` + `lib/ads/funnel.ts` (CPM al ROAS) + daily meta sync; columnas «Embudo CRM» de #478 ya separan Platform Reported ↔ Business Observed | VERIFICADO |
| Attribution/dash de anuncios | `lib/meta/revenue-attribution.ts` (#478): resolved/unresolved separados por nivel campaña/anuncio; coverage declarado | VERIFICADO |
| Funnels | `lib/funnels/*` con 4 estados de fuente (hueco≠cero), incluida la familia VSL; `docs/DEVELOPMENT_RULES_FULL.md` prohíbe de nuevo el patrón «todo a cero» | VERIFICADO |
| VSL analytics | modelo VSL PR-1b completo (playback/intervalos/eventos); pantallas con `NOT_CONNECTED` honesto hasta conectar consumidores finales | VERIFICADO modelo, INSPECCIONADO dash final |
| Sales (setters/closers) | `app/[tenant]/analitica/ranking` + scorecard de setters SIN `setter_id` (NOT_TRACKED real, no inventado) y closers LISTO para activar (583/610) | de DASHBOARD_AUDIT, sin cambios esperables |
| Finance | `computeMonthlyPnl` (METRICS §2–4) + `canonicalCash` (§3) + cohortes de cobro (§7) + espejo Stripe | VERIFICADO |
| Cohortes | `app/[tenant]/finanzas/analitica/cohortes/page.tsx` (`buildCohorts` 30/60/90/180) + fix de contactos únicos aplicado 25-sep | VERIFICADO |
| Data quality en UI | estados estructurados «fuente ilegible + reintentar» en 5 pantallas (#269); banners Data Health | VERIFICADO |
| IA copilot | `lib/ai/agent/tools.ts` (16 tools de solo lectura, tenant cerrado, LIMIT acotado) + `getMetricDefinition` ya existe | VERIFICADO |
| Contrato global de consulta (§2) | PARCIAL: filtros con periodo/marca en URL (AUDIT_DATE_FILTERS), timezone via helpers UTC de plan-cuotas (#heredado); **falta el contrato único estructurado con `date_basis`/`attribution_model` declarados** | INSPECCIONADO — PR-2 |
| Cache | parcial (revalidaciones de Next);契约 de clave aislada por tenant sin capa formal | INSPECCIONADO — PR-9 |

## 3. Matriz de consistencia — lo NUEVO de esta SPEC (no repetir la del 25-sep)

La matriz grande con BD real ya la cubrió el 25-sep; los puntos que la SPEC-07 añade y no están
cubiertos por ese marco: los ratios con denominador cero y las exportaciones. Quedan registrados como:

- Exportaciones (§16): sin funcional actual verificada en pantallas de análisis — se evalúa en PR-8.
- Ranking de colaboración con volumen mínimo del §8/§9 ya cubierto para cerca (P3-2 de la audit del 25-sep).

## 4. Plan de fases (adaptado: solo el delta)

| Fase | Cubre | Sobre qué existente |
|---|---|---|
| **PR-0** (este) | Vigencia del plan de corrección + mapa de contratos | docs |
| PR-1 — Semantic Metrics Contract | cierre del catálogo: campos de fórmula/fecha base/estados para las métricas que hoy solo viven en código | `METRICS.md` + `registry` IA |
| PR-2 — Global Query Contract | contrato estructurado (date_basis, attribution_model, cohortes visibles) + timezone del tenant | filtros de URL actuales |
| PR-3 — Command Center | delta del secundario (§14): tarjetas con variación y diagnóstico | dashboard page |
| PR-4 — Marketing Analytics | jerarquía plataforma→anuncio con coverage + comparativas de fuente (§12) | #478 + campaigns/page |
| PR-5 — Funnel & VSL | cohort funnel vs activity funnel (§6) + retention curve de VSL | lib/funnels + VSL |
| PR-6 — Sales Analytics | scorecard closers (P2-2) + volumen mínimo (P1-2) + setters NOT_TRACKED-only | ranking/scorecard |
| PR-7 — Finance & Cohorts | cohortes por fuente y madurez declarada (§11); waterfall cash (§14) | pnl + canonicalCash + cohortes |
| PR-8 — AI Copilot | extend `lib/ai/agent/tools.ts` con las preguntas de la spec que ya rozan cash/attribution; reglas anti-invención intactas | herramientas existentes |
| PR-9 — Performance & UX | y cache seguro + exportaciones + accesibilidad | presupuesto de FREE_TIER_OPERATIONS.md |
| PR-10 — E2E & Hardening | suite de los 20 tests de consistencia (§20) reutilizando fixtures SPEC-04/05/06 | tests/metrics + e2e |

## 5. Limitaciones

- Re-verificación de vigencia por lectura/grep, no con datos: la matriz con evidence de BD queda en el
  doc del 25-sep y se actualiza cuando las líneas de datos se vuelvan a tocar (reglas del §1 de la spec).
- Los 3 PRs previos (#479/#481/#482, auditorías de SPEC-04/05/06) siguen abiertos y son el marco de
  referencia de sus contratos; coordinados por el tablero del handoff.

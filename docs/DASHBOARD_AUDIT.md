# Auditoría de dashboards y métricas — 2026-09-25

Ámbito: pantallas con métricas del tenant principal (WDC: 642 contactos, 610 citas, 36 ventas, 61 cobros; Scalix y qa-e2e vacíos). Método: código en `main` local (`04aca49`) + BD real vía service-role REST + `origin/main` hasta `a5add48`. El WIP sin commitear de otra hebra (~40 ficheros en dashboards core) se inspeccionó pero **no se modificó**. Marco: **verificado** (BD/UI real), **probado** (tests ejecutados), **inspeccionado** (solo código).

Marco canónico usado: `docs/METRICS.md`, `docs/SOURCE_OF_TRUTH.md`, `docs/SALES_METRICS_MAP.md`, skills `sales-engineering` §7 y `marketing-and-copywriting` Módulo 5. Benchmarks solo orientativos (regla de KPI: primero definición, fuente, completitud, periodo, maturity, asignación, cálculo).

## Matriz principal

| Pantalla | Métrica | Definición | Fuente | ¿Correcta? | ¿Datos completos? | ¿UI adecuada? | Hallazgo | Acción |
|---|---|---|---|---|---|---|---|---|
| Dashboard | Ventas / Contratado | `isActiveSale` por `sale_date` | `sales` | SÍ (METRICS §2) | SÍ (36 activas, abr→18-sep) | SÍ | **P1**: la venta abierta como reserva ya la excluye upstream (#221) | Rebase para heredarlo |
| Dashboard | Cash | Σ `collections` collected | `collections` | **PARCIAL** (fuente secundaria) | **NO**: congelada desde 19-sep | SÍ | **P1**: cash subcontado; el espejo Stripe tiene el histórico completo | P1-1 del plan |
| Analítica › Embudo | Cobros comisionables | METRICS §5 (sin refunds) | `collections` | Definición SÍ | Mismo hueco post-19-sep | SÍ | **P1** (misma causa raíz) | P1-1 |
| Analítica › Ranking | Cash por persona | `collections` | `collections` | Definición SÍ | Mismo hueco + muestras de 1 sin badge | SÍ | **P1 + P3-L** | P1-1 y P3-2 |
| Finanzas › Resumen / P&L | Gross/Net Revenue, Cash | `computeMonthlyPnl` | `collections`+`sales` | Definición SÍ | Cash igual hueco | SÍ | **P1** (solo partidas de cash) | P1-1 |
| Finanzas › Cohortes | Contratado, %cobrado Nd | `isActiveSale`, collected−sale_date≤Nd | `sales`+`collections` | SÍ | SÍ (cobre completo abr→19-sep) | Tabla correcta | **P2-resuelto**: Clientes contaba filas de venta → **AUTO_FIX aplicado** (contactos únicos) | Hecho + test 5/5 |
| Finanzas › Cobros | Registro de cobros | Hecho de caja interno | `collections` | SÍ (su fuente nativa) | Sí como registro; NO como cash total | Tabla OK | Sin bug: su fuente dejó de recibir Stripe por diseño | Nota: contrastar con Data Health |
| Unit Economics | CAC/LTV/ROAS cash | Clientes únicos; cash canónico | espejo+`collections` canónico | SÍ | SÍ | SÍ con aviso de acumulado | PASS — referencia de cómo debe verse el cash | Usar como patrón (P1-1) |
| Marketing › Campañas | Spend/CTR/leads por rango | `campaign_daily` por `date` | Meta | SÍ | SÍ (abr 3 → 25-sep, 1.787→160 filas activas) | SÍ | Gasto consistente con aislamiento #211; EUR único | — |
| Funnels | Etapas VSL/Ventas | `lib/funnels/compute` con 4 estados | raw/canonical_events | SÍ | Parcial (VSL sin fuente) | Sí, hueco≠cero | PASS de representación; **P2**: conectar tracking VSL | P2-4 |
| Comisiones | Generadas/futuras | Motor `lib/commissions` | `collections` | Motor SÍ | **Base subcontada** por P1 | SÍ | **P1** derivado: menos base comisionable en sept | P1-1 |
| VSL | Plays/watch | — | sin fuente | — | — | — | `NOT_CONNECTED` honesto (0≠—) | P2-4 (pixel) |
| CRM › Agendas | Citas por estado | `appointments.status` | CRM | SÍ | `result` 4/610, `offered` 3/610 | SÍ | **P2**: Pitch/Close sobre ofertas = NOT_TRACKED real | USER_ACTION A1 |
| Scorecard Setter | — | requiere `setter_id` | — | — | `setter_id` 0/610 | — | **P2**: NOT_TRACKED (no inventar) | USER_ACTION A2 |
| Scorecard Closer | — | requiere `closer_id` | — | — | **583/610 con closer** | — | Listo para activar; no requiere fix | Siguiente fase |
| Data Health | Tarjetas integraciones | manifiesto | — | — | — | — | Falsos «sin configurar» ya corregidos upstream (#222) | Rebase |
| Show rate dashboards | % asistencia | sobre resueltas | `appointments` | **SÍ tras #223** (antes dividía entre todas) | SÍ | SÍ | Ya corregido upstream | Rebase |
| Gastos | Crear gasto | insert `expenses` | UI | **Bug P1 resuelto**: faltaba `tenant_id` (23502) | — | — | **AUTO_FIX aplicado** (2 inserts) | Hecho |

## Hallazgos con evidencia (BD real WDC, 25-sep)

1. **P1 — Cash dividido en dos realidades.** `collections`: 61 cobros, 29.076,46 €, última fila 19-sep 13:19. Espejo `stripe_payments`: 74 pagos, 30.792,98 € brutos (2.096,50 € devueltos), `paid_at` 7-abr → 25-sep. El webhook de Stripe **no escribe** en `collections` por diseño (verificado en código) y el backfill inicial cubrió el histórico — pero solo `unit-economics` consume la capa canónica (`lib/canonical/cash.ts`). Septiembre real: espejo ≥19-sep = 6 pagos / 1.999,85 €; `collections` = 2 filas / 2.329,83 €. Clasificación: **fuente mal elegida** en pantalla (no bug de cálculo, no negocio fuera de KPI).
2. **P2-resuelto — Cohortes «Clientes»**: contaba filas de venta (OUT_OF_SCOPE_FINDING de METRICS §7). Fix: `lib/finance/cohortes.ts` + test (5/5, tsc OK). Datos actuales no cambian (36 ventas = 36 contactos).
3. **P1-resuelto — Gastos sin crear desde UI**: `23502 null tenant_id` en los 2 inserts. Fix aplicado y verificado en preview ayer (creación + marcar pagado + BD).
4. **NOT_TRACKED real (no bugs)**: `offered` 3/610, `result` 4/610, `setter_id` 0/610 → Pitch Rate, Close Rate sobre ofertas y scorecard de setter son imposibles hoy; la UI ya lo declara en vez de pintar 0%.
5. **Históricos**: leads completos (642/642 con `first_seen_at`, desde oct-2024 — el importador GHL dejó `created_at` plano en sep-2026, correctamente compensado por `leadDate()`); ads desde 3-abr; Stripe espejo desde 7-abr (`paid_at`) pese a sincronizar desde el 19-sep; cash interno desde 7-abr. **Sin huecos históricos pendientes salvo VSL/onsite (sin integración).**

## Scorecards (sin score numérico)

| Pantalla | Datos | Utilidad | Claridad | Filtros | Permisos |
|---|---|---|---|---|---|
| Dashboard | PARTIAL (cash) | PASS | PASS | PASS | PASS |
| Analítica › Embudo | PARTIAL (cash) | PASS | PASS | PASS | PASS |
| Analítica › Ranking | PARTIAL (cash, muestras) | PARTIAL | PARTIAL | PASS | PASS |
| Finanzas › Resumen/P&L | PARTIAL (cash) | PASS | PASS | PASS | PASS |
| Finanzas › Cohortes | PASS (tras fix) | PASS | PASS | n/a cohortes | PASS |
| Finanzas › Cobros | PASS | PASS | PASS | PASS | PASS |
| Unit Economics | PASS | PASS | PASS | n/a acumulado | PASS |
| Marketing › Campañas | PASS | PASS | PASS | PASS (URL) | PASS |
| Funnels | PARTIAL (VSL) | PASS | PASS | PASS | PASS |
| Comisiones | PARTIAL (base) | PASS | PASS | PASS | PASS |
| VSL | FAIL (sin fuente, honesto) | PARTIAL | PASS | PASS | PASS |
| CRM › Agendas | PARTIAL (marcado) | PASS | PASS | PASS | PASS |

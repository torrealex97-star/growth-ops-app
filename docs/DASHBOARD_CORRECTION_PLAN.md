# Plan de corrección de dashboards — 2026-09-25

Ordenado por prioridad. `AUTO` = ejecutable por agente; `USER` = requiere al usuario; `BUSINESS` = decisión de producto; `EXTERNAL` = proveedor. Evidencia en `docs/DASHBOARD_AUDIT.md`.

---

## P1-1 — Unificar Cash Collected en la capa canónica (fuente mal elegida)

- **Screen/Metric**: Dashboard, Analítica › Embudo («Cobros comisionables»), Analítica › Ranking, Finanzas › Resumen/P&L/Cohortes — toda métrica de cash.
- **Problem**: septiembre y en adelante aparecen subcontados: `collections` dejó de recibir pagos de Stripe el 19-sep (2 filas / 2.329,83 € desde entonces) mientras el espejo `stripe_payments` registra el dinero real (6 pagos / 1.999,85 € solo ≥19-sep; 30.792,98 € históricos).
- **Root cause**: `lib/canonical/cash.ts` (primaria Stripe + fallback interno deduplicado) solo lo consume `unit-economics`. Las demás pantallas leen `collections` directamente. El webhook de Stripe no escribe en `collections` **por diseño** (venta exige producto+plan).
- **Evidence**: conteos service-role 25-sep; grep de consumidores (`from('collections')` en 61 sitios, `canonical/cash` solo en unit-economics).
- **Fix**: en cada pantalla, traer `stripe_payments` + `collections` + `refunds` y calcular cash con `canonicalCash`/`serieCanonicaCash` (patrón exacto en `unit-economics/page.tsx:37`). En Embudo mantener la fórmula §5 (sin restar refunds) pero sobre la misma base canónica.
- **Dependencies**: ninguna técnica; evitar tocar WIP ajeno (dashboard/embudo/resumen están en el working tree de otra hebra).
- **AUTO** · **Scope**: 4-6 pantallas + adaptación del componente de gráficas. ~1 sesión.
- **Verification**: cash de septiembre en Dashboard = `serieCanonicaCash` (≥ 2.329,83 + cobros internos sin Stripe); test dorado en `tests/metrics/`; cruce contra Stripe Dashboard.

## P1-2 — Muestra mínima en ratios por persona (evitar 100% engañoso)

- **Screen/Metric**: Analítica › Ranking, panel de setters/closers — close rate, show rate por persona.
- **Problem**: una persona con 1/1 muestra «100%» con el mismo peso visual que un ratio consolidado.
- **Root cause**: no hay badge/umbral de muestra pequeña.
- **Evidence**: regla §33 de la spec; casos reales en ranking (agendas por persona < 5).
- **Fix**: si denominador < 5, renderizar «1/1 (muestra baja)» y atenuar el porcentaje.
- **AUTO** (posible solape con #223 — revisar tras rebase) · **Scope**: 1 componente.
- **Verification**: test del componente + vista con el fixture QA.

## P2-1 — Señalizar datos parciales en cash mientras existan dos fuentes

- **Screen/Metric**: todas las de cash (transicional hasta P1-1).
- **Problem**: números exactos (p. ej. 29.076,46 €) sin aviso de que las partidas Stripe de >19-sep no están.
- **Fix**: banner de Data Health o sufijo «parcial» cuando `stripe_payments` tenga pagos con `paid_at` posteriores a la última fila de `collections`.
- **AUTO** (deprecable al cerrar P1-1) · **Scope**: pequeño.

## P2-2 — Activar scorecard de closers (datos ya disponibles)

- **Screen/Metric**: Analítica › Ranking / futuro scorecard — `closer_id` poblado en 583/610 citas (95,6%).
- **Fix**: habilitar la vista de scorecard por closer (asignadas, asistidas, cierres, ticket medio) con NOT_TRACKED para el 4% sin asignar. La capa de datos existe; no se inventa atribución para el resto.
- **AUTO** · **Scope**: medio. **Verification**: cruce ventas↔citas por closer.

## P2-3 — Base de comisiones sobre cash canónico

- **Problem**: el motor comisiona sobre `collections`; tras P1-1 la base de septiembre queda coherente. Verificar que `lib/commissions/generate.ts` deduplica contra el espejo igual que el cash.
- **AUTO** tras P1-1 · **Scope**: revisión + tests existentes (`salud-pagos-stripe-sin-cobro`).

## P2-4 — Tracking VSL/onsite (punto ciego declarado)

- **Problem**: no existe fuente de eventos VSL/landing: etapas de funnel `no_configurada` y ninguna métrica de play rate.
- **Fix**: pixel first-party (`tracking_sites` ya tiene `public_key gop_pk_*` sin pixel JS) + eventos canónicos.
- **EXTERNAL/BUSINESS** (decidir proveedor o pixel propio) · ya diseñado en `docs/PLAN_FUNNELS_INTEGRACIONES.md`.

## P3-1 — Completar la migración de filtros por defecto

- **Problem**: AUDIT_DATE_FILTERS.md (17-sep) documentaba 15/19 vistas con default `all`. Verificado hoy: campañas y ventas ya usan `DEFAULT_PERIOD='month'` con estado en URL. Quedan por re-verificar tras rebase: embudo, ranking, atribución, cobros, comisiones, students, drops, morosidad.
- **AUTO** · **Scope**: bajo por fichero, uno por PR.

## P3-2 — Consistencia de etiquetas (Revenue vs Facturación vs Cobros)

- **Problem**: vigentes equivalencias históricas (SOURCE_OF_TRUTH §2). Renombrar en UI donde el usuario confirme; no fusionar conceptos distintos (METRICS §4 vs §5).
- **BUSINESS** (decisión de nomenclatura del usuario).

## P4 — Detalles de representación

- Donut de categoría de gastos con 2 categorías; tooltip de fuente (§37) en cards de dashboard; contraste de cohortes inmaduras (último mes con 0-30 días) marcado como «en curso».
- **AUTO** · cosmético.

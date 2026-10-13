# SPEC-14 — SaaS UX/UI Excellence · Auditoría PR-0

13-oct-2026 · Buffy · rama `feat/spec14-pr0-ux-audit` sobre `origin/main`.

**Método.** Solo problemas OBSERVADOS: los replicados en navegador real por auditorías previas del
repo (DASHBOARD_AUDIT 25-sep con BD real y browser; S1-MVP-READINESS §6.7/§6.8 con QA visual y de
accesibilidad 1-oct sobre 40 pantallas) más lo verificado por lectura de código en esta sesión.
Nada inventado; lo que exigiría una sesión con usuarios reales no se simuló: queda como hueco de
PR-1+ con su método de prueba.

**Design Read** (skill instalada): lectura de **producto de datos B2B (dashboards/CRM, no landing
marketing)**, para **dueño de negocio + equipo comercial**, con lenguaje **confianza/precisión**;
sistema existente real: **Tailwind 4 + componentes shadcn/Radix propios + donut/funnel SVG propios**. Diales: `VARIANCE 3-4 · MOTION 2-3 · DENSITY 7-8`. **Sin rediseño:** el §1 de la skill
(anti-slop) aplica a landings; aquí mandan las reglas 1-15 del prompt: consolidar, no rehacer.

## 1. Inventario del sistema real (lo que ya existe y manda)

**Componentes compartidos** — 23 en `components/ui/` (VERIFICADO glob): button/input/select/
textarea/checkbox/label/badge/card/table/dialog/alert-dialog/sheet/popover/tabs/separator/avatar/
skeleton/empty-state/multi-select/search-box/info-hint/calendar-popover/mesh-drift-shader. Estilo:
Tailwind 4 (escala validada por el barrido 27-sep), iconos **lucide-react**, charts PRIVATIVOS
(`DonutChart`, `ShareDonut`, `MetaFunnelVisual` en `components/os/`), VSL con `hls.js`.

**Decisiones de IA ya codificadas** (`lib/nav.ts` con motivación por línea): Funnels arriba por
ser cross-departement; CRM→/crm/agendas en servidor (sin parpadeo de redirect híbrido); Pipeline
como vista kanban de Seguimiento; la cola de Fathom tiene entrada directa para que no se quede sin
vaciar. Navegación filtrada por rol (`roles:` + `makeNavFilter`), sin segunda navegación hipotanca.

**Estado de las pantallas** — 40 páginas con Skeleton y 2 con EmptyState canónicos (S1 §6.8,
commit ca7d1d7; 1.202 tests + qa visual PASS), estados de datos estructurados en 5 pantallas de
dinero desde #269 ("fuente ilegible + reintentar", nunca suma parcial), y `lib/funnels/types.ts`
con el marco canónico `ok/sinDatos/errorFuente/noConfigurada` (un hueco no es un cero).

**Web performance** — `WebVitalsReporter` con Sentry, presupuesto de FREE_TIER_OPERATIONS como
base; S1 §6.8 cerró el barrido visual con métricas (1.202 tests unit "803 métricas" no独立的
.NUMBER de concurrent decode). Sin vitals como gate del CI (pendiente PR-9).

**Accesibilidad (parcial verificada 1-oct, S1 §6.8):** foco visible en Dialogs (Nueva agenda),
Escape en notificaciones, reduced-motion respetado en Dashboard, targets a 390×844 sin desborde.
NO verificado: screen readers, navegación 100 % keyboard en múltiples pantallas, contrast check
automatizado ni suite de regresión de accesibilidad.

## 2. Matriz por pantalla (entregable PR-0)

| Pantalla                                                 | Objetivo del usuario                                    | Problema observado                                                                                                                                                                                                                                                                                          | Evidencia                                                                                                              | Prioridad                  |
| -------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Command Center** (/dashboard)                          | "¿Cómo va mi negocio y qué necesita atención?”          | KPI cards hechos A MANO por pantalla (sin componente canónico): formato unidad/periodo/moneda definiente por pantalla; la variación y el diagnóstico están pendientes del delta del secundario (SPEC-07 PR-3); datos parciales banner ya aplicado (P2-1 deprecado tras P1-1 cerrado)                        | `app/[tenant]/dashboard/page.tsx` (card a card), DASHBOARD_AUDIT F03–F06 (browser 25-sep), P1-1 cerrado                | P1                         |
| **Marketing** (/marketing/adquisicion/campanas)          | comparar campañas y atribución                          | jerarquía plataforma→campaña ya separada (#478); columnas «Embudo CRM» sin doble colapsado; la exportación no existe funcionalmente (SPEC-07 §16 sin funcionalidad); sin validación consistente «¿exportar con qué filtros activos?»                                                                        | `lib/ads/funnel.ts`, `app/[tenant]/marketing/adquisicion/campanas/page.tsx` (campanas + colunas de #478), SPEC-07 PR-4 | P2                         |
| **Funnels** (/funnels)                                   | ver conversión multi-canal sin年出生 en pseudo-cohortes | los mapeos de eventos siguen MANUALES: la pantalla dice "fuente sin configurar" hasta que el usuario mapea (honestidad correcta); sin comparing cohortes vs actividad (SPEC-07 PR-5); la curva de retención de VSL no existe                                                                                | `lib/funnels/types.ts` (4 estados), `docs/ROADMAP_MVP.md` §3.1 (por diseño), DASHBOARD_AUDIT F-cra                     | P1                         |
| **VSL** (/vsl/*)                                         | retención/completión/CTA/play rate                      | modelo completo VERIFICADO (playback/intervals/eventos) con dash final INSPECCIONADO; no hay comparativa de vídeos ni curva de retención renderizada; el dash no cruza aún con los leads vinculados (SPEC-06)                                                                                               | `components/vsl/VslPlayer.tsx` (971 líneas), `docs/MASTER_ARCHITECTURE_INVENTORY.md` (row VSL)                         | P1                         |
| **Person 360** (/crm/contactos/[id])                     | entender el recorrido de una persona                    | la timeline existe con 13 tipos de evento comercial (de primera sesión hasta pagos); NO incorpora marketing/VSL (delta de SPEC-06 PR-2: añadir sesiones/formulario/VSL); la PII está protegida (payload crudo plegado y solo para admin, enmascarado para el resto)                                         | `lib/contact-timeline.ts`, S1 §6.4, PERSON_360 §conceptos                                                              | P1                         |
| **Revenue** (via finanzas y ventas)                      | distinguir contratado vs cobrado vs neto                | la decisión de nomenclatura ya ESTÁ tomada (13-oct: adoptar METRICS.md: Contratado / Cobrado (Caja) / Neto) pero la UI sigue con las etiqueta actuales — hueco del PR-6 de SPEC-07, NO de esta SPEC                                                                                                         | `docs/ACTIVE_HANDOFF.md` §DECISIONES, `docs/METRICS.md` §2-5                                                           | P2 (delegada SPEC-07)      |
| **Finance** (/finanzas/*)                                | cash/pnl/cohorte consistentes                           | los filtros por defecto « Todos» aún pueden quedar en 3-4 vistas post-rebase (P3-1 de DASHBOARD_CORRECTION_PLAN, re-verificación pendiente por vista); cohortes inmaduras sin_ETImpedir; comparativas por根本没有 (SPEC-07 PR-7)                                                                            | DASHBOARD_CORRECTION_PLAN P3-1/P4, S1 §6.3                                                                             | P2                         |
| **Data Health** (/finanzas/… y Settings – integraciones) | "¿qué está fallando y qué hago?”                        | 4 luces + checks cruzados + actas EXISTEN (DESIGN: webhooks con silencio≠rotura); NO existe la UI de incidencia (problema→dry-run→aprobación→resultado — delta SPEC-10); los banners del 272 ya evitan mostrar error como cero                                                                              | `lib/data-health/webhooks.ts`, `lib/integrations/health.ts`, SPEC-10 PR-0 (delta H-1–H-5)                              | P1                         |
| **AI Copilot** (agent inline + setting-ai)               | pregunta del negocio → evidencia                        | delinidor 16 tools whitelisted + tenant server-side + brief/auto; NO delivery evidence-first validator ni suggested questions contextuales por pantalla (SPEC-08 H-1/H-3); sin integración visual desde Marketing/Finance/Data Health                                                                       | `app/api/[tenant]/evergreen/ai/agent/route.ts`, `lib/ai/agent/gateway.ts`, SPEC-08                                     | P2                         |
| **Settings** (/settings)                                 | configurar negó/equipo/integraciones                    | aprovisionador de subcuentas doble-guarda correcto (no crear data demo), verificacted workflow vía preview; el onboarding nuevo-cliente NO existe (cuelga de SPEC-13 PR-2/decisiones de venta — no es hueco de la SPEC-14 sin esa decisión); las plantillas de email/gmail/panel de integraciones funcionan | `docs/ROADMAP_MVP.md` §3.5, `lib/tenants/provision.ts`                                                                 | P3 (depende §5 de SPEC-13) |

Notas de no duplicación: `DASHBOARD_AUDIT.md` (25-sep) y el plan de corrección ya contienen la
matriz a BD real de dashboards/analytics — aquí solo se resumen con apuntado, no se repiten.

## 3. Consistencia (hueco mayor consolidable)

1. **KPI cards sin contrato canónico**: cada pantalla define su propio trauma card/estructura de
   datos; hueco señalado en SPEC-07 PR-1 (contrato semántico) y PR-3 (delta visual). Es el fix más
   rentable de esta SPEC: `KpiCard` canónico con nombre/valor/unidad/periodo/comparación/estado
   (adyacente al tipo canónico `MetricValue` de `lib/funnels/types.ts`).
2. **KPI de comparación con denominador feólico**: SPEC-07 pide "no mostrar comparación cuando el
   denominador no permite" — design contract pendiente en PR-3.
3. **Filtros**: URL-state existe (`lib/filters/url-state.ts`, DEFAULT_PERIOD='month' en campañas y
   ventas); "15/19 vistas" el default 'all' peor re-verificable post-rebase (P3-1); falta el
   contrato global de SPEC-07 PR-2 (¿periodo global marcas marketing? el cruzado de Marketing→
   Finance es el caso del §8 del prompt) — política pendiente de decisión en PR-3.
4. **Componentes ui unificados**: las escribas ya están en ALERT/HELP/TOAST/Dialogs ya están
   canónicos (Radix); los restos de variación son por pantalla (.empty, custom views) y aplican PR
   4-8 uno a la vez.
5. **Semantización de color de señal**: rojo/verde/ámbar usados inconsistentes (e.g. morosidad/ cash
   oferte); `accessibility`/semantic tokens del design skill listados en PR-1 para unificar (no
   introducir otra librería, solo tokens).

## 4. Lo que existe y NO se puede deshacer (cubribles, protegido)

- Estados de carga/y de datos canónicos (Skeleton/EmptyState/datos parciales) — el lavoro S1 §6.8
  y #269 ya integra su uso; PRs futuras los REUSENS, no los replantinean.
- Contrato de filtros URL y selección de publicitistas: AUDIT_DATE_FILTERS#318 (f19) cerrado y
  con tests de arquitectura (`tests/tenant-en-consultas.test.mjs`).
- Timeline de contactos (13 eventos, 0 sucios) y/o kanban de pipeline (#decidió de nav.ts).
- No crear otro sistema de diseño ni otra librería (regla 12 del prompt/skill) en nada de esto.

## 5. Plan SPEC-14 adaptado (solo delta; no implementar lo existente))

| Fase                              | Deltas reales                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PR-0** (esta)                   | matrix + inventario + huecos                                                                                                                                                    |
| PR-1 — Design System              | tokens semánticos de colores (no otra lib); `KpiCard` canónico stubable con MES (de SPEC-07 PR-1)                                                                               |
| PR-2 — IA & Layout                | documentation-based (no reógica por codețe); IA Information mapber: 3 conflu Übungen de la nav actual vs el árbol del prompt (la actual está bien: dềpción justific Publishing) |
| PR-3 — Filters & KPI              | contrato global de filtros (SPEC-07 PR-2) + aplicar KpiCard en dashboard/src +Greetings (no re-cooler)                                                                          |
| PR-4 — Command Center & Marketing | variación/diagnóstico + exportaciones con permisos (SPEC-07 §16)                                                                                                                |
| PR-5 — Funnels & VSL              | cohort vs actividad + retención de VSL curva (SPEC-07 PR-5)                                                                                                                     |
| PR-6 — Person 360 & Revenue       | timeline con marketing/VSL (SPEC-06 PR-2); etiquetas DECIDIDAS (leader)                                                                                                         |
| PR-7 — Data Health & AI           | UI incidencia con dry-run/aprobación (SPEC-10) + preguntas sugeridas contexto (SPEC-08 H-1/H-3)                                                                                 |
| PR-8 — Onboarding & Settings      | cuelga de las decisiones SaaS de SPEC-13 §5 (sin decisión, ON_HOLD)                                                                                                             |
| PR-9 — A11y & Perf                | suite de Dx: keyboard nav/E2E a11y + contrast checks + vitals avg gate; medición real antes de optimizar (regla 22)                                                             |
| PR-10 — E2E & visual regression   | las 8 tareas del §24 con fixture (NO de usuarios reales); referencias visuales con el stack Playwright que ya corre                                                             |

Los entregables `INFORMATION_ARCHITECTURE.md`, `DESIGN_SYSTEM_GUIDELINES.md`, `ANALYTICS_UX_CONTRACT.md`, `ONBOARDING_UX.md`, `ACCESSIBILITY_REPORT.md`, `FRONTEND_PERFORMANCE_REPORT.md`,
`UX_TEST_REPORT.md`, `VISUAL_REGRESSION_REPORT.md` corresponden a los PR-2/1/3/8/9/10 — no afronta
la PR-0 (clara y concreta: la matriz §2, el inventario §1 y el plan §5).

## 6. Conclusión PR-0

La aplicación NO está agammada: tiene un sistema real (23 componentes, IA en nav.ts deliberada,
estados de datos honestos, QA visual 1-oct completo, Web Vitals activo). Los deltas UX reales son precisos y testables: (a) KPI-Card canónico (PR-1/3), (b) filtros globales con política de
mix institución (PR-3), (c) Data Health incidencia con dry-run (PR-7), (d) timeline Person 360 con
marketing (PR-6), (e) onboarding — que cuelga de una aktuellen decisión de SPEC-13, y (f)
acessibilidade/utiliza suite de tests (PR-9/10). Ningún rediseño; consolidación incremental con
coordinada con las PRs ya abiertas (SPEC-06/07/08/10) — esta SPEC es la capa de EXPERIENCIA encima
de TODO lo demás, no en paralelo.

# SPEC-08 — AI Growth Intelligence Copilot · Auditoría y línea base (PR-0)
13-oct-2026 · Buffy · rama `feat/spec08-pr0-ai-copilot-audit` sobre `origin/main` (`b71dcf55`)

Especificación: SPEC-08. **La regla final de la spec ya está en el código actual como principio:**
«La IA interpreta resultados calculados por sistemas determinísticos; no sustituye esos sistemas»
es, cita casi literal, la filosofía del gateway existente y del detector de anomalías. Este PR-0
audita con qué se cumple la SPEC-08 hoy, qué falta de verdad y qué PR adicional lo cubre.
Motores SPEC-04…07: solo se consumen; sus PRs de línea base (#479/#481/#482/#483) siguen abiertas.

Clasificación estándar: VERIFICADO (fichero/línea leído), INSPECCIONADO (parcial), PROBADO (test).

## 1. Mapa del sistema de IA ACTUAL

| Pieza de la SPEC-08 | Implementación actual | Estado |
|---|---|---|
| AI Chat / UI | `app/api/[tenant]/evergreen/ai/agent/route.ts` + componente chat; conversaciones en `ai_conversations`/`ai_messages` con RLS por dueño y verificación de pertenencia por subcuenta | VERIFICADO |
| Autenticación + RBAC | `requireTenant` server-side + **cliente autenticado del usuario** (no service role) para las tools de negocio: «el agente nunca tiene más acceso a datos que el propio usuario que lo abrió» | VERIFICADO |
| AI Orchestrator | `lib/ai/agent/gateway.ts`: único punto de tool-use; el modelo elige la tool, el **tenant lo fija este fichero, no el modelo**; `MAX_TOOL_ROUNDS = 4`; timeout 45 s; historial máximo 20 mensajes | VERIFICADO |
| Proveedores LLM | Anthropic o DeepSeek vía endpoint Anthropic-compatible — mismo bucle de tool-use y misma frontera de autorización, elegido por config de la subcuenta; factoría de herramientas y `estimateCostUsd` | VERIFICADO |
| Policy Engine | `lib/ai/agent/growth-operator.ts`: **lista blanca por tool** (`lectura` / `escritura_memoria` / `accion_material`): una tool no listada se trata como acción material y se bloquea; el gateway la comprueba ANTES de ejecutar — «la barrera que manda es la que no se puede persuadir» | VERIFICADO |
| Authorized Tool Layer | ~16 tools tipadas (`tools.ts`, 749 líneas) sobre las tablas canónicas: `getBusinessOverview`, `getFunnel`, `getCampaignPerformance`, `getContacts`, `getContactTimeline`, `searchTranscripts`, `getSales`, `comparePeriods`, `analyzeFunnelChange`, `getTopObjections`, `compareClosers`, `getDataCoverage`, `getRecentInsights`, `recordBusinessFact`, `getMetricDefinition`… con `LIMIT` en cada query y sin SQL libre | VERIFICADO |
| Métricas canónicas | `lib/metrics/consulta.ts` (capa canónica con cash). Los registros de definición (`lib/ai/metrics/registry.ts` + `lib/sources/registry`) describen `docs/METRICS.md` — la IA cita la MISMA definición que las pantallas | VERIFICADO |
| Person 360 / CRM | `getContacts` + `getContactTimeline` (timeline canónica) — el 90 % de las preguntas de entidad ya respondibles hoy | VERIFICADO |
| Data Health | `getDataCoverage` + `calcularSalud`/`entradasSalud` de `lib/metrics` en la ruta | VERIFICADO |
| Evidencia | `ToolEvidence { name, input, summary }` por tool-call, devuelta junto al texto: la respuesta ya trae de qué herramientas salió cada dato | VERIFICADO (parcial, ver H-1) |
| Detección de anomalías | `lib/ai/insights/detectors.ts`: **determinista primero** (umbrales fijos 7d/7d-ante, `fingerprint` + dedup semanal), el LLM SOLO redacta la explicación de la anomalía ya detectada; cron `ai-insights` | VERIFICADO — cumple literalmente el §10/§13 |
| Proactividad | Cron `ai-insights` + insights recientes consultables por tool | VERIFICADO |
| SQL libre | NO existe para el agente (tools tipadas). El servidor MCP (`lib/mcp/sql-executor.ts`) usa role `mcp_reader` con `GRANT SELECT` explícito, transacción `READ ONLY` y rechazo de cualquier no-SELECT/WITH — solo lectura y para integraciones externas | VERIFICADO |
| Coste/latencia | `TurnUsage { tokens, costUsd, latencyMs, rounds }` por turno | VERIFICADO (sin presupuesto por tenant, ver H-6) |

## 2. Huecos (delta que la SPEC-08 añade de verdad)

- **H-1 — Falta el Evidence-First Response Engine (§15/§16).** Las herramientas ya devuelven
  `ToolEvidence`, pero no existe un contrato de respuesta estructurado con
  facts / derived_findings / hypotheses / limitations separados, ni un **validador pre-entrega** que
  verifique frescura, moneda, cobertura y «elimine afirmaciones no respaldadas» (el caso §16:
  conversiones reportadas por plataforma presentadas como ventas canónicas). PR-3.
- **H-2 — Sin intent planner explícito (§5).** El modelo elige libremente entre las ~16 tools; para
  90 % de las seis categorías funciona, pero la clasificación de intención con límites por categoría
  (diagnóstico = más tools permitidas; factual = una tool) y la política de coste asociada no están
  implementados. PR-2.
- **H-3 — Descomposición de cambios incompleta (§9).** `diagnosticarCuelloBotella` /
  `evaluarEscalado` y `comparePeriods` existen y se usan en la ruta, pero la descomposición general
  tipo el volumen × conversión × ticket con la población compartida (y la descomposición financiera
  específica de cash) no está definida como servicio determinista reutilizable. PR-4.
- **H-4 — No hay conjunto de evaluación (§20).** Las 25 preguntas mínimas con respuesta esperada
  (factual accuracy, tenant isolation, prompt injection, conversión reportada ≠ venta canónica…)
  no existen como suite. Es el prerequisito para declarar cualquier DONE_VERIFIED de este módulo.
  PR-10 (con construcción progresiva desde PR-1).
- **H-5 — Prompt injection sin pruebas (§17).** Transcripciones/notes entran como datos y en
  fragmentos (no la transcripción completa; `limit` acotado) — buena práctica que ya está en el
  diseño actual. No hay suite de inyección ni normalización documentada de
  contenido embebido: la frontera de ejecución está en el código (lista blanca + tenant fijado), que
  es la protección estructural correcta, pero el §17 pide tests explícitos. PR-9.
- **H-6 — Presupuesto por tenant ausente (§22).** Coste/latencia se miden (`TurnUsage`) y hay
  límites técnicos (4 rounds, historial 20, timeout 45 s), pero no un presupuesto por subcuenta ni
  bloqueo por exceso. PR-9 (con `docs/FREE_TIER_OPERATIONS.md` como gate).
- **H-7 — Action Center Intelligence (§12).** El dedupe de anomalías por fingerprint semanal ya
  existe en `detectors.ts`; el Action Center con los estados de la spec se revisará cuando la
  proactividad genere acciones que excedan la consulta de solo lectura. PR-8.

## 3. Matriz de auditoría (entregable §3)

| Área | Estado actual | Limitación demostrada | Mejora propuesta |
|---|---|---|---|
| Herramientas | ~16 tipadas, lista blanca, tenant fijado en código | No cubre breakpoints por segmento/campaña de la §6 completa | PR-1: contratos completos con esquemas de respuesta × estado |
| Métricas | vía `lib/metrics/consulta.ts` (capa canónica) y `getMetricDefinition` que describe METRICS.md | La definición no incluye versiones | PR-1: metric_version en el contrato del §7 |
| Autorización | requireTenant + cliente usuario + lista blanca en código | Sin vistas previas de destino para acciones futuras (escritura) | PR-9: flujo de aprobación explícito de §18 |
| Razonamiento | selección libre de tools, diagnóstico vía `cuello-botella`/`comparePeriods` | Sin intent planner ni descomposición general | PR-2/PR-4 |
| Evidencia | `ToolEvidence` por tool-call | Sin validador numérico pre-entrega ni separación hecho/hipótesis | PR-3 |
| Evaluación | suite ausente | — | PR-10: dataset de 25 preguntas + métricas de invención |

## 4. Plan de fases (adaptado: solo el delta)

| Fase | Cubre | Sobre qué existente |
|---|---|---|
| **PR-0** (este) | Auditoría y línea base | docs |
| PR-1 — Canonical Tool Contracts | Esquemas de respuesta con `data_status`/`freshness_at`/`metric_version`; huecos de cobertura (tools de sin atribuir, VSL y refunds por tool) | gateway + tools existentes |
| PR-2 — Intent & Query Planning | Clasificador de las 6 categorías del §5 con límites de tools por categoría | gateway |
| PR-3 — Evidence Validation | Contrato de respuesta con separación hechos/hallazgos/hipótesis + validador numérico pre-entrega | `ToolEvidence` existente |
| PR-4 — Diagnostic Engine | Descomposición determinista general (volumen/conversión/ticket) + financiera de cash | `cuello-botella`/`comparePeriods` |
| PR-5 — Anomaly Detection | Ampliar baselines de `detectors.ts` a las 25 señales de la §10 | detectors existente |
| PR-6 — Recommendation Engine | Recomendaciones sin impactos económicos inventados; estructura de la spec §11 | insights existentes |
| PR-7 — AI Chat Experience | Contexto de página respetando los filtros autorizados; su selección de periodo | ruta + chat UI existentes |
| PR-8 — Proactive Intelligence | Briefing/Review con dedupe por fingerprint ya presente; acciones solo con aprobación | cron `ai-insights` + Action Center |
| PR-9 — Security & Cost | Suite de inyección (§17), presupuesto por tenant, redacción de PII, auditoría de llamadas | `sql-executor` como base + flujo de aprobación |
| PR-10 — Evaluation & Hardening | Dataset de las 25 preguntas (§20) con métricas de invención, permisos y aislamiento | tests/e2e existentes |

## 5. Limitaciones

- Auditoría de lectura (código de `origin/main` `b71dcf55`) — la descripción no incluye pruebas
  reales contra el LLM de producción (coste y latencia medidos existen como `TurnUsage` pero no se
  capturaron p95 de sesión en esta PR).
- Las PRs de SPEC-04…07 siguen abiertas y definen la superficie exacta de contratos que PR-1
  consumirá (`data_status`, estados de calidad, fuentes); coordinación por tablero del handoff.
- El dataset de evaluación (PR-10) se construirá en vivo sobre las suites existentes
  (`tests/metrics`, `tests/e2e`) — no se inventa un corpus reproduciendo conversaciones reales.

# SPEC-10 — Data Health & Controlled Self-Healing · Auditoría y línea base (PR-0)
13-oct-2026 · Buffy · rama `feat/spec10-pr0-datahealth-audit` sobre `origin/main` (`b71dcf55`)

Especificación: SPEC-10. **Una parte sustancial del módulo ya existe y tiene reglas filosóficas
escritas en código** — «silencio no es rotura demostrada», «un hueco no es un cero», «sin configurar
no avisa» — que son exactamente el espíritu del §5 de la spec. Este PR-0 mapea los checks reales,
define qué le falta al control de la calidad (incidencias, diagnóstico y reparación controlada) y
mapea el delta. Los motores SPEC-04…09 solo se supervisan; sus PRs (#479/#481/#482/#483/#484/#485)
siguen abiertas.

Clasificación: VERIFICADO (fichero/línea), INSPECCIONADO (parcial), PROBADO (test). Sin datos de
producción en la sesión (credenciales borradas por higiene); conteos históricos heredados del
25-sep con nota de re-verificación.

## 1. Matriz del §2 — señales y checks REALES por sistema

| Sistema | Señales disponibles | Checks existentes | Cambio necesario |
|---|---|---|---|
| **Webhooks (ingesta)** | Evidence de recepción real: sobres en `raw_events` y actas en `audit_logs`; integración viva, ID de recepción de 24 h | [lib/data-health/webhooks.ts](../lib/data-health/webhooks.ts): 4 estados (`al_dia`/`silencio`/`sin_configurar`/`desconocido`) con la regla «silencio ≠ rotura»: 24 h sin recepción avisa en ámbar, no en rojo | PROBADO (tests de sobres-webhooks) |
| **Sincronizaciones (pull)** | `integration_sync_runs`: deadline interno, requisitos, veredicto con razón, `SyncBusyError` reintentable, concurrencia | [lib/integrations/sync-runs.ts](../lib/integrations/sync-runs.ts) + `lib/ops/sync-health`: evaluación por cron de cada sync con clasificación de errores reintentables | VERIFICADO |
| **Integraciones (conectores)** | Comprobaciones reales contra API (comprobarYGuardar por subcuenta y provider, TTL 24 h, botón por integración y no las 17 por visita) | [lib/data-health/conectores.ts](../lib/data-health/conectores.ts) + [lib/integrations/health.ts](../lib/integrations/health.ts): 4 luces (`conectada`/`parcial`/`sin_configurar`/`error`) — «parcial» existe para no pintar todo en rojo por un solo fallo reintentable; fixFor (el arreglo concreto de la comprobación, sin parsear mensajes) | VERIFICADO |
| **Tracking/attribution** | Filas de atribución defectuosas, filas sin `contact_id`, origen de contactos y webs | [lib/data-health/cross-source.ts](../lib/data-health/cross-source.ts): 10 tipos de check (`meta_cuenta_sin_datos`, `campana_cuenta_no_seleccionada`, `pago_stripe_sin_venta`, `pago_stripe_sin_cobro`, `cobro_de_pago_devuelto`, `venta_sin_contacto`, `cliente_sin_emparejar`, `campana_sin_atribucion`, `agenda_sin_contacto`, `llamada_sin_agenda`) con mensaje honesto y acción propuesta | VERIFICADO |
| **CRM/identidad** | duplicados, contactos sin atribuir, llamadas sin agenda (en cross-source) | mismos checks; relación ambigua → cola humana (fathom) | VERIFICADO (parcial, ver H-3) |
| **Sales/cash** | espejo Stripe vs cobros internos vs reconciliación | `pago_stripe_sin_venta/sin_cobro` + detección de archivo de reconciliación (`lib/finance/reconciliation`); cash con dedup test | VERIFICADO |
| **Dashboards/KPIs** | en la ruta `settings/data-health/route.ts` se consolidan webhook/cross-source/conectores; sin comparativas inter-pantalla de KPI | — | **H-1** (delta) |
| **IA interna** | `getDataCoverage` como tool; anomalías deterministas en [detectors.ts](../lib/ai/insights/detectors.ts) (ROAS/funnel) con dedupe por fingerprint semanal | — | copiloto conectable con las tools de salud; también delta de PR-9 |

## 2. Huecos (delta que la SPEC-10 añade de verdad)

- **H-1 — Sin catálogo versionado ni comparativas de KPI (VERIFICADO).** Los checks están sabios y
  bien escritos pero DISTRIBUIDOS en 3 módulos + sync-runs sin una ficha común (check_id, umbral,
  severidad, denominador, runbook) ni una comprobación de consistencia entre pantallas — el §13
  (una métrica con definiciones distintas en dos pantallas) no tiene ningún mecanismo hoy; el delta es el
  catálogo declarativo y un motor de reconciliación de KPIs. PR-1/PR-4.
- **H-2 — Sin gestión de incidencias (VERIFICADO por ausencia).** Grep de `incident`/`repair`/
  `dry_run` en `lib/` y `app/`: **0 resultados**. Las Señales de la SPEC quedan recomuestas en el
  historial: la única agrupación persistente de incidencias es el fingerprint semanal del detector
  de anomalías IA (dedupe de insight, no de diagnóstico) y los resets de sync-runs. Falta tabla de
  motivoformes con estado/first-last seen/severidad/evidencia/plan de reparación (§14), excepto
  pantalla (§24) y dedupe manual ya existente (settings/data-health/dedupe). PR-5.
- **H-3 — Sin motor de reparación controlada (VERIFICADO por ausencia).** Existen los MECANISMOS de
  reparación ad hoc que las fases repetirán: replay (dry-run, cursor, idempotente, SPEC-04),
  backfills con claim atómico (regla del repo), y un dedupe manual con vista previa (GET) + efecto
  (POST) en la ruta de data-health. Falta la capa CONTRATO: política de niveles (§17), plan
  versionado con precondiciones/diff/rollback (§18), locks por scope, verificación post-reparación
  y auditoría con correlation_id. PR-7/PR-8 se construyen ENCIMA de esos mecanismos, no sobre cero.
- **H-4 — Sin score de salud (§23) y sin métricas operacionales (§26).** La vista actual es por
  integración; el score global necesita metodología documentada (pesos, umbrales, checks elegibles) y
  MTTD/MTDR/tasa de falsos positivos no existen. PR-9.
- **H-5 — Severidad para el negocio (§15) parcialmente cubierta (cross-source clasifica con
  severidad en pantalla) pero sin marco de impacto formalizado (KPIs afectados, revenue en riesgo).
  PR-6.

## 3. Plan de fases (adaptado: solo el delta)

| Fase | Cubre | Sobre qué existente |
|---|---|---|
| **PR-0** (este) | Auditoría y matriz | docs |
| PR-1 — Health Check Registry | Catálogo declarativo (check_id/umbral/severidad/denominador/runbook) versionado que envuelve los módulos existentes | lib/data-health + sync-runs |
| PR-2 — Tracking & Attribution Health | Checks de cobertura con denominadores elegibles (session-to-lead, UTMs pagado vs orgánico, paid-to-organic) | cross-source + detector |
| PR-3 — Identity & Appointment Health | Coberturas de reflejo (agenda sin contacto, reprogramación mal enlazada, resultados desconocidos) | cross-source + citas |
| PR-4 — Sales & Finance Health | Consistencia cash (pago huérfano/venta colgada) y agrupación de checks; distinguir pagos legítimos sin venta que requieren otra clasificación (§22) | reconciliation + cross-source |
| PR-5 — Incident Management | Entidad de incidencias con clave estable, estados, severidad configurable | fingerprint pattern existente |
| PR-6 — Root Cause & Impact | Diagnóstico con verificación por check cerrado + KPIs afectados | SPEC-08 copiloto |
| PR-7 — Dry-Run & Repair Plans | Contrato de planes de reparación con diff, precondiciones y expiración | replay dry-run (SPEC-04) |
| PR-8 — Controlled Repair Execution | Executor con idempotencia/locks/verificación post/auditoría — Niveles 0-3 de la spec §17 | replay + backfills + dedupe ruta |
| PR-9 — Health UI & AI Copilot | Dashboard de salud con incidencias y score metodología documentada | settings/data-health UI |
| PR-10 — E2E | 35 fixtures del §27 reutilizando como base los tests existentes | tests/data-health-* |

## 4. Limitaciones

- Las coberturas numéricas se heredan del marco con BD real del 25-sep; se re-verifican en PR-2+ cuando
  se tocan pantallas de salud con datos frescos.
- La reparación Nivel 3 (financiera/identidad) se implementará SOLO con flujo de aprobación explícito;
  el PR-0 no propone ejecutarla — coincidencias con la regla del repo de claim antes de efecto
  irreversible y las reglas de la SPEC-08 (IA no ejecuta).
- Investigación de proveedores (infraestructura externa de observabilidad) NO hace falta hoy: los checks se
  ejecutan sin infraestructura nueva (regla §1.19).

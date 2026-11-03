# SPEC-09 — Revenue Operations Intelligence · Auditoría y línea base (PR-0)
13-oct-2026 · Buffy · rama `feat/spec09-pr0-revenue-audit` sobre `origin/main` (`b71dcf55`)

Especificación: SPEC-09. La base canónica del money ya existe y está documentada ([MONEY.md](MONEY.md),
[SALES_METRICS_MAP.md](SALES_METRICS_MAP.md), [METRICS.md](METRICS.md), `lib/canonical/cash.ts`
testeado). Este PR-0 audita las SEIS entidades de la matriz del §2 contra el esquema real y ubica el
delta que las auditorías SPEC-04…08 no cubrieron: asignación de setters, ciclo de oportunidad,
facturación, suscripciones y disputas.

Clasificación: VERIFICADO (fichero/línea), INSPECCIONADO (parcial), PROBADO (test). Sin datos de
producción en la sesión (credenciales borradas por higiene): los conteos de cobertura parten de la
auditoría de BD del 25-sep ([DASHBOARD_AUDIT.md](DASHBOARD_AUDIT.md)) y se re-verifican con fixtures.

## 1. Matriz de entidades (entregable del §2)

| Entidad | Fuente actual | Identificador | Estados | Consumidores | Riesgos |
|---|---|---|---|---|---|
| **Lead** | `contacts` (con `first_seen_at`, `leadDate()`, `qualification`, `last_contacted_at`, `pipeline_stage` interno) | `contact_id` por tenant | estados comerciales vía `followup_stage` + `qualification`; sin modelo NEW/ASSIGNED/CONTACTED canónico (H-3) | CRM, Funnels, atribución, IA | estados de la spec no mapeados 1:1; el auditor del 25-sep ya detectó `setter` 0/610 (ver H-2) |
| **Setter Activity** | eventos y campos dispersos: `last_contacted_at` (contactos), `appointment_type`/`event_type` (agenda), métricas de `lib/metrics/{consulta,agregados}.ts` | `setter_id` en `contacts`/`appointments` | sin estados VERIFY CONTACT/ENGAGED/QUALIFIED; el tipo "contactado" NO está precisado | Ranking/scorecard, IA | **H-2**: cobertura `setter_id` 0/610 (NOT_TRACKED en BD real 25-sep); asignación de leads a setters sin mecanismo legible |
| **Appointment** | `appointments` (+ refs externas `ext:source:id`, `external_source`) | external_id + dedup `cs:contacto:minuto` | `status` con 9 estados + `rescheduled_from_status` + `origin_appointment_id` (reprogramación enlazada) | Funnels, CRM, comisiones, IA | cobertura de `result` 4/610 y `offered` 3/610 (NOT_TRACKED real, no muestra 0%) |
| **Opportunity** | **NO existe como actividad** | — | — | — | **H-1**: el ciclo del §10 (OPEN→WON/LOST) no tiene tabla ni estados en el esquema; lo más cercano son campos de la agenda (`offered`, `pipe_value`, `payment_deal`) y `sales.opportunity_id` como clave OPCIONAL de dedup (`lib/canonical/dedup.ts:199`) que el modelo tipado no declara |
| **Sale** | `sales` (`isActiveSale`: `active|partial_refund`; excluye `refunded/chargeback/cancelled`) + dedup con (opportunity_id) o (contacto+fecha+importe) | `sale_id` | 5 estados con etiquetas | dashboards, comisiones, IA | dedup probado; el derivado de una venta sin agenda usa `chooseSaleAppointment` (#478) |
| **Invoice** | **NO existe la entidad** | — | — | — | **H-4**: el plan de cobro vive en `sale_expected_installments` (programado); no hay concepto "Billed Revenue". Decisión BUSINESS: definir factura o declarar NOT_APPLICABLE |
| **Payment** | `collections` (hechos internos) + `stripe_payments` (espejo) deduplicados por `canonicalCash` (payment_reference/charge_id) | `payment_id`/`charge_id` | collected / pending + reversos; 'reversed'/'disputed' ni suman ni restan | Finance, Dashboard, comisiones | PROBADO (tests de cash-refunds); la dudosa venta sin pago y el pago sin venta ya son checks de Data Health |
| **Refund** | `refunds` ('processed' resta del cash) + `sales.status` refunded/partial_refund + Stripe amount_refunded + `reservation_refund_requests` (reservas) | `refund` sobre `collection_id` | processed/pendiente | cash canónico, morosidad | PROBADO parcial; sin entidad de disputa (H-5) |
| **Chargeback/Dispute** | `sales.status='chargeback'` existe como estado; en cash el reverso NO se cuenta doble | — | — | P&L | **H-5**: sin flujo de disputa como entidad aparte; el tratamiento anti doble descuento está en cash.ts (líneas 224/229) |
| **Subscription** | `stripe_customers` (status `active_mensual|moroso|cancelado`, `subscription_id`, `current_period_end`) | stripe_customer_id | cache de estado de cobro | base de clientes | **H-6**: sin métricas de renovación/MRR ni política de atribución de renovaciones (§16); no cada renovación es adquisición nueva |

## 2. Hallazgos (delta real frente a SPEC-04…08)

- **H-1 — Oportunidad no es entidad gestionada (VERIFICADO).** No hay tabla de `opportunities`; la
  "posibilidad" comercial se vive hoy en campos de la agenda (`offered`, `pipe_value`,
  `qualification`) y la venta acepta un `opportunity_id` opcional solo como llave de dedup. El
  ciclo del §10 (reabierta, cambio de importe, historial de stages) no existe. PR-3 debe decidir
  si se introduce como entidad mínima versionada o se declara que el modelo real es
  Agenda-ofrecida → Venta, documentando la equivalencia. NO crear tabla si la decisión BUSINESS dice
  que no hace falta.
  **DECIDIDO (usuario, 13-oct-2026): sin tabla — equivalencia declarada.** El modelo real del negocio
  es Agenda-ofrecida → Venta; se documenta la equivalencia (campos `offered`/`pipe_value`/`payment_deal`
  + dedup de venta con `opportunity_id` opcional) y NO se crea `opportunities`. PR-3 entrega la
  equivalencia escrita y el histórico de closer sobre `appointments` + `sales`, sin toque de esquema.
- **H-2 — Asignación a setters sin cobertura (VERIFICADO por la auditoría 25-sep).** Los KPIs del
  §5/§6 (assigned, contacted, contact rate) son imposibles hoy: `setter_id` 0/610, y la actividad
  (`Contact Attempts`) no tiene eventos dedicados — solo `last_contacted_at` y métricas derivadas.
  La regla de la spec («asignado ≠ contactado») no es aplicable todavía sin Datos. PR-1: definir
  qué evento acredita cada estado del §5 con los campos existentes, y USER_ACTION para poblar
  asignaciones (o integración GHL).
- **H-3 — Categoría de estados de lead no canónica (VERIFICADO).** `followup_stage` (6 valores) +
  `qualification` cubren parcialmente el ciclo del §5 pero no está formalizada una historia de
  estados con fecha (quién/definió). La timeline del §5/§6 muestra la actividad; el estado
  "ASSIGNED/CONTACTED/ENGAGED" va a requerir un mapeo documentado, no reinterpretaciones.
- **H-4 — Billed Revenue no existe (VERIFICADO).** Ni tabla de facturas ni concepto facturado:
  el plan de cobro (installments programados) cubre la parte predecible y `collections`/`stripe_payments`
  cubren el cobrado. Si el negocio no usa facturación integrada, declarar la métrica como
  NOT_APPLICABLE en el catálogo; si lo usa vía Stripe Invoices, el espejo no lo trae — pesquisa de
  PROVEEDOR en PR-5, no desde memoria.
  **DECIDIDO (usuario, 13-oct-2026): Billed Revenue = NOT_APPLICABLE.** Se declara en el catálogo
  (SPEC-07 `getMetricDefinition`): el plan de cuotas programado + el cobrado cubren el ciclo
  predecible → real. Sin entidad de facturas ni espejo de Stripe Invoices en PR-5; si el negocio
  empieza a facturar integrado más adelante, la decisión se reabre con pesquisa de proveedor, no
  antes.
- **H-5 — Disputas sin entidad (VERIFICADO la base, INSPECCIONADO el flujo).** Las compras están
  protegidas de doble descuento en cash (el reverso es la MISMA fila; 'disputed' ni suma ni resta),
  pero no existe flujo de disputa como estado con fecha/proceso — el §15 de la spec pide un
  tratamiento explícito. PR-5.
- **H-6 — Suscripciones sin métricas de ciclo (VERIFICADO como hueco).** `stripe_customers` tiene
  `subscription_id`/`active_mensual`, pero no hay renovaciones como eventos de cash ni política de
  atribución de renovaciones. Solo si el negocio las usa (decisión), PR-6.
- **H-7 — Lead/Setter: denominadores ya definidos (PROBADO).** El fan de métricas de
  `lib/metrics/operativo.ts` ya separa los `atribuidos` y `NOT_TRACKED` (hueco≠cero), y la
  pantalla de ranking, la del 25-sep, aplica muestra mínima (P1-2). PR-1 las toma como base.

## 3. Plan de fases (adaptado: solo el delta)

| Fase | Cubre | Sobre qué existente |
|---|---|---|
| **PR-0** (este) | Matriz de entidades + huecos | docs |
| PR-1 — Lead & Setter Integrity | Estados del §5 credibles con datos REALES (evento ⇒ estado); asignación | contacts + metrics |
| PR-2 — Appointment Lifecycle | Contrato de timestamps `booked/scheduled/cancelled/rescheduled/attended_at`; KPI reservas neto vs reuniones | citas-sync + status.ts |
| PR-3 — Closer & Opportunity | Decisión BUSINESS: mínimo ciclo de oportunidad o equivalencia declarada; histórico de closer | appointments + sales |
| PR-4 — Sale Reconciliation | Reutiliza dedup probado; ventanas de dedup y venta sin agenda | canonical/dedup + #478 |
| PR-5 — Payments & Cash | Invoices de Stripe (si business), disputas como entidad, conciliación completa | canonical/cash + stripe mirror |
| PR-6 — Renewals & Recurring | Renovaciones como cash separado o NOT_APPLICABLE; política de atribución | stripe_customers |
| PR-7 — Revenue Dashboards | Funnels de actividad vs cohorte (ya existentes), orange revenue dashboards | SPEC-07 base |
| PR-8 — AI Revenue Copilot | tools de SPEC-08 conectadas a las métricas de este módulo | gateway + detectors |
| PR-9 — Data Health | Coberturas del §22 reales (setter, closer, outcome, enlace venta-pago) | data-health existente |
| PR-10 — E2E | 40 fixtures del §24 reutilizando los ya probados del cash/dedup/status | tests existentes |

## 4. Limitaciones

- Coberturas de producción (setter 0/610, result 4/610, offered 3/610) son del 25-sep con BD real;
  tras #478/#480 no se re-midiere — se re-verifican en PR-1+ con datos frescos si se tocan esas
  pantallas.
- Las decisiones BUSINESS de H-1 (Opportunity) y H-4 (facturación) fueron tomadas por el usuario el
  13-oct-2026 y están registradas en su hallazgo correspondiente; PR-3 y PR-5 ya tienen desbloqueo.
- Documentación de proveedores (Stripe Invoice/Refund/Dispute) en PR-5 con fuentes oficiales, no desde memoria.

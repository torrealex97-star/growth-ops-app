# SPEC-06 — Customer Journey Intelligence & Person 360 · Auditoría y línea base (PR-0)
13-oct-2026 · Buffy · rama `feat/spec06-pr0-person360-audit` sobre `origin/main` (`b71dcf55`)

Especificación: SPEC-06. **PRESERVE → DISCOVER → REUSE → EXTEND → TEST → VERIFY es literalmente la
arquitectura del módulo que ya existe:** la timeline de contacto es una vista de lectura sobre las
tablas canónicas «sin escribir a canonical_events ni tocar el pipeline» ([lib/contact-timeline.ts](../lib/contact-timeline.ts)).
Este PR-0 audita qué está hecho, qué falta y qué solo hay que conectar. Los motores de datos
(SPEC-04) y de atribución (SPEC-05) no se tocan; sus líneas base (PRs #479/#481, abiertas) son
insumos: PR-1+ de este módulo **consumirá** sus contratos.

Clasificación: **VERIFICADO** (fichero/línea leída en `origin/main`), **INSPECCIONADO** (parcial,
pendiente), **PROBADO** (test de regresión existente). Sin datos de producción en la sesión
(credenciales borradas por higiene): los casos de registros reales se cierran con fixtures en PR-1+.

---

## 1. Mapa real del grafo (frente al modelo del §2 de la spec)

```text
ANONYMOUS VISITOR ──(vsl_viewer_identities, viewer_id)──> SESSION
       │                                                   │
       v (tracking_events / vsl_watch_intervals)           v
 TOUCHPOINTS/UTM (contact_attributions: first/last/booking)
       │
       ▼
 CANONICAL PERSON = contacts  ◇─── lib/contacts/resolve.ts (niveles A/B de la spec)
       │  «Ninguna fusión por parecido» ya es regla del repo (lib/fathom/match.ts)
       ├──> CRM CONTACT — página real: app/[tenant]/crm/contactos/[id]/page.tsx (1531 líneas)
       ├──> TIMELINE — lib/contact-timeline.ts (buildContactTimeline): 13 tipos de evento
       │    attribution · created · appointment · transcript · recording · activity
       │    contract · sale · payment · delinquency · csm · feedback · note
       ├──> CONVERSATIONS — lib/ghl/conversaciones-metricas.ts (GHL, agregadas por tenant)
       ├──> APPOINTMENTS — external_source/external_id, actas de cancel/reprogramación
       │    (citas-sync + audit_logs; agenda canónica ext:source:id)
       ├──> OPPORTUNITIES — sales.opportunity_id; resolver por identidad (#464)
       └──> SALE → COLLECTIONS/sale_expected_installments → stripe_payments
            + stripe_customers (cache de estado real de cobro, vínculo por email)
              + canonicalCash (devices deduplicados Stripe/interno + refunds)
```

Relaciones 1:N asumidas como negocio (varias agendas, varios pagos, varios touchpoints): ya
representadas en las tablas mencionadas; ninguna colapsada en «una fila que sobrescribe» salvo el
primer toque de atribución, que es inmutable por diseño (SPEC-05 H-0).

---

## 2. Qué YA cumple la spec (verificado)

| Requisito de la SPEC-06 | Implementación actual | Estado |
|---|---|---|
| Timeline cronológica por persona con fecha de ocurrencia (§7) | `TimelineEvent.occurredAt` por hecho; los retrasos se ordenan por ocurrencia en cada proveedor (`citas-sync`, `lib/eventos`), y `raw_events` conserva recibido/ocurrido | VERIFICADO |
| No convertir cambio técnico en evento comercial (§6) | 13 tipos de evento, todos con entidad detrás; sin «session started» ni ruido técnico en la timeline | VERIFICADO |
| Agendas: reprogramadas/canceladas con historial y sin duplicar KPI (§12) | estados del proveedor en `lib/appointments/status.ts` + actas en `audit_logs`; «dos agendas legítimas» quedó reclamado por SPEC-04 PR-3 | VERIFICADO |
| Ventas/pagos/refunds sin duplicar importe (§14) | `canonicalCash` deduplica Invoice/PaymentIntent/Charge vía payment_reference/charge_id; venta ≠ pago; refunds separados (`sales.status` refunded/partial_refund/chargeback) | PROBADO (tests de cash-refunds) |
| Timeline accesible desde la IA con permisos del usuario (§17/§23) | `getContactTimeline` en `lib/ai/agent/tools.ts`: tenant cerrado en `ToolContext` (resuelto por `requireTenant` server-side), solo lectura, LIMIT en cada query, sin capa paralela | VERIFICADO |
| No usar LLM para calcular revenue (§1.11) | herramientas de solo lectura; el importe sale de las tablas (canonicalCash), la IA solo explica | VERIFICADO |
| VSL: consumo real sin sumar rebobinados (§10) | `vsl_watch_intervals` por intervalo con `sequence_number`; playheads y duraciones en `vsl_tracking_events`, conceptual con `occurred_at`/`received_at` separados. KPIs por contacto: INSPECCIONADO | VERIFICADO (modelo), INSPECCIONADO (consumo por persona) |
| Identidad estable con referencias externas (§3/§5) | contacts (CRM) + appointments (external_id) + `stripe_customers(stripe_customer_id, contact_id)` + atribuciones con `evidence_source`; `vsl_viewer_identities` como tabla de identidad del visor | VERIFICADO |
| Aislamiento tenant (§19-30) | RLS + invariante testada (`tests/esquema-tenant-invariante.test.mjs`, atribucion-aislamiento, colaboradores-aislamiento) | PROBADO |

---

## 3. Huecos (los cambios mínimos del plan)

- **H-1 — El perfil no integra el journey de MARKETING ni VSL (VERIFICADO).**
  `buildContactTimeline` compone attribution/appointment/sale/payment/notes/csm, pero **no consulta
  `tracking_events`, `vsl_playback_sessions`/`vsl_watch_intervals` ni `canonical_events`**: las
  páginas vistas, el VSL consumido y los toques de sesión no aparecen en la timeline del contacto.
  Es el hueco central de la spec (§9/§10) y **no es una pantalla nueva**: extender el servicio
  canónico existente con los eventos ya canónicos, sin escribir en las tablas fuente.
- **H-2 — Conversaciones: métricas agregadas, no por persona (VERIFICADO).**
  `lib/ghl/conversaciones-metricas.ts` calcula métricas de conversaciones GHL por tenant/campaña;
  no existe timeline de conversaciones por contacto. Extensión en PR-6 solo con proveedores reales
  (GHL hoy; Calendly-OAuth no aporta). No inventar mensajes; contenido solo a autorizados.
- **H-3 — Tarjetas/journey de etapas con estados observado/completado/desconocido (§15) (INSPECCIONADO).**
  La página de detalle ya existe y es completa (1531 líneas); el «journey visualization» con etapas
  y estados es una extensión UI sobre los datos de H-1, no una segunda app.
- **H-4 — Herramientas IA de persona parciales (VERIFICADO).**
  Existen `getContacts`, `getContactTimeline`, `getSales`, `searchTranscripts`, `getDataCoverage`.
  Faltan por persona: actividad VSL, pagos/cash neto (hoy `getSales` no pulveriza payments) y
  `explain_person_attribution` con rutas de evidencia. Ambas se añaden EN el gateway existente.
- **H-5 — Data quality por persona sin dimensiones (§21) (INSPECCIONADO).**
  `getDataCoverage` es global; la columna `identity_status`/links pendientes por persona no existe.
  Se hereda del tablero de especs anteriores (SPEC-04 PR-7).

---

## 4. Casos límite (§19) contra lo ya testado

| Caso | Estado hoy |
|---|---|
| Anónimo → identificado (1) / nunca identificado (2) | Cubierto por modelo VSL (`vsl_viewer_identities`, `video_viewer_identified`); consumo por persona: PR-3 |
| Varias sesiones (3), varias agendas (9) | 1:N estructural en tablas; KPI sin colapsar (SPEC-05) |
| Email compartido (5), duplicados (6), fusionados (7) | Cola humana (fathom) + reglas fuertes (SPEC-04 H-4 email compartido como INSPECCIONADO) |
| Tres proveedores una agenda (10) | Agenda canónica con referencias ext:source:id — VERIFICADO |
| Reprogramada (11), cancelada (12), no-show (13) | Extendido a PROBADO (labels + actas) |
| Venta tras varias agendas (15) | `chooseSaleAppointment` + regla declarada en #478 |
| Pago antes de sync de venta (17) | Resuelto vía Stripe-first + cola humana (#270) |
| Pago parcial (18), refund (19), renovación (20) | `canonicalCash` + `sale_expected_installments` — PROBADO parcial |
| VSL multi-dispositivo (21) | viewer_id + session_id por playback — INSPECCIONADO detalle intervalos |
| Lead Ads sin web (25), IG DM sin anuncio (26) | Igual que SPEC-05 (no session inventada) |
| Dos tenants mismo email (30) | PROBADO (aislamiento por tenant en las invariantes) |

La suite completa de 30 se construye como fixtures del §24 en PR-9; no duplicar nada ya testado.

---

## 5. Plan por PRs (adaptado: nada de motor nuevo)

| Fase | Cubre | Sobre qué existente |
|---|---|---|
| **PR-0** (este) | Auditoría y mapa | docs |
| PR-1 — Identity Integrity | Email compartido/cambiado, `identity_status` y revisiones | `resolve.ts` + `stripe_customers` (vínculo por email con guard) |
| PR-2 — Canonical Journey | H-1: timeline consume tracking/VSL/canonical_events; cursor y filtros del §20 | `buildContactTimeline` (único servicio timeline) |
| PR-3 — Marketing & VSL Journey | VSL por persona (consumo, milestones, CTA), touchpoints en timeline | modelo VSL PR-1b completo |
| PR-4 — Appointment Journey | Casos 9-15 ya en tabla; UX de agenda asociada | citas-sync + status.ts |
| PR-5 — Sales & Financial Journey | Cash neto por persona, pagos parciales, refunds | canonicalCash + sales/collections |
| PR-6 — UX Person 360 | Tarjetas, filtros, journey de etapas, panel de evidencia | página CRM existente |
| PR-7 — IA Person Intelligence | VSL, pagos y explain_person_attribution | `lib/ai/agent/tools.ts` (tenant cerrado) |
| PR-8 — Health & Reconciliation | Completitud por persona, vínculos pendientes | data-health |
| PR-9 — E2E & Hardening | Suite de 30 casos, aislamiento, rendimiento | tests/e2e |

## 6. Limitaciones

- Auditoría de lectura sobre `origin/main` `b71dcf55`; sin datos de producción (credenciales borradas
  por higiene en sesiones anteriores). Los «casos reales» se verifican con fixtures en PR-1+.
- Las PRs abiertas #479 (SPEC-04) y #481 (SPEC-05) son mías: sus capas de estados
  (touchpoints, modelos) determinarán los consumibles exactos de PR-2/PR-3; se coordina por tablero.
- La investigación documental oficial de proveedores (Bunny Stream, GHL) se hará a demanda en PR-3
  solo para los detalles de API realmente usados, no desde memoria.

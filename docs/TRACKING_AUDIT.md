# SPEC-03 — Tracking Integrity Audit

Baseline forense de `codex/tracking-integrity`, 13-oct-2026. Este documento registra hechos
verificados en código y consultas agregadas de solo lectura sobre producción. No sustituye los
payloads RAW ni autoriza correcciones históricas.

## Estado

- Fase: `PR-0 Baseline forense` + dos correcciones seguras de causa raíz.
- Tenant de muestra: `women-digital-closer`.
- Sin DDL, backfill ni mutaciones en producción.
- Clasificación global: `PARTIAL`.

## Fuentes y entidades canónicas

| Hecho                 | Fuente canónica                                | Evidencia auxiliar                                     | Fecha de negocio             |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------ | ---------------------------- |
| Persona/lead          | `contacts`                                     | IDs, email/teléfono normalizados, `identity_matches`   | `first_seen_at`/`created_at` |
| Agenda                | `appointments`                                 | Calendly, GHL, CRM manual, payload original            | `appointment_datetime`       |
| Asistencia/no-show    | estado explícito en `appointments`             | Fathom puede aportar evidencia, no sustituye el estado | fecha de la agenda           |
| Venta                 | `sales`                                        | oportunidad/agenda/contacto enlazados                  | `sale_date`                  |
| Cobro                 | `collections` y conciliación `stripe_payments` | IDs de transacción/charge/payment                      | `collected_at`/`paid_at`     |
| Touchpoint            | `analytics_touchpoints`                        | URL, referrer, UTMs, click ID, consentimiento          | `occurred_at`                |
| Resumen de atribución | `contact_attributions`                         | first/last observados; no contiene todos los click IDs | first/last touch             |
| Evento first-party    | `raw_events` → `canonical_events`              | payload, idempotency key, processing status            | `occurred_at`                |

`google_calendar_events` es un espejo operativo para el calendario personal. No es fuente de
agendas comerciales ni de KPIs y, en la muestra, tiene 0 filas.

## Recorrido real

```text
landing / VSL / formulario
  → analytics_sessions + analytics_touchpoints
  → contacts + contact_attributions
  → appointments (Calendly / GHL / manual)
  → estado explícito show | no_show | cancelled | pendiente
  → sales
  → collections ↔ stripe_payments
  → commissions
```

La procedencia administrativa del registro (`external_source = calendly|ghl`) no es una fuente de
adquisición. La ausencia de UTM tampoco demuestra `organic`, `direct` o `website`.

## Baseline agregado de WDC

| Medida                              | Resultado |
| ----------------------------------- | --------: |
| Agendas físicas                     |       691 |
| Calendly                            |       588 |
| GHL                                 |       103 |
| Contactos distintos con agenda      |       542 |
| Sin contacto                        |         0 |
| Sin closer                          |         0 |
| `show`                              |       360 |
| `cancelled`                         |       253 |
| `scheduled`                         |        49 |
| `no_show`                           |        22 |
| `confirmed`                         |         7 |
| Con UTM plana en la agenda          |       105 |
| Con snapshot de atribución          |       208 |
| Filas de `contact_attributions`     |       274 |
| Pares mismo contacto + mismo minuto |         2 |

Los dos pares detectados son de Calendly con IDs externos distintos y estados incompatibles:
`cancelled/show` y `cancelled/scheduled`. No se borran: son evidencia de ciclos de vida del proveedor.

## Consultas consumidoras de agendas

- `lib/metrics/consulta.ts`: métricas globales y unit economics.
- `lib/metrics/period-funnel.ts`: funnel comercial por periodo.
- `app/[tenant]/dashboard/page.tsx`: dashboard general.
- `app/[tenant]/analitica/embudo/page.tsx`: embudo de ventas.
- `app/[tenant]/analitica/ranking/page.tsx`: ranking del equipo.
- `app/[tenant]/marketing/adquisicion/atribucion/page.tsx`: atribución de marketing.
- `app/[tenant]/marketing/afiliados/afiliados/page.tsx`: KPIs de colaboradores.
- `app/[tenant]/crm/agendas/page.tsx`: registros físicos y calendario operativo.

Las vistas analíticas llaman a `canonicalizeAppointments()`, pero varias traen las filas ordenadas
por UUID y no por ciclo de vida. Antes de esta rama, el helper conservaba la primera fila encontrada:
la misma cita podía quedar cancelada o asistida según el orden de la consulta.

## Definiciones compartidas y diferencias encontradas

- Asistida: `show | completed`, centralizada en `lib/appointments/status.ts`.
- No-show: `no_show`, centralizada en el mismo módulo.
- Cancelada: `cancelled | cancelled_admin | cancelled_lead`; no entra en el ratio de asistencia.
- Agenda canónica: identidad externa cuando existe y, como reconciliación cross-provider,
  `contact_id + minuto programado`.
- Algunas vistas mantienen listas locales de estados; deben migrarse al contrato central en PR-1.
- Varias vistas traducen `no_atribuidos` a `organico`; esa etiqueta mezcla ausencia de evidencia con
  adquisición orgánica y debe eliminarse en PR-1/PR-3.

## Integraciones y completitud

- Calendly usa la organización del token de admin, no solo el usuario del token. El cron procesa
  primero lo más reciente; el histórico manual pagina con cursor hasta completarse.
- GHL enumera calendarios y eventos y crea contactos de forma perezosa. El histórico usa cursor por
  calendario/evento. Las últimas pasadas cron terminaron sin corte.
- Los crons de Calendly alcanzan su presupuesto con frecuencia, pero empiezan por eventos recientes;
  el histórico del 11-oct terminó con `tieneSiguienteLote=false`.
- 50 resúmenes de atribución con `source=ghl` no tienen UTM y 26 llevan `direct traffic`. Se conservan
  como evidencia original, pero no justifican reclasificar la adquisición como orgánica.
- Los click IDs se conservan en `analytics_touchpoints`; aún no forman parte completa del resumen
  `contact_attributions`, por lo que el detalle debe consultar la trayectoria y no solo el resumen.

## Correcciones de esta fase

1. `canonicalizeAppointments()` elige la fila representativa de forma estable:
   resultado confirmado > cita activa > desconocida > cancelada; el empate se resuelve por ID.
2. Se admiten `external_source + external_id` como identidad estable del proveedor, sin eliminar la
   reconciliación cross-provider por contacto y minuto.
3. La procedencia visual de la agenda ya no transforma Calendly/GHL o un hueco de UTM en
   `Web/directo`; muestra `Sin atribuir` cuando no existe evidencia de adquisición.
4. Pruebas focales cubren orden inverso, cancelada→show, cancelada→scheduled y ausencia de fuente.

## Plan por prioridad

1. **PR-1 Canonical Metrics:** contrato de bookings/shows/no-shows y migración de listas locales.
2. **PR-2 Appointment Reconciliation:** matriz por pantalla, proveedor y owner; incidencias sin borrar
   evidencia y cobertura de carreras/webhooks fuera de orden.
3. **PR-3 Tracking Capture:** separar record source, session source y acquisition source; click IDs,
   redirects, iframe/booking y tests Meta/Google/TikTok/direct/unknown.
4. **PR-4 Identity Resolution:** vínculos determinísticos sesión→contacto→agenda→venta.
5. **PR-5 Financial Reconciliation:** venta, cobro, reembolso y Stripe sin doble conteo.
6. **PR-6 Attribution:** modelos versionados y resultados reproducibles.
7. **PR-7/8:** migración de dashboards, reconciliación periódica y Data Health.
8. **PR-9/10/11:** copiloto con evidencia, backfill reversible y hardening multitenant/E2E.

## Condiciones antes de backfill

Snapshot/backup, consulta dry-run, clasificación `VERIFIED_RECOVERY | PROBABLE_MATCH |
PARTIAL_RECOVERY | NOT_RECOVERABLE`, before/after auditable y rollback. Ningún hueco se convertirá
en orgánico ni se fusionarán identidades ambiguas.

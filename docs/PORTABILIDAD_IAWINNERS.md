# Portabilidad de módulos de iawinners a multitenant

Plan y estado de la portación del código del app de origen (iawinners, Next.js + Postgres directo,
una sola instalación) al app multitenant (Scalix: Supabase + RLS, subcuentas, service-role).
Decisión del dueño (23-oct-2026): **empezar por Lanzamientos**, entregar en **una rama grande**
(`feat/portabilidad-iawinners-modulos`) y las credenciales de las integraciones **en
`integration_settings` por subcuenta** (ya es el patrón de Scalix: `getTenantConfigWithFallback`).

Reglas transversales ya decidas y aplicadas en todo lo que se porte:

- **Cero hardcode del negocio de origen.** Nada de ids, slugs, enlaces ni campañas fijados en código.
  Lo que en iawinners era una constante (`lib/launch/config.ts`) aquí o es dato (tabla por subcuenta)
  o configuración de la subcuenta (`integration_settings`, cifrada si es secreta).
- **Settings por subcuenta.** `getTenantConfigWithFallback(tenantId, true)` es la única puerta de
  credenciales; el env de Vercel queda como fallback. Nada se vuelca a `process.env`.
- **Webhooks entrantes**: subcuenta por el slug de la URL, secreto POR subcuenta, sobre en
  `raw_events` antes de procesar (idempotente por id de evento o hash del cuerpo), proyección
  idempotente, hecho al final. Respuesta genérica cuando falta el secreto (no filtra subcuentas).
- **Efecto externo o escritura irreversible ⇒ claim atómico ANTES** (`UPDATE … WHERE estado_previo
  RETURNING`; sigue solo si la fila es tuya).
- **Un hueco no es un cero**: null es "todavía no hay", un error de consulta nunca se pinta como 0,
  y en pantalla hay estado de error con Reintentar.
- **Ante la duda, no se decide: cola/revisión manual.** Ni contactos "por si acaso", ni importes
  elegidos a dedo.

## Fase 1 — Desacoplo multi-tenant (análisis)

Lo que había acoplado al negocio de origen y cómo se expone ahora:

| En iawinners (hardcode) | En Scalix (por subcuenta) |
| --- | --- |
| Calendario de lanzamientos en `lib/launch/config.ts` + tabla `launches` sin tenant | Tabla `launches` con `tenant_id`; activo = el abierto con fecha más reciente; se abre/programa desde el panel `/lanzamiento` (solo admin/director) |
| Webhook GHL con ruta fija `launch-2026` y lanzamiento por constante | `POST /api/[tenant]/evergreen/webhooks/lanzamiento?evento=…` con secreto por subcuenta |
| Tramos y textos de cold caller como constantes (`COLD_CALLING`) | **Pendiente**: tabla de configuración por subcuenta cuando se porte el módulo de cold callers |
| Enlaces de invitación y closer→URL fijados por id de usuario (`enlacesPorCloser`) | **Pendiente**: no se portan; irán a `integration_settings` o a un panel de colaboradores |
| Credenciales (Apify, Stripe, Sequra, YouTube OAuth, GHL…) en env | `integration_settings` cifradas por subcuenta (patrón existente) |
| Una BD, sin aislamiento | Supabase multitenant: `tenant_id` explícito en cada consulta + RLS RESTRICTIVE |

## Fase 2 — Arquitectura por módulo (flujo UI → API → cola/worker → BD)

Módulos en el orden de portación acordado y su flujo:

1. **Lanzamientos (L1)** — portado (ver Fase 3). UI panel `/lanzamiento` → API
   `[tenant]/evergreen/lanzamiento` (GET datos, POST acciones con rol) → tabla `launches` /
   `contact_launches`. Entrada asíncrona: webhook GHL → sobre `raw_events` → proyección. Los crons de
   recordatorios y WhatsApp del origen **no se portan aún** (dependen de módulos no portados).
2. **Carruseles** — Storage por subcuenta (bucket con prefijo tenant), cola de generación.
3. **Testimonios** — casos de éxito reutilizando el modelo de cualificación y Storage.
4. **VSL (UI)** — ya existe base en Scalix (`vsl_videos`, `vsl_sessions`); portar pantallas del origen.
5. **Contratos** — plantillas ya existen; portar firma y verificación.
6. **Pagos** — Stripe/Sequra con credenciales por subcuenta e idempotencia de webhooks (patrón
   `entradaCompras`).
7. **Biblia / CRM / colas IA** — según backlog; reutilizar `canonical_events` y `raw_events`.

Cada módulo entra con: migración con RLS + índices, núcleo puro testeado sin BD, webhook/API con
sobre, panel con estados hueco/error/cargando y entrada en `lib/nav.ts`.

## Fase 3 — Código portado

### L1 Lanzamientos — PORTADO (23-oct-2026, rama `feat/portabilidad-iawinners-modulos`)

- **Migración** `supabase/migrations/20261023100000_lanzamientos.sql`: `launches` y
  `contact_launches` con `tenant_id`, uniques por subcuenta (slug, fecha, contacto×lanzamiento),
  índices de lectura y política RESTRICTIVE de aislamiento. Idempotente. **Sin aplicar aún en
  producción** (mismo procedimiento que el resto: dry-run de comportamiento y registro en
  `schema_migrations` con su versión).
- **Núcleo puro** `lib/launch/calidad.ts`: puerto íntegro del scoring de lead (resolución por texto de
  pregunta, criterio v2 recalibrado con los cierres del evergreen, criterio de junio para comparar,
  temas de la pregunta abierta, agrupación de creativos y `computeAdQuality`). Sin acceso a BD.
- **Calendario** `lib/launch/lanzamientos.ts`: lecturas por subcuenta y apertura del siguiente con
  **claim atómico** (`UPDATE … WHERE opened_at IS NULL RETURNING`); el movimiento de apuntados del
  anterior va después y es idempotente (excluye los ya apuntados al nuevo). Sin caché por proceso
  (en el origen filtraba entre instancias/tenants) y sin las tablas de WhatsApp/cold callers, que no
  están portadas.
- **Webhook** `lib/launch/webhook.ts` + `app/api/[tenant]/evergreen/webhooks/lanzamiento/route.ts`:
  un solo endpoint para alta (`?evento=alta` o por defecto), encuesta (`?evento=encuesta`) y
  confirmación/desconfirmación. Secreto por subcuenta (`LANZAMIENTO_WEBHOOK_SECRET`), sobre en
  `raw_events` deduplicado por SHA-256 del cuerpo, resolución de contacto ghl→email→teléfono→sufijo
  (el sufijo solo si casa con UNO), confirmación idempotente (la primera marca nunca se mueve), y
  "sin lanzamiento abierto" o "no se identificó a la persona" se responden con el motivo y el sobre
  guardado — nunca se inventa un contacto.
- **API del panel** `app/api/[tenant]/evergreen/lanzamiento/route.ts`: GET (calendario, activo,
  métricas, apuntados por día, ranking de creativos, temas que piden, últimos leads) y POST
  `programar`/`abrir` con rol admin/director. El recuento que excede el límite de filas se declara
  (`muestraCompleta: false`).
- **Pantalla** `app/[tenant]/lanzamiento/page.tsx` + entrada "Lanzamientos" en el menú de marketing.
  Estados diferenciados: sin lanzamiento abierto (hueco, no cero), error con Reintentar, muestra
  corta avisada.
- **Tests** `tests/lanzamiento-calidad.test.mjs` (22 casos, núcleo puro sin BD).

**Conexión pendiente del dueño** (configuración, no código): crear en GHL los 3 Custom Webhooks con
`x-ghl-secret` = el valor de Integraciones de la subcuenta y las URLs
`/api/[tenant]/evergreen/webhooks/lanzamiento` (`?evento=` alto/encuesta/confirmación), y aplicar la
migración en producción.

### Notas de portación (para los siguientes módulos)

- En Scalix ya existía `lib/launch/gates.ts` (gates de certificación SPEC-18, otro dominio: el
  "lanzamiento" de producto, no el evento de ventas). No se toca.
- `contacts` de Scalix no tiene `launch_id` (iawinners sí): "por qué lanzamiento entró" se deriva del
  apuntado más antiguo en `contact_launches`.
- GHL no manda id de evento: los sobres de lanzamiento se deduplican por hash del cuerpo.
- Los crons del origen (recordatorios de WhatsApp, cold callers) NO entran en esta fase: dependen de
  la mensajería de WhatsApp y del reparto de leads, módulos aún no portados. Cuando entren, deberán
  cumplir el presupuesto de cron de Vercel (`maxDuration` mucho mayor que el deadline interno) y el
  claim atómico de backfills.

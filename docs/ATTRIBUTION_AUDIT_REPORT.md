# SPEC-05 — Growth Attribution Intelligence Engine · Auditoría y línea base (PR-0)
13-oct-2026 · Buffy · rama `feat/spec05-pr0-attribution-audit` sobre `origin/main` (`b71dcf55`, merge #480)

Especificación: SPEC-05. **Regla aplicada desde el minuto cero: no rehacer lo que funciona.** La capa
de ingesta/procesamiento es territorio de la SPEC-04 ([línea base](SPEC04_DATA_INTEGRITY_BASELINE.md));
este documento audita la capa de INTERPRETACIÓN: fuentes, touchpoints, atribución, journey y reporting.

Clasificación de cada hallazgo: **VERIFICADO** (confirmado leyendo el código fuente y las migraciones en
`origin/main`, con fichero y línea exactos), **INSPECCIONADO** (lectura parcial, pendiente de reproducir)
o **PROBADO** (cubierto hoy por un test de regresión). Los "casos reales" del §0 de la spec son
INSPECCIONADOS a nivel de código: sin datos de producción en la sesión — las credenciales se borraron
por higiene — la comprobación sobre filas reales queda para la verificación de PR-1+ con fixtures
determinísticos (que sí son verificables y del lado del repo).

---

## 1. Mapa del sistema de atribución ACTUAL

| Pieza de la SPEC-05 | Implementación actual | Estado |
|---|---|---|
| Record Source / First Touch / Last Touch / Booking Touch | `lib/contacts/atribucion.ts` + `contact_attributions`: first/last/booking con primer toque **inmutable** (nunca se sobrescribe), last con fecha, y regla first-collaborator-wins con acta de auditoría | VERIFICADO |
| Second Known Touch | `leerTrayectoria` solo lo acepta cuando el proveedor lo entrega como `secondAttributionSource`; **no existe almacenamiento** `second_*` (grep: 0 resultados) | VERIFICADO |
| Click IDs | `ToqueAtribucion` ya tipa `gclid`, `gbraid`, `wbraid`, `fbclid`, `ttclid`, `msclkid`, `ga_client_id`, `ga_session_id`; el pixel (`lib/tracking/tracker-js.ts`) y `leerToque` ya capturan el abanico completo | VERIFICADO |
| Precedencia por toque | `leerTrayectoria` ordena `attributionSource` → `lastAttributionSource` → `tracking` con `evidence_source` textual (`provider_first`/`provider_last`/`booking`/`flat_payload`/`browser`) | VERIFICADO |
| Resolución de campaña/anuncio | `lib/meta/ad-attribution.ts`: orden booking → last → first → raw, con `utm_id`/id numérico → catálogo por external_id; `contacts.campaign_id` (via resolver por identidad) como fallback; **sin ad_id el anuncio queda "desconocido" a propósito** | VERIFICADO |
| Revenue attribution | `lib/meta/revenue-attribution.ts` (PR #478, nuevo): embudo por cohorte de agenda con ventas/cash neto (`canonicalCash` con refunds), ventas ambiguas fuera de la atribución y declaradas en cobertura | VERIFICADO |
| Catálogo de campañas | `campaigns` viva en sync de Meta (`lib/meta/sync.ts`), con historial de nombres previos (badge «Renombrada» + endpoint `nombres-previos`, PRs #469/#480) | VERIFICADO |
| Dashboards | Atribución (`app/.../adquisicion/atribucion`), Campañas, Funnels, Operativa (`lib/metrics/operativo.ts` con totales y `atribuidos` separados) | VERIFICADO |
| Data health | `lib/data-health/cross-source.ts`: `campana_sin_atribucion` (gasto sin nada río abajo), contactos sin atribuir, llamadas sin agenda | VERIFICADO |
| IA | `lib/ai/agent/tools.ts` incluye herramientas de funnel de ads; reglas anti-invención del repo | VERIFICADO |
| Touchpoint como contrato | `lib/types/tracking.ts` define `touchpoint_id` en el evento de tracking; **no hay tabla de touchpoints ni reconstrucción de journey** (grep: solo el campo del evento) | VERIFICADO |

---

## 2. Hallazgos

### H-1 — TRES clasificadores de canal, divergentes y sin gestor central (VERIFICADO)

La app decide "canal" en tres sitios distintos con criterios distintos:

1. `deriveChannel` ([lib/tracking/ingest.ts](../lib/tracking/ingest.ts)):
   devuelve el `utm_source` crudo en minúsculas como canal; sin UTM mira el referrer → host social o
   `google`; ni referrer ni UTM → `'direct'`. No consulta `utm_medium`, no distingue pago/orgánico.
2. `isPaidSource` ([lib/ads/funnel.ts](../lib/ads/funnel.ts)):
   lista cerrada `PAID_UTM_SOURCES` de alias de Meta (`facebook|fb|meta|meta_ads|facebook_ads|ig|instagram|instagram_ads|an|audience_network...
   `). La fuente es `utm_source` únicamente: un `utm_source=instagram` **con `utm_medium=organic`
   (o sin medium) se clasifica como "Meta Ads (pago)"** — el caso exacto de indeterminación de la
   spec (§2: "un alias de plataforma no determina pagado u orgánico").
3. `originLabel` ([lib/ads/funnel.ts](../lib/ads/funnel.ts)):
   el mismo criterio `isPaidSource` + casos "IA Setting (Instagram/Facebook)" + el texto crudo o
   "Directo/Sin UTM".
4. `lib/metrics/operativo.ts` decía
   `FiltroOrigen = 'paid' | 'organic' | 'direct' | 'referral'` **sin un motor que dicte qué filas son organic**, solo el abanico de campañas del propio `contact_attributions`.

Consecuencia reproducible por lectura: pago y orgánico se mezclan (Caso 1/2/6 de la matriz) y las
pantallas pueden contradecirse entre sí para la misma fila. Cambio mínimo: **única** fuente de verdad
`classify_channel(observaciones) → {channel, platform, status}` consultada por los cuatro, con
`utm_medium` como señal y política documentada para la indeterminación (status `PARTIAL`/`CONFLICTED`).

### H-2 — Record Source contamina Acquisition Source (VERIFICADO por lectura de pantallas)

La página de Atribución compone la etiqueta de origen como
`r.source || r.first_utm_source || NO_UTM` ([atribucion/page.tsx](../app/[tenant]/marketing/adquisicion/atribucion/page.tsx)).
`contacts.source`/`contact_attributions.source` es el **record source**: Calendly envía `website`,
GHL el canal de creación. Cuando esa columna tiene valor, **enmascara el first touch real**: un lead
capturado por Meta Ads con `source=website` se pinta como website/orgánico. Es el caso de la
espec (§0: "utm_source indica publicidad pero source indica organic"; §1: Record Source ≠ canal).
Cambio mínimo: separar las dos dimensiones en las consultas (Record Source y First Known Touch nunca
en el mismo campo) y reetiquetar.

### H-3 — Revenue attribution solo resuelve Meta (VERIFICADO)

`resolveMetaAttribution`/`collectMetaAttributionSignals` ([lib/meta/ad-attribution.ts](../lib/meta/ad-attribution.ts))
resuelven campañas/anuncios por ID numérico de Meta y catálogo `campaigns`. Los touchpoints con
`gclid`/`ttclid`/`msclkid` quedan sin resolución (`campaign:unknown` o fila `Directo/Sin UTM`) aunque
sus señales ya estén guardadas en `contact_attributions` (H-0 del pixel: sí se capturan). No es un
bug: es cobertura. Cambio mínimo: extender el resolver a catálogos de Google/TikTok cuando existan
(sin inventar catálogos) y una marca de cobertura explícita.

### H-4 — Second touch y last non-direct no existen hoy (VERIFICADO)

`contact_attributions` guarda first/last/booking; no `second` ni "last non-direct". `leerTrayectoria`
ya respeta el contrato de la spec (no renombrar `last` como `second`) pero ese toque se pierde si nadie
lo consume. Los Casos 11/12 de la spec (Meta → Google → Direct → Booking) no son reproducibles hoy:
sin tabla de touchpoints cronológicos no hay "second" ni last non-direct. Cambio mínimo: no se
necesita una tabla nueva con motor paralelo — el ledger ya existe en `tracking_events`
(pernoctan `touchpoint_id`, `session_id`, `visitor_id`) y `contact_attributions` añade columnas
`second_*` versionadas, o view sobre eventos. Decisión de diseño para PR-3, no aquí.

### H-5 — No hay modelos de atribución ni ventanas (VERIFICADO)

No existe un "modelo" elegible: hay posicionamiento first (inmutable) y last, y la vista de revenue
(#478) computa por una única fuente de referencia sin modelos alternos. La spec exige 5-7 modelos
(first, last, last non-direct, linear, assisted) con `conversion_type`, ventana, lookback y versión.
No se reemplaza nada: se **añade** un contrato de cálculo puro y reproducible encima de los
touchpoints (PR-4), con la invariante del §13 (pesos suman 1 por conversión; 0 y UNATTRIBUTED si no
hay toque elegible; el total de ingresos nunca se multiplica por modelos).

### H-6 — Sin reconstrucción de journey con evidencia por hito (VERIFICADO por ausencia)

El journey existe disperso: timeline de contacto (`lib/contact-timeline.ts`), eventos de pixel
(`tracking_events` con sesión y touchpoint), `raw_events` de SPEC-04, actas de webhook y backfills.
No hay una función que reconstruya el `ACQUISITION → ... → PAYMENT` cronológico con su evidencia por
hito, ni distinción observado/derivado. PR-3 lo define sin tocar el almacenamiento de los hitos.

### H-7 — Cobertura de identidad: matching de atribución depende de UN solo toque (VERIFICADO)

El sensor de atribución para contactos (`registrarToque`) funciona la entrega a entrega; la unión de
`tracking_sessions/visitors` ↔ `contacts` depende de identificarse (email o eventos confirmados por
calendly). No existe un "graph" revisable de `visitor_id` → contactos. Los casos de email compartido,
teléfonos reciclados y evoluciones de identidad quedan pendientes del mégrado de Person 360; quedan
como INFECCIONADOS para PR-3, la SPEC-04 PR-3 ya reclamó "dos agendas legítimas", no el identity graph.

### H-8 — Data health de atribución sin señales de coverage (INSPECCIONADO)

`cross-source.ts` tiene check de campaña con gasto sin atribución y contactos sin atribuir. Faltan
las señales de la spec (first-touch coverage, booking touch coverage, unattributed sales/cash, conflict
rate, catalog freshness), y `revenue-attribution.ts` **ya devuelve cobertura en su resultado** de
campañas/anuncios/ventas/cash — la base existe y se reutiliza (PR-7 la consolida).

---

## 3. Casos del §0 de la spec — estado

| Caso pedido | Estado | Evidencia |
|---|---|---|
| `utm_source` publicidad pero `source` organic | INSPECCIONADO (estructura reproducible: H-2) | lectura de la composición `source ‖ first_utm_source` |
| `fbclid` presente pero orgánico | INSPECCIONADO (posible estructuralmente: `isPaidSource` no mira `fbclid` ni `utm_medium`, H-1) | `lib/ads/funnel.ts` |
| `gclid` presente pero direct | INSPECCIONADO (idem; `deriveChannel` devuelve direct con referrer vacío aunque la sesión traiga clic ID) | `lib/tracking/ingest.ts` |
| Primera Meta y agenda organic | INSPECCIONADO (H-2/H-1 en la etiqueta de agendas) | page agends/origen |
| Venta/pago sin atribución en los informes de cash | VERIFICADO como cubierto por #478 (coverage declarado) | `lib/meta/revenue-attribution.ts` |
| La misma conversión con atribuciones distintas | VERIFICADO no existe motor plural todavía (H-5), no puede pasar | ausencia |
| Dashboards incompatibles | INSPECCIONADO (H-1: cuatro criterios de canal) | ficheros citados |

No hay correcciones automáticas en este PR: entender antes de tocar es parte de la spec.

---

## 4. Plan de fases (adaptado a lo que existe)

| Fase | Cubre | Nota |
|---|---|---|
| **PR-0** (este) | Auditoría y matriz | sin código |
| PR-1 — Source Taxonomy | `source_normalization_rules` versionada de la SPEC-04 PR-2 si aún no fusionada; taxonomía canónica (MM internos sobre `lib/contacts/resolver-campana.ts` ya resuelven alias → campañas) | un solo motor de clasificación, compartido por los 4 consumidores |
| PR-2 — Evidence & Conflicts | Estados de clasificación (`VERIFIED/RULE_DERIVED/PARTIAL/CONFLICTED/UNKNOWN`) y precedencia por campo | no jerarquía universal |
| PR-3 — Touchpoints & Journey | Second touch, last non-direct, reconstrucción con evidencia, identity graph | |
| PR-4 — Models | Contrato de modelos con invariantes §9 (pesos suman 1, sin doble contabilidad) y ventanas por tipo de conversión | additivo, no sustitutivo |
| PR-5 — Campaign Identity | Resolver a Google/TikTok, marcadores de catálogo desactualizado | ya hace Meta con IDs estables |
| PR-6 — Revenue/Cash attribution | Políticas por pago/renovación; reutiliza `canonicalCash` | |
| PR-7 — Reporting & Health | Señales de cobertura de atribución, comparaciones cross-platform sin acusar inflación de terceros | |
| PR-8 — Copilot IA | `explain_attribution`, `compare_attribution_models`, `find_source_conflicts` | reutiliza `lib/ai/agent/tools` y reglas anti-invención |
| PR-9 — E2E & Hardening | Fixtures A–N de la spec como property tests y e2e | |

---

## 5. Limitaciones

- Auditoría de lectura (código/migraciones de `origin/main` `b71dcf55`), sin datos de producción;
  los "casos §0.2" quedan INSPECCIONADOS y se cierran con fixtures determinísticos.
- La PR #479 (SPEC-04 PR-0) sigue abierta; SPEC-04 PR-1+ puede modificar webs hooks/estados que los
  contractos de touchpoint de SPEC-05 deben respetar (se coordina en el tablero del handoff).
- Los identificadores de proveedor examinados (HYROS/Cometly/Triple Whale/etc.) NO se copian ni se
  da por visto su comportamiento; la investigación documental por proveedor se hará en PR-1/PR-3
  a demanda con citas oficiales.

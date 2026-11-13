# Handoff — Lanzamientos + Cold calling

Rama: `claude/exciting-galileo-5ihvon` · Sin PR abierto. Última actualización: 2026-11-10.
Este documento es para retomar el trabajo sin releer la conversación. Lo más importante va primero.

## 0. Qué hacer primero (orden recomendado)

1. **Aplicar las dos migraciones** (necesitan tu confirmación; no se han aplicado a producción):
   - `supabase/migrations/20261110100000_lanzamientos_cierre.sql` — añade `closed_at`/`closed_by` a `launches`.
   - `supabase/migrations/20261110110000_cold_calling.sql` — tablas, rol, CHECK del ledger, RLS.
   - Probadas dos veces (idempotentes) en Postgres 16 local. Falta `get_advisors` y el dry-run en la BD real.
   - Antes de aplicar, repasa el §5 (riesgos).
2. **Terminar la pantalla del manager** (`app/[tenant]/cold-calling/page.tsx`). Es lo único que falta para que cold calling sea usable de punta a punta (§3).
3. **Cron diario** de sincronización de comisiones (§3).
4. **Documentar D11 en `docs/MONEY.md`** antes de que nadie toque comisiones (§4).
5. **Code review + barrido anti-tenant** y abrir el PR (§6).

## 1. Hecho y verificado

### Lanzamientos — commit `572c026` (en la rama remota)
Causas raíz arregladas (confirmadas leyendo código):
- El GET del panel devolvía **500 con ≥1 lead** (leía `f.contact_launches.created_at` sobre filas planas). Tumbaba también Contenido e Informe.
- **El primer lanzamiento no se podía abrir** (`abrirSiguienteLanzamiento` exigía uno ya abierto) → el webhook de GHL descartaba todo.
- Un error de acción **borraba todo el panel** (carga y acciones compartían estado).
- Permisos: guard único `lib/launch/permisos.ts` (`administraTenant` o admin/director).
- Cifras cortadas sin avisar: `.limit(5000)` se quedaba en 1000 por `max_rows`. Ahora `lib/launch/filas.ts` pagina de verdad y declara la muestra.
- Citas/ventas reales por lead y anuncio (`lib/launch/conversiones.ts`, respeta D8).
- UX: asistente de activación, pestaña **Conexión con GHL** (cuatro URLs con copiar, estado del secreto, último evento), diálogos de confirmación, selector de lanzamientos pasados, editar/cerrar/borrar, tabla de leads con detalle y CSV.

### Cold calling — commit posterior (núcleo, migración, API) 
- `lib/cold-calling/`: `estados`, `policy`, `config`, `comisiones`, `reparto`, `operaciones`, `panel`, `servidor`.
- API: `app/api/[tenant]/evergreen/cold-calling/{route,manager/route,config/route}.ts`.
- Gancho en `lib/commissions/generate.ts` (tras cobro y tras reconciliar), roles/menú/permisos, etiquetas «Cold Caller» en Comisiones.
- Tests: `tests/cold-calling-nucleo.test.mjs` (31) y `tests/lanzamiento-*.test.mjs`. Suite completa: **2695 pasan, 0 fallan**.

### Sin commitear (en disco)
- `app/[tenant]/llamadas/page.tsx` y `components/cold-calling/tipos.ts` — pantalla de la cold caller. Compila y pasa lint. **No se ha visto en navegador todavía.**
- `docs/HANDOFF_LANZAMIENTOS_COLD_CALLING.md` — este fichero.

## 2. Estado de verificación (INSPECTED / TESTED / VERIFIED)

| Qué | Nivel |
|---|---|
| Lógica de lanzamientos, panel, conexión, cold calling (núcleo) | **TESTED** (tests unitarios con cliente Supabase en memoria, `tests/fixtures/sb-memoria.mjs`) |
| Migraciones | **TESTED** en Postgres 16 local con tablas simuladas; **no** contra la BD real |
| Pantalla de Lanzamientos | **VERIFIED** en navegador, pero con **API simulada** (no hay credenciales aquí) |
| Pantalla `/llamadas` | **INSPECTED** (compila, lint) |
| Pantalla `/cold-calling` | No escrita |
| Esquema real de BD | **INSPECTED** vía MCP de Supabase en solo lectura (0 lanzamientos y 0 apuntados en producción: ninguna migración mueve datos) |

## 3. Pendiente — detalle

### 3.1 Pantalla del manager `app/[tenant]/cold-calling/page.tsx`
La API ya existe (`GET …/cold-calling/manager`, `POST` con `repartir` / `reasignar` / `sincronizar`, `PUT …/config`). Contrato de tipos en `components/cold-calling/tipos.ts` (`ManagerResponse`). Debe tener:
- Selector de lanzamiento, tarjetas de totales (asignados, por llamar, confirmados, ventas, dinero firme/en plazo).
- Tabla por cold caller (`stats`) con botón **Abrir su lista** → `/{tenant}/llamadas?como=<id>` (solo lectura) y **Repartir tanda**.
- «Necesitan atención» (`atencion`: recordatorio vencido / sin actividad N días) con **Reasignar** (motivo obligatorio).
- Actividad reciente y ventas que cuentan (con importe).
- **Ajustes** (solo si `puedeConfigurar`): editor de tramos (cubren 1…∞ sin huecos), tanda, umbral, objetivo. Sin tramos, decirlo: «no hay comisión por venta configurada».
- Estados: cargando (esqueleto), error con Reintentar, sin lanzamiento, sin callers. Patrón a copiar: `app/[tenant]/lanzamiento/page.tsx` y `app/[tenant]/llamadas/page.tsx`.

### 3.2 Cron diario
`app/api/[tenant]/evergreen/cron/cold-calling/route.ts` + `.github/workflows/cron-cold-calling.yml`, copiando `cron/monthly` (Bearer `CRON_SECRET`, `maxDuration=60`, presupuesto 45 s con `crearPresupuestoCron`, fallo ruidoso, recorre subcuentas activas). Llama a `sincronizarComisionesColdCalling(sb, tenantId)`. **No** añadir un cron a `vercel.json` (Hobby: máx. 2).

### 3.3 Cabos sueltos del rol `cold_calling_manager`
Añadirlo donde ya está `cold_caller` en listas blancas escritas a mano:
`app/api/[tenant]/evergreen/appointments/{create,update,status,reschedule,followup-stage,follow-up}/route.ts`, `biblioteca/route.ts`, `invite/route.ts`, `lib/testimonios-auth.ts`.
Las rutas de citas que llaman a `puedeAccederAFila` deben seleccionar también `cold_caller_id` (ya hecho en `ai/queue-call`).
Corregir `app/[tenant]/analitica/actividad/page.tsx:114`: la plantilla KPI siembra `citas_generadas` y la agregación lee `citas_agendadas`.
El cold caller aún no tiene dashboard personal (`PERSONAL_HOME_ROLES`) — su inicio es `/llamadas`.

## 4. Decisión de dinero a documentar: D11 (en `docs/MONEY.md`)
Texto propuesto: *Comisión fija de cold caller.* Una venta paga un importe fijo, por tramos configurados por subcuenta, a la cold caller que registró una llamada **antes** de la venta (se mira el historial, no el estado). Condiciones: venta activa, no upsell, reserva completada (D8), persona no exenta (D9). El cambio de estado de un gestor no cuenta como llamada de ella. Si el lead pasó por varias personas, la venta es de una sola (la asignación más reciente anterior a la venta con llamada). No hay tramos por defecto: sin configurar no se calcula. La sincronización es idempotente; **no reescribe nada liquidado (D4)**; la reversión de lo ya pagado sigue abierta (D7). Importe fijo ⇒ `percent=0`, `base_amount=0` en el ledger.
Actualizar también `PROJECT_CONTEXT.md` y `docs/PORTABILIDAD_IAWINNERS.md` (marcar cold calling base como portado; resto = hoja de ruta, §7).

## 5. Riesgos y decisiones abiertas (léelos antes de aplicar migraciones)
1. **Ledger**: la migración amplía el CHECK de `commissions.participant_type` y crea el índice único parcial `commissions_cold_caller_sale_key`. Toca la tabla de dinero → dry-run + `get_advisors` antes de producción (regla del repo).
2. **RLS**: reescribe `appointments_select_scope`, `contacts_select_scope` y `is_team_scheduling_scope_allowed()` (ahora incluye `cold_caller` y `cold_calling_manager` con `data_scope='team'`). Es un cambio de visibilidad: confirmar que es lo que se quiere.
3. **Periodo de desistimiento**: «Tu dinero» separa firme / en plazo usando `sales.refund_deadline_at` (ya existe), no una constante por empresa.
4. **Comisión de un cold caller que además es setter** (el motor antiguo lo trataba como setter en `sales.setter_id`): puede cobrar las dos. Decidir si se quiere.
5. **Moneda**: `formatCurrency` usa EUR por defecto; las subcuentas con otra moneda verían el símbolo equivocado en «Tu dinero». No se ha parametrizado.
6. **`cold_calling_events` es inmutable** (trigger). Un error de datos no se corrige con UPDATE: hay que añadir un evento.
7. El MCP de Supabase de escritura no se usó: **nada se ha aplicado a producción**.

## 6. Cierre (Fase E)
- `npm run quality` completo (solo se ejecutaron `tsc`, `eslint`, `prettier` y `npm test`; falta `test:metrics` y `format:check` global).
- Tests de aislamiento a mirar: `esquema-tenant-invariante`, `invariante-tenant-negativo`, `endpoints-scope-pantalla`, `rol-por-tenant`, `funnels-section`, `commission-eligibility-invariant`. La suite completa ya pasa; mirar que ninguno quede saltado.
- `/code-review` y `/security-review` sobre el diff; foco: rutas con service-role (todas filtran `tenant_id`), `?como=`, exportación CSV, concurrencia de «Dame más».
- **Barrido anti-tenant**: grep de marcas, dominios, UUIDs, emails y nombres propios en el diff; el comentario de `tailwind.config.ts:23` menciona un nombre corto de subcuenta.
- Borrar el harness local `app/ver-como/harness-lz/` si existe (está en `.git/info/exclude`, no se commitea).
- Verificación en navegador contra un entorno real (el harness usa API simulada).
- PR solo cuando se pida; `subscribe_pr_activity` después.

## 7. Hoja de ruta del resto del port (una fase = un PR)
Del inventario del repo de referencia, ordenado por valor / riesgo. Todo lo variable va a tablas por `tenant_id` o `integration_settings`; nada de marcas, URLs, IDs, personas ni importes en código.
1. **Motor de automatizaciones** (reglas «cuando X → haz Y», pausar crons, catálogo generado desde las integraciones activas). M, riesgo bajo. Corregir al portar: caché de pausa en memoria de proceso; catálogo estático con nombres reales.
2. **Facturación de cold callers** (subir factura, aprobar, pagar) **+ Google Meet/Calendar** reutilizando `lib/google/oauth.ts` y `token-store.ts`. M–L.
3. **Contenido**: fábrica de reels aprobar → programar → publicar, con cuentas sociales en BD (en el origen están en código); biblia de contenido y cola de guiones. L. El editor de carruseles de este repo ya es superior: **no portar**.
4. **Estudiante**: clases con feedback público, kanban de onboarding y check-ins. S–M cada uno.
5. **Extras de lanzamiento**: invitaciones de closers por WhatsApp, recordatorios escalonados, asistente de IA sobre los datos. M cada uno. El webhook único con `?evento=` de este repo es mejor que los tres del origen: conservarlo.
6. **Pequeños**: widgets operativos (siguiente llamada, asistencia pendiente, repesca de presupuesto bajo), cancelación de contratos + IBAN, afiliados con porcentajes por tenant.
**No portar**: cold calling antiguo con Sheets y contraseñas propias, worker de transcripción (ya hay Fathom), «entrar como» (ya hay `ver-como`).
Bugs del origen a no copiar: escrituras en cada GET (y sondeo cada 10 s), `?como=` sin validar que el objetivo sea caller, trigger de auditoría que duplica eventos y deja el actor vacío, `attributeSale` sin comprobar que la asignación sea anterior a la venta.

## 8. Cómo retomar en local
```bash
npm ci
npm run quality
# Tests rápidos de lo tocado
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tests/register.mjs --test tests/lanzamiento-*.test.mjs tests/cold-calling-nucleo.test.mjs
# Migraciones en una BD desechable: ver tests/fixtures y probar con psql sobre un Postgres 16 local
```
`tsc` necesita memoria: `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit`.
Para `next dev` hace falta `CONFIG_ENC_KEY` (64 hex) aunque sea efímera.

# SPEC-16 PR-0 — SaaS Administration & Customer Success: auditoría del repositorio real

Auditoría previa a implementar (regla nº 1 de la SPEC). No reemplaza a otros documentos:
consolida qué existe HOY para un centro de administración de plataforma y qué falta. Donde un
hallazgo ya está documentado en otra SPEC, se enlaza en vez de repetirlo.

Clasificación: VERIFIED (código + prueba real), IMPLEMENTED_UNVERIFIED (existe, sin prueba
dedicada), PARTIAL (existe a medias con hueco concreto), MISSING (grep 0 resultados),
NOT_APPLICABLE. Evidencia INSPECCIONADA salvo donde se indica lo contrario.

## 1. Base existente que la SPEC reutiliza (verificado)

| Capacidad                               | Estado                 | Dónde vive                                                             | Evidencia                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidad de plataforma (login, sesión) | VERIFIED               | Supabase Auth + middleware de sesión                                   | `lib/supabase/middleware.ts`; sesión validada en todas las rutas del App Router                                                                                                                                                                                                                                              |
| Multi-tenant real (subcuentas del SaaS) | VERIFIED               | `tenants` + `tenant_members`                                           | `20260911140000_multi_tenant_foundation.sql`: tenants con `status` y `tenant_members(role)`                                                                                                                                                                                                                                  |
| Ciclo de vida del tenant                | PARTIAL                | constraint `tenants_status_check`                                      | `20260918100000_tenant_archived_status.sql`: `active` / `suspended` / `archived` con regla documentada («archivado conserva TODO»; reactivar es acción explícita de super admin). Falta el resto del ciclo de la SPEC (trial, past due, retention/deletion) porque no hay billing propio                                     |
| Resolución + rol acotado por subcuenta  | VERIFIED               | `lib/auth/requireTenant.ts`                                            | Sesión + membresía + rol EFECTIVO acotado a la subcuenta pedida (no hay rol global sin acotar para decidir); ~149 de 168 rutas API pasan por aquí (S0-2 JOURNEYS)                                                                                                                                                            |
| Aislamiento RLS                         | VERIFIED               | migraciones + batería                                                  | Políticas RESTRICTIVE todas; la batería adversarial transversal (11/11) y `npm run test:rls:live` son la red                                                                                                                                                                                                                 |
| Auditoría de acciones                   | VERIFIED               | `audit_logs`                                                           | Actas con actor, antes/después y motivo en 40+ rutas críticas (mapeado en `AUTOMATION_ARCHITECTURE_AUDIT.md`); índices `20261003123000`                                                                                                                                                                                      |
| Impersonación controlada («Ver como»)   | VERIFIED               | `lib/auth/ver-como.ts` + `app/api/[tenant]/evergreen/admin/ver-como/*` | Ticket cifrado (httpOnly, caduca 30 min), OTP para canjear, guard de subcuenta, auditoría del acceso y de la salida, sesión restaurada al salir. Tests `tests/ver-como.test.mjs`. Es exactamente el MVP que la SPEC §18 pide PRIORIZAR (sin acceso silencioso: hay notificación visual con BannerVerComo y salida explícita) |
| Provisioning de subcuentas              | PARTIAL                | `app/[tenant]/settings/subcuentas/page.tsx`                            | Crear subcuenta con pasos automáticos (productos, planes, integraciones, miembros), invitar usuarios, archivar con confirmación en 2 pasos y auditoría old→new. Es consola de provisioning, NO directorio de Customer Success                                                                                                |
| Data Health por tenant                  | IMPLEMENTED_UNVERIFIED | `lib/data-health/*`, `lib/integrations/sync-runs.ts`                   | Estados de conectores y actas de sincronización (detail en SPEC-10: sin incidencias persistentes ni score);ui en `settings/data-health`                                                                                                                                                                                      |
| Consumo IA (espejo)                     | PARTIAL                | migración `ai_usage_tracking`                                          | Tabla de uso por cuenta; sin pantalla de plataforma ni cuotas por plan (no hay plan)                                                                                                                                                                                                                                         |
| Notificaciones operativas               | PARTIAL                | popover del Header + bandejas por módulo                               | Sin Action Center unificado (S1-MVP §6.7: hueco confirmado, decisión de producto pendiente)                                                                                                                                                                                                                                  |

## 2. Huecos verificados (grep 0 resultados salvo nota)

| Hueco                                                                    | Estado  | Nota de auditoría                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Billing propio del SaaS (plan, suscripción, Stripe Account del producto) | MISSING | CONSISTENTE CON SPEC-13: 0 en todas las migraciones. Todo `stripe_*` es el negocio del CLIENTE (`stripe_customers` cachea cobrar/clientes del tenant). No hay `plans` ni `entitlements` del producto. Funciona hoy porque el producto es exclusivo interno del dueño, cobrado fuera del sistema. |
| Jerarquía de staff de plataforma (RBAC §6)                               | MISSING | El único rol de plataforma que existe es `is_super_admin()`: un flag binario en `tenant_members.role` de CUALQUIER subcuenta que da acceso total. No hay Admin/Support/CS/Billing/Auditor separados                                                                                              |
| Asignación de Customer Success por tenant                                | MISSING | No existe entidad de responsable por subcuenta (ni columnas ni tabla)                                                                                                                                                                                                                            |
| Tickets de soporte de plataforma                                         | MISSING | Grep 0 para `platform_support*_`; el ticket de ver-como es SESIÓN, no gestión de soporte                                                                                                                                                                                                         |
| Incidentes de plataforma                                                 | MISSING | Grep 0; solo traces de Data Health por tenant                                                                                                                                                                                                                                                    |
| Customer Health Score / churn (relación SaaS-cliente)                    | MISSING | Las señales de SPEC-15 miden el negocio DEL CLIENTE, no el uso de nuestra app por el cliente                                                                                                                                                                                                     |
| Métricas SaaS (MRR/NRR/cohorts)                                          | MISSING | Sin fuente; dependerían del billing propio                                                                                                                                                                                                                                                       |
| Eventos de uso del producto (analytics §13)                              | MISSING | `raw_events` es métrica del cliente; no hay telemetría del producto SaaS en sí                                                                                                                                                                                                                   |

## 3. Anti-duplicación: decisiones de no-crear

- **El cliente SaaS YA ES `tenants`.** No se crea `customers` ni `organizations`.
- **El directorio en `settings/subcuentas` NO se convierte en listado de planes del SaaS** por la regla 6 (no confundir ingresos SaaS con ingresos del cliente): sin billing propio, cualquier columna «plan» del directorio sería un valor a dedo. Requiere decisión BUSINESS de SPEC-13 §5 (¿qué plan vende el producto y cómo se cobra?) antes de PR-2/PR-3.
- **La auditoría de plataforma reutiliza `audit_logs`**: la política existente ya la lee quien
  administra la subcuenta y super_admin de plataforma por la combinación RLS vigente; una pantalla
  staff nueva (PR-9) NO crea tabla nueva.
- **Impersonación §18:** no se construye otra impresión; se extiende el ticket «Ver como» si el
  dueño desea (motivo + duración configurable).

## 4. Riesgos y bloqueos del delta PR-1..PR-10

1. **PR-1 (RBAC staff) es el PRÍMER bloqueo.** Hoy solo existe total-autoridad (`super_admin`) o
   usuario de tenant. Sin `platform_staff_memberships` no se puede dar soporte seguro ni CS asignado.
2. **PR-2/PR-3 (directorio + suscripción) bloqueados por la decisión BUSINESS de SPEC-13 sobre
   billing/planes del producto.**
3. **PR-5 (health score) requiere telemetría de uso propia (§13) que no existe: primero PR-4.**
4. **Todos los tests de SPEC §27 agregados a los test scripts existentes NO pueden ejecutarse en CI
   contra producción**: PR-10 necesita staging (hueco buy-off en SPEC-13).
5. Cualquier pantalla staff debe fail-closed hasta tener roles reales.

## 5. Delta de PRs adaptado

| PR Alcance                                                                                            | Bloqueo hoy                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| PR-1 RBAC staff + separación control-plane/data-plane (`platform_staff_memberships`, deny-by-default) | Decisión BUSINESS: jerarquía de roles propuesta por el dueño |
| PR-2 Tenant Directory + Operations 360 (vistas, filtros server-side)                                  | PR-1 + decisión de plan del SPEC-13                          |
| PR-3 Billing & Entitlements operativity                                                               | SPEC-13 (billing propio)                                     |
| PR-4 Onboarding & Usage telemetry de la app                                                           | Ninguno técnico; requiere no registrar PII                   |
| PR-5 Customer Health Score                                                                            | PR-4 + pesos tras datos reales                               |
| PR-6 Support Ticket Engine                                                                            | PR-1                                                         |
| PR-7 CS Playbooks                                                                                     | PR-5/PR-6 + política de comunicaciones                       |
| PR-8 Incidentes + communications                                                                      | PR-1                                                         |
| PR-9 SaaS Revenue analytics                                                                           | SPEC-13                                                      |
| PR-10 Hardening/E2E                                                                                   | Staging                                                      |

## 6. Slice PR-0 entregado (no documentación sola, regla 20)

`lib/platform/rbac.ts` — matriz de permisos de plataforma determinista y fail-closed sobre el modelo
REAL (super_admin binario hoy), sin tocar esquema ni rutas vivas. `tests/platform-rbac.test.mjs`
con los casos adversariales del §27 ejecutables en CI (usuario de tenant ≠ staff, revocación
corta acceso, rol no reconocido denegado, acceso excepcional nunca implícito, suspensión sin
aprobación). PR-1 solo tiene que CABLEAR (verificar y llamar); el política no se improvisa en la
ruta. `growth_signals` de #493 queda intacto.

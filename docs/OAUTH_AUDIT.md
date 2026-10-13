# Auditoría de clientes OAuth y URIs de rotación

> 21-sep-2026, aplicando las skills `oauth-implementation` + `integration-testing` (`.claude/skills/`).
> Regla clave (oauth-implementation): los redirect URIs se comparan como **cadena exacta** — nada de
> wildcards ni sufijos. Si algún día cambia el dominio de producción, hay que actualizar el URI en
> CADA proveedor ANTES del cambio DNS, o todas las conexiones mueren con `redirect_uri_mismatch` /
> callbacks firmados rechazados.

## Dominio de producción

- `https://app.scalixsystems.com` — Vercel, proyecto `growth-ops-app` (account `app-b1af`), dominio
  custom `scalixsystems.com` (registrar de terceros). Único dominio de producción.
- Los aliases `*.vercel.app` y deployment URLs son efímeros: NINGÚN proveedor, callback, webhook o
  documento operativo debe depender de ellos.

## 1. Google (arquitectura vigente desde 13-oct-2026)

| Dato                          | Valor                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Cliente OAuth                 | Uno global, propiedad de la plataforma; env `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` |
| Redirect URI                  | `https://app.scalixsystems.com/api/oauth/google/callback` (cadena exacta)                           |
| Identidad multi-tenant        | Refresh/access token cifrados por subcuenta en `google_oauth_connections`                          |
| Protección del flujo          | `state` HMAC con tenant+usuario+servicio+TTL, PKCE S256 y sesión verificada en callback             |
| Consentimientos               | GA4, Calendar, YouTube lectura/analytics y YouTube publicación separados                           |
| Refresco y desconexión        | Automático con refresh token; revocación en Google y borrado tenant-scoped                          |
| Gmail                         | No se usa Gmail API ni scopes restringidos; el correo saliente permanece en Resend                 |

YouTube ya no usa OAuth Playground ni credenciales pegadas por cada cliente. `youtube.readonly` y
`yt-analytics.readonly` permiten consultar canal/analítica; `youtube.upload` se solicita únicamente
si el administrador activa la publicación. Calendar mantiene una conexión por miembro dentro de la
subcuenta. GA4 mantiene una conexión administrativa por subcuenta y muestra un error específico
cuando la cuenta autorizada no tiene acceso a la propiedad.

Para activar un entorno nuevo se registran el callback exacto, las APIs de Google necesarias y las
dos variables globales. Nunca se copian Client ID/Secret ni refresh tokens a los ajustes del tenant.

## 2. Supabase Auth (PKCE de email: invitaciones, recuperación)

| Dato                        | Valor                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Tipo                        | OAuth PKCE de Supabase (no es un cliente externo: la app ES el cliente)                                                                |
| Redirect URI que la app usa | `https://app.scalixsystems.com/api/{tenant}/evergreen/auth/callback` (5 llamadas: invite, recover, colaboradores, afiliados, registro) |
| Dónde se configura          | Supabase → Authentication → URL Configuration → **Redirect URLs** (permitir `https://app.scalixsystems.com/**`) y Site URL             |
| Riesgo de rotación          | Supabase valida la lista completa; un dominio nuevo hay que añadirlo ANTES del cambio DNS                                              |

## 3. Meta (Facebook/Meta Ads)

| Dato                                | Valor                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Tipo de credencial                  | **System User token** pegado a mano (NO OAuth browser): no tiene redirect URI. La rotación es del token, no de URIs |
| Callbacks entrantes                 | Ninguno (solo polling de la Graph API)                                                                              |
| Si algún día se añade Login de Meta | Registrar `https://app.scalixsystems.com/api/oauth/meta/callback` (hoy no existe)                                   |

## 4. Webhooks entrantes (equivalentes operativos de un redirect: URLs que el proveedor llama)

| Proveedor | URL pública en producción                                                | Secreto de verificación                                        | Dónde rotarlo                                    |
| --------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------ |
| Apify     | `https://app.scalixsystems.com/api/webhooks/apify`                       | `x-apify-webhook-secret` (header, en los 2 webhooks de cuenta) | Apify → Settings → API & Integrations → Webhooks |
| Stripe    | `https://app.scalixsystems.com/api/{tenant}/evergreen/webhooks/stripe`   | firma del webhook (`STRIPE_WEBHOOK_SECRET`)                    | Stripe → Developers → Webhooks                   |
| Calendly  | `https://app.scalixsystems.com/api/{tenant}/evergreen/webhooks/calendly` | signing key (`CALENDLY_WEBHOOK_SECRET`)                        | Calendly → API & Webhooks                        |
| GHL       | `https://app.scalixsystems.com/api/{tenant}/evergreen/webhooks/ghl`      | secreto de la subcuenta (webhook-ghl)                          | GHL → Settings → Webhooks                        |

Estas URLs van **cifradas dentro de la config de cada subcuenta** (los catálogos muestran
`webhookPath` con `{tenant}`); al rotar dominio hay que re-crearlas en cada proveedor con el
dominio nuevo y actualizar `APIFY_WEBHOOK_SECRET`/claves donde proceda.

## 5. Calendly, Stripe, GHL, Fathom, Apify (APIs por token)

Ninguna usa OAuth browser: todas son **tokens/keys pegados en Integraciones** (verificado en el
catálogo `lib/integrations-catalog.ts`). No tienen redirect URIs que auditar; su superficie de
rotación son los tokens y los webhooks de la tabla de arriba.

## Checklist de rotación de dominio (por si algún día toca)

1. Añadir el dominio nuevo en Vercel (alias de producción) SIN quitar el viejo.
2. Google: añadir `https://{nuevo}/api/oauth/google/callback` al cliente OAuth.
3. Supabase: añadir `https://{nuevo}/**` a Redirect URLs; actualizar Site URL.
4. Re-crear los 4 webhooks con el dominio nuevo (Apify, Stripe, Calendly, GHL por subcuenta).
5. `NEXT_PUBLIC_SITE_URL` del env de Vercel → dominio nuevo + redeploy OBLIGATORIO.
6. Verificar con las sondas de Integraciones (todas en verde) ANTES de retirar el dominio viejo.
7. Solo entonces retirar el dominio viejo de Vercel y de cada proveedor.

## Cobertura de tests de integraciones (aplicando integration-testing)

| Área               | Tests existentes                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Webhooks entrantes | `webhooks-entrantes.test.mjs`, `webhook-ghl.test.mjs`, `stripe-webhook-route.test.mjs`, `webhook-secret-diagnostico.test.mjs` |
| Crons              | `cron-calendly-ghl.test.mjs`, `cron-stripe-payments.test.mjs`                                                                 |
| Google/YouTube     | `google-oauth.test.mjs` (state, PKCE, scopes, cifrado, refresh, revocación), `youtube-oauth.test.mjs` (lectura/publicación separadas) |
| Apify              | `social-research.test.mjs` (guards de cuenta propia, webhook)                                                                 |
| Stripe             | `stripe-backfill-route.test.mjs`, `salud-pagos-stripe-sin-cobro.test.mjs`                                                     |
| Meta               | `tests/meta/` (fixtures y sincronización)                                                                                     |

Hueco conocido y asumido: CI no consume cuentas reales de Google. Tras aplicar la migración y
configurar el cliente global hay que ejecutar un smoke de consentimiento, refresco y revocación con
cuentas QA de GA4, Calendar y YouTube; hasta entonces la integración es TESTED, no VERIFIED LIVE.

### Verificación en vivo de la superficie (21-sep, producción)

| Endpoint                               | POST sin secreto | Esperado               | OK  |
| -------------------------------------- | ---------------- | ---------------------- | --- |
| `/api/webhooks/apify`                  | 401              | 401 fail-closed        | ✓   |
| `/api/{t}/evergreen/webhooks/stripe`   | 401              | 401 firma faltante     | ✓   |
| `/api/{t}/evergreen/webhooks/calendly` | 401              | 401 fail-closed (HMAC) | ✓   |
| `/api/{t}/evergreen/webhooks/ghl`      | 401              | 401 cabecera secreta   | ✓   |

### Hueco de cobertura detectado (pendiente para próxima pasada)

Las **acciones `test` de las sondas de Integraciones** (`action === 'test'` del route del panel:
meta, stripe, calendly, ghl, apify, youtube, ia…) no tienen ningún test: son el único trozo del
subsistema de integraciones sin red. Añadir tests de fuente como los de `youtube-oauth.test.mjs`
cuando toque tocar ese código.

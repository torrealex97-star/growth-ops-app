# Pasos que dependen de Alex (26-oct-2026)

Todo lo demás está hecho y en `main`. Lo de esta lista no se puede hacer desde el desarrollo (permisos de base de datos,
paneles de terceros o decisiones de negocio). Orden por impacto. Marca cada paso al terminarlo y avisa para que se verifique.

## 1. Aplicar las 4 migraciones pendientes (5 min)

Fichero listo: `~/aplicar-migraciones-pendientes.sql` (también están en `supabase/migrations/`).

1. Panel de Supabase del proyecto → **SQL Editor** → **New query**.
2. Pega TODO el contenido del fichero y pulsa **Run**. Orden interno: forms_csm_solo_alumnos → forms_hardening →
   lanzamientos → mcp_reader_conversaciones.
3. Comprueba (pega y ejecuta):
   ```sql
   select to_regclass('public.launches') is not null as lanzamientos,
          exists (select 1 from pg_policies where tablename='forms' and policyname='forms_delete_roles') as forms_endurecido,
          has_table_privilege('mcp_reader', 'public.conversations', 'select') as mcp_conversaciones;
   ```
   Debe devolver `true | true | true`.

Qué hacen: el rol CSM solo ve formularios de alumnos; solo admin/director borran formularios; crea las tablas del módulo
de Lanzamientos; y permite al MCP listar conversaciones (sin mensajes).

## 2. Conectar el MCP en ChatGPT / Claude (5 min)

1. Borra el conector GrowthOps anterior.
2. Crea uno nuevo: URL `https://app.scalixsystems.com/api/mcp`, autenticación OAuth. En ChatGPT termina con
   **Analizar herramientas** → **Crear**.
3. Actívalo en un chat nuevo (**+ → GrowthOps**) y prueba:
   - "Busca el contacto Catalina en GrowthOps" (`search`/`fetch`)
   - "Lista las agendas de esta semana" (`list_appointments`), "las ventas de octubre" (`list_sales`)
   - "Lista las conversaciones abiertas de Instagram" (`list_conversations`, tras el paso 1)
4. Si falla, copia el texto exacto del error: cada intento queda registrado en `mcp_oauth_*`.

## 3. Activar Conversaciones con el agente de IA (30 min)

1. GHL: crea dos workflows ("Customer Replied" y "Message sent") con acción **Custom Webhook** a
   `https://app.scalixsystems.com/api/<tu-subcuenta>/evergreen/webhooks/ghl-mensajes` y la cabecera `x-ghl-secret`
   con el MISMO secreto que en la app (guía en Integraciones › GoHighLevel › «Eventos en tiempo real»).
2. Verifica en una cuenta real: que el token tiene lectura de conversaciones y mensajes, y que el cuerpo del webhook trae
   `conversationId, messageId, contactId, direction, messageType, body, dateAdded`.
3. **Conversaciones → Agente de IA** (admin/director): guion, enlace de agenda en `https`, topes y horario. Deja
   «autónomo» apagado.
4. Activa el agente y pon UNA conversación de prueba en «Borrador»; aprueba los borradores a mano. Solo cuando sean buenos,
   permite el modo autónomo y úsalo en conversaciones concretas.
5. Opcional: casilla de reparto automático (round-robin) y respuestas rápidas desde la bandeja.

## 4. Pendientes del propietario

| #   | Qué                     | Cómo                                                                                                                                                                                                        |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Experimento A/B del VSL | Pegar el snippet de `docs/VSL_AB_OCT26.md` en vibepreview (crítico el 2-nov)                                                                                                                                |
| 2   | Backup nocturno         | Añadir los secretos `BACKUP_DATABASE_URL` y `BACKUP_PASSPHRASE` en GitHub (Settings › Secrets › Actions); sin ellos falla cada noche                                                                        |
| 3   | Calendly                | Crear la suscripción de webhook (`POST /webhook_subscriptions`); hoy las citas solo entran por el cron diario                                                                                               |
| 4   | Typeform                | Añadir los campos ocultos `utm_source`, `utm_medium`, `utm_campaign`, `ref` a la URL del formulario y `purpose=feedback` en los de feedback                                                                 |
| 5   | Meta CAPI/Pixel         | Decidir si se activa (Pixel ID + token `ads_management` + `META_CAPI_ENABLED`); volver a pegar `META_APP_SECRET` y `RESEND_API_KEY`                                                                         |
| 6   | Resto                   | Cada closer conecta Fathom y Google Calendar; 48 asistencias por marcar; un contrato «Firmado fuera»; GA4; orígenes del píxel; rate limiting en Cloudflare; protección de contraseñas filtradas en Supabase |
| 7   | Probar tras desplegar   | Un email real desde Configuración › Correos; un cobro con otro correo; un formulario público; Contactos/Agendas como closer                                                                                 |

## 5. Decisión pendiente

- **SDK de Anthropic 1.x**: quita `temperature` de `messages.create` y rompe `lib/ai/provider.ts`. Migrar a mano con pruebas
  cuando quieras; Dependabot ya lo ignora.

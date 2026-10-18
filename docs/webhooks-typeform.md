# Webhook de Typeform

Respuestas de formularios en tiempo real, para **cualificar leads antes de agendar** y para **feedback de alumnos**.

- **URL:** `POST /api/{subcuenta}/evergreen/webhooks/typeform`
- **Firma:** cabecera `Typeform-Signature: sha256=<base64 HMAC-SHA256 del cuerpo crudo>`, con el secreto que se escribe al crear el webhook. Se guarda por subcuenta en Integraciones → Typeform (`TYPEFORM_WEBHOOK_SECRET`). Sin secreto guardado se rechaza todo.
- **Idempotencia:** el `token` de la respuesta. Un reintento reprocesa la misma fila de `raw_events` y no duplica contacto, evento de CSM ni hecho canónico.

## Alta (por formulario)

1. Typeform → formulario → **Connect → Webhooks → Add a webhook**.
2. Destination URL = la URL de arriba; **Secret** = una frase larga; activa el webhook.
3. Pega el mismo secreto en Integraciones → Typeform.
4. El formulario debe pedir el **email** (campo de tipo Email) o el teléfono: sin ninguno no se puede encajar a nadie y la respuesta queda guardada en `raw_events` para enlazarla a mano.

## Cualificación de leads (por defecto)

- Encaja el contacto por email → teléfono, o lo crea con canal `typeform`.
- Guarda las respuestas en `contacts.qualification` (mismo formato que Calendly: claves conocidas como `ingresos`, `situacion`… más `respuestas`). Lo nuevo gana en sus claves; lo que Calendly ya traía se conserva.
- Las copia a las **agendas** existentes de la persona (no a las canceladas). Si la agenda ya trae respuestas propias, ganan las de la agenda y Typeform solo rellena lo que falta.
- Las agendas que se creen **después** (Calendly, GHL, sync, alta manual) las heredan por el trigger `appointments_heredar_cualificacion` (migración `20261018100000`), solo si llegan sin respuestas.
- Atribución: campos ocultos `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`… y `ref` (código de colaboradora, p. ej. `WDC-0472`) → atribuye el lead a su perfil. Añádelos a la URL del formulario (`?utm_source=ig&ref=WDC-0472`).

## Feedback de alumnos

Un formulario es de feedback si su URL lleva el campo oculto `purpose=feedback` (o `tipo=feedback`), o si su id está en `TYPEFORM_FEEDBACK_FORMS`. El campo oculto manda sobre la lista.

- **No crea contactos** (un alumno que contesta una encuesta no es un lead y contaminaría «New Unique Leads»).
- Si encuentra a la persona por email/teléfono, deja un evento de CSM (`type: revision`, `status: completado`) con las respuestas y la **nota 0-10** si el formulario trae una escala (`opinion_scale` tal cual; `rating` 1-5 ×2).
- Si no la encuentra, el envío queda en `raw_events` y se responde `contacto: false` para enlazarlo a mano.

## Qué queda registrado

`raw_events` (payload completo, también los rechazos de firma, sin cuerpo) y `canonical_events` con `typeform.formulario.enviado` (sin datos personales: formulario, propósito, nº de respuestas, nota).

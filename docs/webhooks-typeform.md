# Webhook de Typeform

Respuestas de formularios en tiempo real, para **cualificar leads antes de agendar** y para **feedback de alumnos**.

- **URL:** `POST /api/{subcuenta}/evergreen/webhooks/typeform`
- **Firma:** cabecera `Typeform-Signature: sha256=<base64 HMAC-SHA256 del cuerpo crudo>`, con el secreto que se escribe al crear el webhook. Se guarda por subcuenta en Integraciones → Typeform (`TYPEFORM_WEBHOOK_SECRET`). Sin secreto guardado se rechaza todo.
- **Idempotencia:** el `token` de la respuesta. Un reintento reprocesa la misma fila de `raw_events` y no duplica contacto, evento de CSM ni hecho canónico.

## Alta (por formulario)

1. Typeform → formulario → **Connect → Webhooks → Add a webhook**.
2. Destination URL = la URL de arriba; déjalo en **On**.
3. Genera un secreto con el botón «Generar un secreto» de Integraciones → Typeform y pégalo en DOS sitios, idéntico: en Typeform → **Edit → Add a Secret**, y en el campo «Secret del webhook» de Integraciones → Typeform (guardar). Sin secreto Typeform no manda la firma y la app rechaza todo.
4. El formulario debe pedir el **email** (campo de tipo Email) o el teléfono: sin ninguno no se puede encajar a nadie y la respuesta queda guardada en `raw_events` para enlazarla a mano.

## Cómo comprobar que llega

Envía el formulario **público** con tu email (la vista previa del editor no dispara el webhook). En Typeform → Webhooks → **View deliveries** debe salir 200; en Integraciones → Typeform, «Último evento» cambia. 401 = el secreto no coincide en los dos sitios; 404 = la dirección está mal; sin entregas = el webhook está apagado o no se envió el formulario.

## Cualificación de leads (por defecto)

- Encaja el contacto por email → teléfono, o lo crea con canal `typeform`.
- Guarda las respuestas en `contacts.qualification` (mismo formato que Calendly: claves conocidas como `ingresos`, `situacion`… más `respuestas`). Lo nuevo gana en sus claves; lo que Calendly ya traía se conserva.
- Las copia a las **agendas** existentes de la persona (no a las canceladas). Si la agenda ya trae respuestas propias, ganan las de la agenda y Typeform solo rellena lo que falta.
- Las agendas que se creen **después** (Calendly, GHL, sync, alta manual) las heredan por el trigger `appointments_heredar_cualificacion` (migración `20261018100000`), solo si llegan sin respuestas.
- Atribución: campos ocultos `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`… y `ref` (código de colaboradora, p. ej. `COLAB-0001`) → atribuye el lead a su perfil. Añádelos a la URL del formulario (`?utm_source=ig&ref=COLAB-0001`).

## Feedback de alumnos

Un formulario es de feedback si su URL lleva el campo oculto `purpose=feedback` (o `tipo=feedback`), o si su id está en `TYPEFORM_FEEDBACK_FORMS`. El campo oculto manda sobre la lista.

- **No crea contactos** (un alumno que contesta una encuesta no es un lead y contaminaría «New Unique Leads»).
- Si encuentra a la persona por email/teléfono, deja un evento de CSM (`type: revision`, `status: completado`) con las respuestas y la **nota 0-10** si el formulario trae una escala (`opinion_scale` tal cual; `rating` 1-5 ×2).
- Si no la encuentra, el envío queda en `raw_events` y se responde `contacto: false` para enlazarlo a mano.

## Qué queda registrado

`raw_events` (payload completo, también los rechazos de firma, sin cuerpo) y `canonical_events` con `typeform.formulario.enviado` (sin datos personales: formulario, propósito, nº de respuestas, nota).

## Histórico (respuestas anteriores al webhook)

El webhook solo recoge lo que llega **después** de crearlo. Quien rellenó el formulario antes —o en un formulario sin webhook— llega a la agenda sin sus respuestas. Para recuperarlas:

1. Typeform → Account → **Personal tokens** → generar un token con `forms:read` y `responses:read`. Pegarlo en Integraciones → Typeform → «Token personal» (y `eu` en «Región» si la cuenta es del centro de datos europeo).
2. Integraciones → Typeform → **Sincronizar histórico**. Recorre todos los formularios de la cuenta (últimos 120 días), por lotes reanudables.

Reglas:

- Pasa por el **mismo motor** que el webhook (`procesarRespuestaTypeform`): idempotente por el `token` de la respuesta; lo ya normalizado se salta.
- **No crea contactos**: solo encaja con los existentes (email principal, email alternativo recordado, teléfono). Crear cientos de leads con fecha antigua movería las métricas de periodos cerrados. Lo que no encaja queda en `raw_events` y se cuenta como «sin contacto».
- Un email repetido en varios contactos, o un teléfono compartido, **no se adivina**.
- Copia las respuestas a las agendas existentes no canceladas (la agenda manda en lo que ya contestó).
- Límite: si la persona usó en Typeform un correo distinto al de Calendly y no hay teléfono en común, no hay forma segura de unirlos automáticamente.

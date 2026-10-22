# Conversaciones y agente de IA de setting

Bandeja de los mensajes de tus leads (Instagram, Facebook, WhatsApp… vía GoHighLevel) y un agente de IA que cualifica por
mensaje directo. Ideas tomadas de Chatwoot (MIT): estados, ventana de mensajería, desduplicación de ecos, traspaso a humano.
No se ha copiado código; las carpetas `enterprise/` de Chatwoot (SLA, capacity, Captain) solo se miraron como idea.

## Cómo está montado

- **Entrada:** webhook `POST /api/{subcuenta}/evergreen/webhooks/ghl-mensajes` (mismo secreto `x-ghl-secret` que el de citas).
  Guarda cada mensaje de forma idempotente (`conversation_messages`, único por subcuenta + id de mensaje) y actualiza la
  conversación (`conversations`). Auditoría en `conversation_events`.
- **Pantalla:** Conversaciones (menú, junto a Setting AI): lista por estado, hilo, resolver/aplazar/reabrir, responder,
  borradores del agente y métricas. Lecturas por RLS; toda escritura pasa por rutas del servidor.
- **Estados:** `abierta`, `pendiente` (la atiende la IA), `aplazada`, `resuelta`. El traspaso a humano es `pendiente → abierta`.
- **Ventana:** la IA responde solo dentro de 24 h desde el último mensaje del lead (Instagram/Facebook). Nunca se escribe en
  frío. TikTok: la API de mensajería de TikTok Business no está disponible en el EEE; solo lectura vía GHL.
- **Agente:** tras un mensaje entrante NUEVO el webhook lanza `procesarMensajeEntrante` en segundo plano. Orden: ¿puede actuar?
  (`decidirAgente`) → ¿ya procesado? → ¿señal de traspaso? (`evaluarTraspaso`) → redactar con la IA de la subcuenta →
  `validarBorrador` → borrador para aprobar o envío autónomo. La IA solo REDACTA; decide el código.

## Reglas duras (no negociables, probadas)

- **Apagado por defecto.** Sin configuración con `activo: true` no hace nada ni llama a la IA.
- **Autónomo** solo si la subcuenta lo permite Y la conversación está en autónomo; si no, siempre borrador.
- Se calla si una persona respondió, tras 2 mensajes seguidos sin respuesta del lead, al llegar al tope diario o fuera de horario.
- Traspaso inmediato por señales: pide una persona o pregunta si es un bot, enfado, STOP/baja (además etiqueta `no-contactar`),
  precio/financiación/condiciones, intención de compra alta, datos de pago o personales, baja confianza.
- El texto del modelo se rechaza (→ traspaso) si trae precios o condiciones, datos de pago, un enlace distinto del de agenda,
  afirma ser una persona, está vacío, pide `TRASPASO` o es demasiado largo. El borrador editado por una persona se re-valida.
- Nunca toca ventas, cobros ni comisiones (`docs/MONEY.md`).
- Fallo de IA, validación o envío → pasa a una persona y se anota; nunca se reintenta a ciegas.
- El eco que GHL devuelve de un envío de la IA se guarda como mensaje de la IA (no como respuesta humana).

## Activarlo (paso a paso)

1. Conectar el webhook de mensajes en GHL (Integraciones › GoHighLevel › «Eventos en tiempo real» trae la guía).
2. Conversaciones › Configurar el agente (solo admin/director): guion, enlace de agenda https, topes y horario. Dejar
   «Permitir autónomo» apagado al principio.
3. Activar el agente y poner UNA conversación de prueba en «Borrador»; comprobar los borradores y aprobarlos a mano.
4. Cuando los borradores sean buenos, permitir autónomo y poner conversaciones concretas en «Autónomo».

## Pendiente de verificar con una cuenta real (no se pudo desde el desarrollo)

- Escopes del token de GHL: hace falta lectura de conversaciones y mensajes además de `conversations/message.write`.
- Que el workflow de GHL envíe el cuerpo con `conversationId, messageId, contactId, direction, messageType, body, dateAdded`.
- Si GHL permite/rechaza enviar por «IG» fuera de las 24 h (hoy la app impone 24 h para todos).
- Que el eco saliente de GHL trae el mismo texto que se envió (así se reconoce).

## Datos personales

Los mensajes son datos personales: entran en el mapa de PII. Pendiente incluir `conversation_messages` y `conversations` en el
plan de borrado de personas (`lib/privacidad/*`).

## Reparto, memoria y borrado de datos personales

- **Reparto round-robin** (`lib/conversaciones/reparto.ts`, `asignar.ts`): apagado por defecto (casilla en la configuración
  del agente). Reparte entre los setters ACTIVOS de la subcuenta (`users.role_id` → `roles.key = 'setter'` y miembro del
  tenant): gana la menor carga viva (abiertas + pendientes, tope 40), luego quien lleva más sin recibir una. Solo rellena
  huecos (`assignee_id is null`), nunca pisa una asignación humana, y deja un evento `asignacion` con `auto: true`.
  Se aplica a conversaciones atendidas por personas y a los traspasos de la IA.
- **Memoria por contacto** (`memoria.ts`, `memoria-bd.ts`): resumen en `conversations.summary` de lo que ya no cabe en el
  prompt (más de 24 turnos), actualizado cada ≥4 mensajes nuevos (evento `resumen` con la marca `hasta`), más los resúmenes
  de otras conversaciones de la misma persona. Es texto de un modelo sobre texto del lead: se limpia (sin enlaces, sin
  cabeceras de rol, sin `TRASPASO`, ≤700 car.) y entra al prompt etiquetado como DATOS. Si falla, el agente sigue sin memoria.
- **Borrado de personas**: `erase_person` borra las conversaciones del contacto (por `contact_id` y por el id de GHL, para
  las que nunca se enlazaron); mensajes, borradores y resumen caen en cascada. Ver `docs/F6-MAPA-PII.md` §1.1.

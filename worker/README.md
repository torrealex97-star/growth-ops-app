# worker/ — transcripción y análisis de llamadas

Proceso Node **standalone** (fuera de Vercel): acompaña a la app usando la misma base de
Supabase, pero no corre en el despliegue de Next._estado real: **nunca se ha desplegado a
producción** — la generación automática de tareas está desactivada y retomarlo es una
decisión de producto pendiente (ver `docs/PRODUCTION_READINESS.md`, hallazgo "worker/
huérfano sin dueño").

## Qué hace (flujo real, leído de `index.mjs`)

Cada tick (cada `POLL_INTERVAL_MS`, 20 s por defecto):

1. Toma **una** cita `appointments` con `transcript_status='pendiente'` y
   `transcript_drive_url` no nulo (orden `updated_at ASC`, `limit 1`) y la marca
   `procesando`.
2. Descarga la grabación de Google Drive (service account JWT si hay
   `GOOGLE_SERVICE_ACCOUNT_JSON`; si no, solo archivos "cualquiera con el enlace").
3. `ffmpeg` (binario de `ffmpeg-static`): remuestrea a 16 kHz mono 24 kbps y trocea en
   segmentos de 10 min (<25 MB cada uno, límite de la API de Groq).
4. Transcribe cada trozo con Groq Whisper (`large-v3-turbo`) y une el texto.
5. Claude (`claude-sonnet-5`) devuelve JSON con `call_score`, `lead_score`,
   `suggested_stage`, `summary`, `objections`, `next_steps`.
6. Guarda en `appointments`: `transcript`, `transcript_status='listo'` y los campos
   `ai_*`. Si el guardado falla, el estado NO se marca `listo`: se propaga y el catch
   de `tick()` marca `error` (con el motivo en `ai_summary`).

Los errores por cita marcan `transcript_status='error'`; la cita siguiente se procesa
en el siguiente tick. La generación automática de tareas al comercial está
**desactivada** en el código (comentario: pendiente de entrenamiento), aunque el análisis
sigue devolviendo `tasks` en el JSON.

## Cómo se ejecutaría (si se retoma la decisión)

Paquete propio con sus dependencias en `worker/package.json`; corre como un Node
apartado (≥20), típico de una VM/Cron pequeña con red de salida a Drive/Groq/Anthropic:

```bash
cd worker
npm install
npm start   # node index.mjs
```

Variables de entorno que exige el código al arrancar (están en Secretos del entorno,
nunca en un commit):

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (service-role: solo servidor, este worker físicamente
  escribe en `appointments` sin pasar por RLS)
- `GROQ_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (opcional; sin él solo lee grabaciones compartidas
  como "cualquiera con el enlace")
- `POLL_INTERVAL_MS` (opcional, por defecto `20000`)

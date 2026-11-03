# Carruseles — motores de IA

El generador de carruseles (chat y «casos de éxito») no depende de una sola clave. Basta **una** de estas, por subcuenta, en Ajustes → Integraciones → IA:

| Clave               | Texto / maquetación    | Imágenes                                   |
| ------------------- | ---------------------- | ------------------------------------------ |
| `ANTHROPIC_API_KEY` | Sí (motor por defecto) | No                                         |
| `GEMINI_API_KEY`    | Sí                     | Sí (Nano Banana, `gemini-2.5-flash-image`) |
| `OPENAI_API_KEY`    | Sí                     | Sí (`gpt-image-1`)                         |

- Orden de elección: Anthropic → Gemini → OpenAI. Se fuerza con `CARRUSELES_IA_MOTOR` (texto) y `CARRUSELES_IMAGEN_MOTOR` (imágenes: Gemini → OpenAI por defecto).
- Los modelos se pueden cambiar por subcuenta (`GEMINI_MODELO_TEXTO`, `GEMINI_MODELO_IMAGEN`, `OPENAI_MODELO_TEXTO`, `OPENAI_MODELO_IMAGEN`) porque los proveedores renombran modelos.
- Con clave de imágenes el agente dispone de la herramienta `generate_image` (flyers, historias 9:16, portadas). Las imágenes se piden **sin texto pintado** y con zona despejada para el titular: el texto lo pone el HTML de la slide. Se guardan en el bucket público `carrusel-uploads` y se referencian por URL. Máximo 4 imágenes por petición.
- Sin ninguna clave la API responde 503 con el mensaje de `MENSAJE_SIN_MOTOR`.
- Código: `lib/ai/{gemini,openai}.ts`, `lib/carruseles/{motor,imagenes}.ts`, ruta `carruseles/chat`.

## Historias (9:16): composición por plantillas

Las historias NO las maqueta la IA: elige una **plantilla** y el texto (`add_story` / `update_story`) y el código las compone
(`lib/carruseles/historias/layouts.ts`). Así la fecha, el logo, el titular y los stickers van en zonas que no se pisan (cabecera
arriba; contenido en una columna dentro de la zona segura) y la app decide si va foto limpia, foto oscurecida o fondo liso.

- Plantillas: `portada`, `texto`, `foto_texto`, `comparacion`, `sticker`, `cifra`, `partida`. Todo texto se escapa y se acota.
- **Estilos** elegibles en el panel (`lib/carruseles/estilos.ts`): Editor de Instagram, Editorial, Limpio y De marca. Cambian la composición (cajas, velo,
  logo), nunca la identidad.
- **Marca**: colores, tipografías y logo salen de la marca de la subcuenta (`carrusel_brand`); si faltan, heredan el nombre y el logo de
  Configuración › Marca. Las tipografías de marca viajan como variables CSS (`--ig-f-titulo`, `--ig-f-cuerpo`).
- **Fotos y vídeos** (panel «Fotos y vídeos»): imágenes hasta 15 MB y vídeos MP4/WEBM/MOV hasta 50 MB. Los vídeos se reproducen de fondo (mudos, en bucle);
  al exportar PNG se usa un fotograma. El vídeo final con texto no se renderiza todavía: el PNG es la capa visual.
- El bucket `carrusel-uploads` se crea solo en la primera subida (`lib/carruseles/almacen.ts`); en producción no existía y toda subida fallaba.

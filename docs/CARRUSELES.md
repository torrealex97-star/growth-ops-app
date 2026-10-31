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

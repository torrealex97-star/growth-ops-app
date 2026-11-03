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

## Historias y carruseles: productos separados, ejemplos del tenant y material real

- **Separación**: el listado tiene pestañas Historias / Carruseles / Flyers y cada una crea lo suyo (`lib/carruseles/tipos.ts`). Las historias son siempre 9:16 y van por
  plantillas; los carruseles (4:5 o 1:1) siguen siendo diseño libre y creativo (estilos Diseñado, Con foto, Minimal, De marca), con foto detrás solo si se pide.
- **Texto de historias como en Instagram**: tipografías parecidas a las del editor (`classic`, `modern`, `neon`, `typewriter`, `strong`, `serif`; Instagram no publica las suyas, se
  afinan con los ejemplos del tenant) y fondos de texto sin caja / sólida / translúcida (blanco, negro o marca). Los emojis son texto Unicode: los pinta la fuente del
  dispositivo (Apple Color Emoji en iPhone/Mac; su fuente no se puede incluir en la app por licencia), también al exportar desde ellos.
- **Mis ejemplos** (`lib/carruseles/ejemplos.ts`): capturas de historias y carruseles del tenant → guía de estilo analizada por visión (editable), guardada en
  `tenants.settings.carruseles_ejemplos`. Entra en el prompt de su producto y se adjuntan hasta 3 ejemplos como imagen.
- **Material real** (`lib/carruseles/historias/pedidos.ts`): plantilla `captura` con `pedido`. La IA nunca inventa pagos, testimonios ni resultados: pide el material y la
  pantalla muestra «Falta material real». Cada historia lleva su especificación incrustada (`data-spec`), así `recomponerHistorias` la recompone sin IA al subir el
  material o cambiar de estilo. El bucket es público (enlace no listado): avisar de tapar datos personales.

## Edición en el visor

El editor (`components/carruseles/VisorEditable.tsx`) permite retocar sin IA: las **historias nuevas** (con especificación incrustada) se editan por campos —plantilla, titular, palabra
resaltada, texto, tipografía, caja, color y fondo— y se recomponen en el navegador (`renderHistoria` es código de cliente, sin módulos de servidor). Se **arrastra el bloque de texto**
en vertical (asa «mover texto», también con flechas del teclado; `spec.posicion` es el borde superior del bloque, siempre debajo de la cabecera de fecha/logo y dentro de la zona segura) y se **suelta una foto** de «Fotos y vídeos» sobre la historia para ponerla de fondo.
El resto de slides (carruseles, flyers, historias antiguas) se editan por **lista de textos** (`lib/carruseles/historias/edicion.ts`). El reordenado de slides ya existía en el filmstrip.

### Productividad para producir historias (agencia con muchos clientes)

- **Revisión de la secuencia** (`lib/carruseles/historias/revision.ts`): tiempo de lectura por historia frente a los ≈5 s que dura, gancho de ≤12 palabras con palabra resaltada, última historia con acción, emojis (máx. 2), ritmo (no
  tres plantillas iguales seguidas), longitud de la secuencia y material real pendiente. Cada aviso lleva a su historia.
- **Instagram o TikTok**: cambia los márgenes de la interfaz de cada red (`SEGURA_POR_PLATAFORMA`, valores aproximados) y recompone las historias sin IA; «Guías de la app» las dibuja sobre la vista previa.
- **Variantes con IA por historia** (`/carruseles/variantes`): 3 ganchos, otra versión o más corto; la IA solo propone y la persona elige (no guarda sola).
- **De idea a historias**: «Crear historias con esta idea» en Marketing › Ideas abre el creador con el tema escrito.

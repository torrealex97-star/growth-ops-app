# Historias «nativas»: reglas de estilo y categorías

Fuente: análisis de secuencias reales de historias de creadores (formato, ritmo, tratamiento de la
foto y colocación del texto). Se extraen **patrones**, no se reproducen imágenes ni textos de nadie.
Código: `lib/carruseles/historias/` (`categorias.ts`, `estilo-nativo.ts`); el CSS se inyecta en
`wrapSlideHtml` para proyectos 9:16 y el agente lo usa por clases `ig-*` (`lib/carruseles/system-prompt.ts`).

## Por qué parece hecho en el editor de la red (y no un diseño externo)

1. **Texto en cajas** (blanca o negra semitransparente) o con **marcador** sobre una palabra, no flotando.
2. **Un solo acento de color** y **una palabra marcada** por historia: jerarquía en 1,5 s.
3. **La foto es textura**: oscurecida 60-75 % cuando manda el texto; limpia en el gancho y el cierre.
4. **La misma persona y el mismo lugar** en toda la secuencia: familiaridad y confianza.
5. **Imperfecciones de creador**: flechas a mano, emojis grandes, etiqueta de fecha, chip numerado, stickers.
6. **Bucles abiertos** entre historias y **prueba con números reales** como retención y credibilidad.
7. **CTA de fricción mínima**: una palabra clave por mensaje, pregunta o sticker.

## Categorías (3, 5 o 7 historias; todas empiezan en gancho y terminan en CTA)

| Categoría            | Cuándo                       | Rasgos                                              |
| -------------------- | ---------------------------- | --------------------------------------------------- |
| `opinion_error`      | Posicionarte con una tesis   | Plano a cámara constante; «El mayor error que veo…» |
| `antes_ahora`        | Explicar un cambio de método | Fondo muy oscuro, recuadros 2025/2026, ☠️ ⚠️ ✅ ❌  |
| `contraste_nivel`    | Dos niveles o enfoques       | Pantalla partida, B/N frente a color                |
| `pregunta_respuesta` | Interacción y criterio       | Sticker de preguntas, respuesta a cámara            |
| `caso_prueba`        | Demostrar resultados         | Capturas de analíticas, «Logro / Qué he hecho»      |
| `marco_diagrama`     | Enseñar un método            | Esquema sobre selfie, chips 1️⃣ 2️⃣ 3️⃣, flechas       |
| `insider`            | Despertar curiosidad         | Foto expresiva, titular en caja de acento           |

## Etapas

`gancho` (foto limpia, titular arriba) · `problema` · `cambio` (comparar, fondo oscuro) · `ejemplo` ·
`prueba` (capturas, solo cifras reales del negocio) · `porque` · `objecion` · `cta` (foto cálida, una acción).

## Límites

Las fuentes exactas de los originales no se pueden confirmar: se usan equivalentes de Google Fonts
(DM Serif Display, Newsreader, Anton, Space Mono). Vídeo y biblioteca de fotos etiquetada: fases posteriores.

import type { BrandConfig, CarruselProject } from './types'
import { DIMENSIONS, MAX_SLIDES } from './types'
import { seccionHistoriasPrompt } from './historias/categorias'
import { estiloPorDefecto, seccionEstiloPrompt, type OpcionesEstilo } from './estilos'
import { tipoDeMedio } from './almacen'
import { seccionGuiaPrompt } from './ejemplos'

export interface BrandAsset {
  url: string
  name: string
}

/** «2 nov. 2026» → partes para <div class="ig-etiqueta-fecha">. */
export function fechaEtiqueta(d: Date): string {
  const mes = new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(d).replace('.', '')
  return `<span>${d.getDate()}</span><span>${mes}.</span><span>${d.getFullYear()}</span>`
}

export function buildSystemPrompt(
  brand: BrandConfig,
  project: CarruselProject,
  businessContext?: string | null,
  brandAssets?: BrandAsset[],
  /** ¿Hay clave para generar imágenes con IA (Gemini/OpenAI)? Activa la herramienta `generate_image` y su guía. */
  imagenesIA = false,
  /** Fecha de hoy (para la etiqueta de fecha de las historias). Se inyecta en los tests. */
  hoy: Date = new Date(),
  /** Estilo elegido en el proyecto y si las fotos subidas van de fondo. Por defecto: nativo; fotos de fondo solo en historias. */
  opciones?: OpcionesEstilo,
  /** Guía de estilo sacada de los ejemplos del tenant y cuántos de ellos se adjuntan como imagen. */
  guiaEstilo?: { texto: string; adjuntas: number }
): string {
  const dims = DIMENSIONS[project.aspectRatio]
  const isFlyer = project.kind === 'flyer'
  // Un carrusel en formato 9:16 es una secuencia de HISTORIAS: se trabaja con el estilo «editor nativo».
  const esHistorias = !isFlyer && project.aspectRatio === '9:16'

  const opcionesEstilo: OpcionesEstilo = opciones ?? {
    estilo: estiloPorDefecto(esHistorias),
    fotosDeFondo: esHistorias,
  }

  const brandSection = brand.name
    ? `## Identidad de marca
- Nombre: ${brand.name}
- Primario: ${brand.colors.primary} | Secundario: ${brand.colors.secondary} | Acento: ${brand.colors.accent}
- Fondo: ${brand.colors.background} | Superficie: ${brand.colors.surface}
- Fuente titulares: "${brand.fonts.heading}" | Fuente cuerpo: "${brand.fonts.body}"
- Logo: ${brand.logoUrl ? brand.logoUrl : 'ninguno'}
- Estilo: ${brand.styleKeywords.length > 0 ? brand.styleKeywords.join(', ') : 'profesional, limpio, moderno'}`
    : `## Marca sin configurar
Usa valores por defecto profesionales: texto oscuro sobre fondos claros, tipografía Inter, estilo minimalista y limpio.`

  const slidesList =
    project.slides.length > 0
      ? project.slides.map((s, i) => `  - Slide ${i + 1} (id: ${s.id})${s.notes ? ` — ${s.notes}` : ''}`).join('\n')
      : '  (todavía sin slides)'

  const refImages =
    project.referenceImages.length > 0
      ? esHistorias
        ? `\n## Fotos y vídeos subidos para esta secuencia (las imágenes se adjuntan en el chat; los vídeos no se ven pero se reproducen de fondo)
${project.referenceImages.map((r, i) => `${i + 1}. "${r.name}" (${tipoDeMedio(r.url) === 'video' ? 'vídeo' : 'foto'})`).join('\n')}
Indica cuál va en cada historia con el campo foto (su número). Asigna la más luminosa al gancho, la más cálida al cierre y las oscuras al desarrollo; los vídeos, a las historias donde la persona habla. Si no pones foto, la app reparte sola.`
        : `\n## Imágenes de referencia (se adjuntan como imágenes en el chat cuando existen)
${project.referenceImages.map((r) => `- "${r.name}"`).join('\n')}
Estudia colores, tipografía, composición y estilo de estas referencias y replica ese estilo visual.
Si el usuario pide usar una imagen concreta (ej. "una foto de X"), usa la referencia más reciente que encaje con esa descripción.`
      : ''

  const businessSection =
    businessContext && businessContext.trim()
      ? `\n## Contexto de negocio (usa esto para que el contenido sea relevante y específico)
${businessContext.trim()}
Adapta el tono, los ejemplos, los avatares/dolores y las llamadas a la acción de cada slide a este negocio concreto — evita el contenido genérico.`
      : ''

  const assetsSection =
    brandAssets && brandAssets.length > 0
      ? `\n## Assets de marca disponibles (logos, fotos, productos)
${brandAssets.map((a) => `- "${a.name}": ${a.url}`).join('\n')}
Usa estas URLs completas en etiquetas <img src="..."> dentro del HTML de las slides cuando encajen (logo en la esquina, foto de producto/equipo, etc). Algunas se adjuntan también como imágenes en el chat para que estudies su estilo.`
      : ''

  const arc = esHistorias
    ? `${seccionHistoriasPrompt()}\n- ${project.referenceImages.length > 0 ? 'Usa SOLO las fotos y vídeos subidos que aparecen arriba; nunca inventes URLs.' : 'No hay fotos ni vídeos subidos: las historias llevarán fondo liso del color de la marca. Dilo en una frase y sugiere subir fotos o vídeos de la persona para un resultado más real; NUNCA inventes URLs de fotos.'}\n- La fecha, el logo, las tipografías y los colores de la marca los pone la app: no los escribas.\nTras crear todas las historias, ofrece el copy del post con set_caption.`
    : isFlyer
      ? `## Cómo trabajas con FLYERS
Un flyer es UNA sola pieza de diseño de alto impacto (no un carrusel). Cuando el usuario te dé un tema:
1. Crea normalmente UNA slide (usa add_slide una vez). Si te piden variantes, crea varias slides como opciones.
2. El flyer debe tener: título potente, subtítulo/beneficio, datos clave (fecha, lugar, precio, CTA) y un diseño rico con jerarquía visual clara.
3. Aprovecha TODO el lienzo (${dims.width}x${dims.height}px): fondos con gradientes/formas, buena tipografía, contraste alto.`
      : `## Cómo trabajas con CARRUSELES (modo autónomo)
Cuando el usuario te dé un TEMA o IDEA, empieza a crear slides de inmediato — no pidas permiso.
Si el usuario especifica un número de slides (ej. "de 6 slides"), usa EXACTAMENTE ese número. Si no lo especifica, planifica un arco de ${Math.min(8, MAX_SLIDES)} slides:
- Slide 1: GANCHO — pregunta provocadora, dato impactante o afirmación contraria (máx 8 palabras, texto enorme)
- Slides 2-3: contexto/problema
- Slides 4-6: valor — una idea clave por slide, texto punchy
- Slide 7: resumen o transformación
- Slide 8 (última): CTA — "Sígueme para más", "Guarda esto", "Comparte con quien lo necesite"
Si el arco es más corto (ej. 3 slides), comprime: Slide 1 GANCHO, Slide(s) intermedia(s) VALOR, última slide SIEMPRE CTA.
Si el usuario te da una URL, extrae los puntos clave; si te da texto, úsalo directamente.
Un carrusel puede ser muy creativo: fondos de color o diseñados, bloques, formas y estructuras llamativas. No hace falta una foto detrás de todas las slides; usa fotos solo donde aporten. Si hay ejemplos de carruseles del tenant, replica su estructura.
Tras crear todas las slides, ofrece generar el copy (caption + hashtags) con set_caption.`

  const estiloSection = isFlyer
    ? ''
    : `\n\n${seccionEstiloPrompt({
        opciones: opcionesEstilo,
        esHistorias,
        brand,
        fotos: project.referenceImages.map((r) => ({ name: r.name, url: r.url })),
      })}${seccionGuiaPrompt(esHistorias ? 'historias' : 'carrusel', guiaEstilo?.texto, guiaEstilo?.adjuntas ?? 0)}`

  const alta = esHistorias ? 'add_story' : 'add_slide'

  return `Eres el motor de diseño IA autónomo de "Carruseles & Flyers". Creas ${
    isFlyer ? 'flyers' : 'carruseles de Instagram'
  } espectaculares de forma proactiva. Respondes SIEMPRE en español.

${brandSection}
${businessSection}
${assetsSection}

## Proyecto actual
- Tipo: ${isFlyer ? 'FLYER' : 'CARRUSEL'}
- Título: "${project.title}"
- Formato: ${project.aspectRatio} (${dims.width}x${dims.height}px)
- Slides: ${project.slides.length}/${MAX_SLIDES}
${slidesList}
${refImages}

${arc}${estiloSection}

## Herramientas disponibles
Usa las herramientas (tools) para modificar el proyecto. NO uses curl ni bash — solo las tools:
${
  esHistorias
    ? `- add_story({ layout, titulo, acento, texto, items, sticker, cifra, foto, fondo, fecha, ultima }) — añade una historia con una plantilla (la app la compone)
- update_story({ slideId, ...mismos campos }) — rehace una historia
- delete_slide({ slideId }) — elimina una historia`
    : `- add_slide({ html, notes }) — añade una slide nueva al final
- update_slide({ slideId, html, notes }) — reemplaza el HTML de una slide (guarda versión anterior)
- delete_slide({ slideId }) — elimina una slide`
}
- set_caption({ caption, hashtags }) — guarda el pie de foto y hashtags de Instagram
${imagenesIA ? '- generate_image({ prompt, aspect? }) — GENERA una imagen con IA y devuelve su URL pública (ver «Imágenes con IA»)\n' : ''}
${
  esHistorias
    ? ''
    : `## Reglas del HTML de cada slide (CRÍTICO)
Cada slide es HTML a nivel de BODY. No incluyas <!DOCTYPE>, <html>, <head> ni <body> — el sistema los añade.
1. Solo estilos inline o etiquetas <style>. Nada de CSS externo.
2. Las declaraciones font-family cargan Google Fonts automáticamente (ej: font-family: 'Playfair Display', serif).
3. Dimensiones exactas: ${dims.width}x${dims.height}px. El contenedor raíz debe ocupar width:${dims.width}px; height:${dims.height}px.
4. Usa la paleta de marca: primario para titulares, acento para CTAs, fondo para el background.
5. Imágenes: usa las URLs completas de las referencias/logo si están disponibles.
6. NADA de JavaScript (el sandbox lo bloquea).
7. Usa flexbox/grid para el layout, absolute para overlays.

`
}${
    esHistorias
      ? `## Diseño de historias
El diseño NO se inventa: lo componen las plantillas de la app (foto limpia, foto oscurecida o fondo liso, fecha, logo y stickers sin que se pisen). Tú pones plantilla, texto y qué foto va en cada una. Una idea por historia y consistencia total entre historias.`
      : `## Inteligencia de diseño
- Tipografía: ganchos 64-110px bold; contenido título 36-52px, cuerpo 24-30px; máx 2 familias tipográficas; line-height 1.2 titulares, 1.5 cuerpo.
- Color y contraste: ratio texto/fondo > 4.5:1 siempre; gradientes para dar profundidad; colores sólidos > patrones recargados.
- Layout: 60-90px de padding mínimo; un mensaje clave por slide; consistencia visual entre slides; varía los fondos para mantener interés.
- Instagram: diseño mobile-first; mantén el contenido crítico en el 80% central; en la slide 1 añade un indicador de swipe sutil.`
  }

${
  imagenesIA
    ? `## Imágenes con IA (generate_image)
Puedes crear imágenes originales: fondos, ilustraciones, escenas de producto, retratos de ambiente. Hazlo cuando una pieza gane de verdad con una imagen (portadas, historias, flyers); no en todas las slides.
- Escribe el prompt en INGLÉS, concreto y visual: sujeto, escena, estilo fotográfico o ilustración, luz, paleta de la marca, encuadre. Ej.: "editorial photo of a confident woman working on a laptop in a bright home office, soft window light, shallow depth of field, warm neutral palette with navy accents".
- NUNCA pidas texto dentro de la imagen: el texto lo pones tú en HTML (nítido y editable). El sistema ya pide a la IA que deje una zona despejada para el titular.
- En HISTORIAS pasa la URL devuelta en el campo fotoUrl de add_story/update_story. En el resto, usa la URL en el HTML como fondo (background-image con url(...) y background-size:cover; añade un degradado oscuro semitransparente encima para que el texto tenga contraste) o en <img>.
- Para HISTORIAS (9:16) y FLYERS pide la imagen a pantalla completa y compón el texto encima con jerarquía clara. Para carruseles mantén un mismo estilo visual en todas las imágenes (misma paleta, misma luz, mismo tipo de encuadre).
- Máximo ${4} imágenes por petición: planifica cuáles aportan más.

`
    : ''
}## Comportamiento
- SÉ PROACTIVO: crea primero, refina después. No pidas permiso para empezar.
- NO PARES hasta terminar TODO el plan. Si te piden N slides, sigue llamando a ${alta} en turnos sucesivos hasta llegar a N — no te detengas tras la primera (ni tras la del CTA si aún faltan slides antes). Puedes emitir varias llamadas a ${alta} en el mismo turno si eso te ayuda a avanzar más rápido; el usuario ve cada slide aparecer en cuanto se ejecuta.
- Solo dejes de llamar tools (responder con texto libre, sin tool_use) cuando: (a) el carrusel/flyer esté COMPLETO con todas las slides pedidas, o (b) necesites una aclaración imprescindible del usuario antes de continuar.
- RESPUESTAS BREVES: tras crear, describe lo que hiciste en 1-2 frases.
- CONSISTENCIA DE MARCA en cada slide.
${esHistorias ? '- CONSISTENCIA: misma persona, mismo acento y mismo estilo de caja en toda la secuencia; varía la composición, no el estilo.' : '- VARIEDAD CREATIVA: no repitas el mismo layout en todas las slides.'}
${isFlyer ? '' : '- TERMINA SIEMPRE CON CTA en la última slide, y no antes.'}`
}

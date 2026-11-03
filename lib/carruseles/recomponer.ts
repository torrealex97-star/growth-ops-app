import { estiloValido } from './estilos'
import { leerSpecDeHtml } from './historias/pedidos'
import { renderHistoria } from './historias/layouts'
import { getBrand, getProject, updateSlide } from './store'

// Recompone las historias de un proyecto a partir de la especificación incrustada en su HTML, SIN llamar a la IA:
// al subir el material real que faltaba, al cambiar de estilo o al cambiar las fotos. Las historias antiguas (sin
// especificación incrustada) no se tocan.

export async function recomponerHistorias(
  tenantId: string,
  projectId: string,
  opciones: { estilo?: string; plataforma?: 'instagram' | 'tiktok' } = {}
): Promise<{ actualizadas: number; sinEspecificacion: number }> {
  const project = await getProject(tenantId, projectId)
  if (!project) throw new Error('Proyecto no encontrado')
  const brand = await getBrand(tenantId)
  const media = project.referenceImages
    .filter((r) => !r.pedido)
    .map((r) => ({
      url: r.url,
      name: r.name,
      kind: /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(r.url) ? ('video' as const) : ('image' as const),
    }))
  // Si se subió más de una imagen para el mismo pedido, vale la última.
  const pedidos: Record<string, string> = {}
  for (const r of project.referenceImages) if (r.pedido) pedidos[r.pedido] = r.url

  let actualizadas = 0
  let sinEspecificacion = 0
  for (const [i, slide] of project.slides.entries()) {
    const previa = leerSpecDeHtml(slide.html)
    if (!previa) {
      sinEspecificacion++
      continue
    }
    // Cambiar de red no vuelve a pedir nada a la IA: solo cambian los márgenes de la interfaz.
    const spec = opciones.plataforma
      ? { ...previa.spec, plataforma: opciones.plataforma === 'tiktok' ? ('tiktok' as const) : undefined }
      : previa.spec
    const html = renderHistoria(spec, {
      brand,
      estilo: estiloValido(opciones.estilo ?? previa.estilo, true),
      media,
      pedidos,
      hoy: previa.hoy,
      indice: i,
      total: project.slides.length,
    })
    if (html === slide.html) continue
    await updateSlide(tenantId, projectId, slide.id, { html })
    actualizadas++
  }
  return { actualizadas, sinEspecificacion }
}

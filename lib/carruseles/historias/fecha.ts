/** «2 nov. 2026» → partes para <div class="ig-etiqueta-fecha">. Módulo aparte para que el navegador no cargue el prompt. */
export function fechaEtiqueta(d: Date): string {
  const mes = new Intl.DateTimeFormat('es-ES', { month: 'short' }).format(d).replace('.', '')
  return `<span>${d.getDate()}</span><span>${mes}.</span><span>${d.getFullYear()}</span>`
}

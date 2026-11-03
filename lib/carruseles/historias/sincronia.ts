/**
 * ¿Hay que recargar el formulario del editor desde el HTML de la slide? Sí al cambiar de slide, o si el HTML cambió por algo
 * que no guardamos nosotros (p. ej. la IA). No si es HTML que guardamos nosotros: las lecturas tardías de nuestros propios
 * guardados no deben pisar lo que se está escribiendo.
 */
export function debeRecargarFormulario(p: {
  formId: string | null
  slideId: string
  html: string
  guardados: ReadonlySet<string>
}): boolean {
  return !(p.formId === p.slideId && p.guardados.has(p.html))
}

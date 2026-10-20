// Valida los identificadores de clic de Meta que manda el navegador antes de guardarlos. Son entrada
// no confiable: se aceptan SOLO con el formato documentado por Meta y, si no cuadran, se descartan
// (mejor perder el dato que guardar basura que luego se envíe a la Conversions API).

const FBC = /^fb\.[0-9]\.[0-9]{10,13}\.[A-Za-z0-9_-]{1,200}$/
const FBP = /^fb\.[0-9]\.[0-9]{10,13}\.[0-9]{1,20}$/

export function sanitizarFbc(v: unknown): string | null {
  return typeof v === 'string' && FBC.test(v) ? v : null
}

export function sanitizarFbp(v: unknown): string | null {
  return typeof v === 'string' && FBP.test(v) ? v : null
}

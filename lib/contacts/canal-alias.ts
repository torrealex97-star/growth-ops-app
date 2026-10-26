// ALIAS DE CANAL (puro): «ig», «IG», «Instagram» e «insta» son el MISMO canal. Sin normalizar, el modelo de
// último/primer toque los cuenta como fuentes distintas y reparte entre ellas agendas y ventas de un solo canal.
//
// Solo se unifican alias INEQUÍVOCOS de redes sociales. Cualquier otro valor (campañas, dominios, «linktr.ee»,
// «meta_ads») se deja tal cual: no se inventa equivalencia entre cosas que pueden no serlo.

const ALIAS: Record<string, string> = {
  ig: 'instagram',
  insta: 'instagram',
  instagram: 'instagram',
  fb: 'facebook',
  face: 'facebook',
  facebook: 'facebook',
  tk: 'tiktok',
  tiktok: 'tiktok',
  yt: 'youtube',
  youtube: 'youtube',
}

/** Canal canónico si el valor es un alias conocido; en otro caso, el valor original sin tocar. */
export function normalizarCanal<T extends string | null | undefined>(valor: T): T | string {
  if (typeof valor !== 'string') return valor
  const clave = valor.trim().toLowerCase()
  return ALIAS[clave] ?? valor
}

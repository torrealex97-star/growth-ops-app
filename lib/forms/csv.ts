// CSV para el gestor/CRM: UTF-8 con BOM (Excel), separador ';' (es-ES) y protección frente a
// inyección de fórmulas (=, +, -, @ al inicio de una celda se abrirían como fórmula en Excel).

const FORMULA = /^[=+\-@\t\r]/

export function csvCell(v: unknown): string {
  let t = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v)
  if (FORMULA.test(t)) t = `'${t}`
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

export const toCsv = (rows: unknown[][]): string => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\n')

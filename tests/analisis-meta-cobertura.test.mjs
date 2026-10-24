import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// La nota de cobertura en Análisis Meta: MISMA PALABRA QUE EN ANUNCIOS.
//
// Caso de producción del 24-oct (widigan-digital-closer): utm_content con nombres duplicados en
// Meta resuelve «ambigua» para TODOS los toques → adAttributed = 0 → la barra «Anuncio conocido»
// queda a cero y, si no se dice nada, parece que el tracking está roto o que LAS agendas salieron
// de la nada. En la tabla de Anuncios ya se declara el hueco con su causa (137-oct, tests/
// ads-columnas-crm); Análisis Meta (RevenueAttributionView) cuenta lo mismo y debe hablar igual.

const vista = readFileSync('components/os/RevenueAttributionView.tsx', 'utf8')
const tabla = readFileSync('components/os/AdsTable.tsx', 'utf8')

test('Análisis Meta pinta la nota de cobertura aunque ningún anuncio resuelva', () => {
  // El gate es SOLO la diferencia de cobertura, ahí use la vista activa (campaigns/ads), el estado
  // de la carga o el panel de definiciones.
  assert.match(
    vista,
    /sinAtribuirAnuncios > 0/,
    'la nota no puede depender de nada más que del propio hueco de cobertura'
  )
  // La cuenta nace de la MISMA cifra que pinta la barra «Anuncio conocido».
  assert.match(vista, /coverage\.booked - coverage\.adAttributed|booked - data\.coverage\.adAttributed/)
})

test('ambas pantallas cuentan el hueco con la MISMA redacción base', () => {
  // Regresión de igualdad de vocabulario: si una pantalla cambia la frase, se sabe aquí.
  for (const pantalla of ['\n' + vista + '\n' + tabla]) {
    assert.match(pantalla, /no llegan a un anuncio/)
    assert.match(pantalla, /duplicados en Meta/)
    assert.match(pantalla, /no se reparten ni se inventan/)
  }
  // Y las dos por separado: basta que una se quede sin la nota para el caso que la puso aquí.
  assert.match(vista, /sinAtribuirAnuncios/)
  assert.match(tabla, /sinAtribuir/)
})

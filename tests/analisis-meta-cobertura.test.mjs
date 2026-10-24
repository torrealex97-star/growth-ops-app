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
const coberturaAtribucion = readFileSync('components/os/AttributionCoverage.tsx', 'utf8')
const paginaAtribucion = readFileSync('app/[tenant]/marketing/adquisicion/atribucion/page.tsx', 'utf8')

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

test('las pantallas de cobertura cuentan el hueco con la MISMA redacción base', () => {
  // Regresión de igualdad de vocabulario: si una pantalla cambia la frase, se sabe aquí.
  // Anuncios y Embudo CRM hablan de AGENDAS sin anuncio; Atribución de LEADS sin canal conocido
  // (misma estructura, otra entidad): partager y no repartir es lo que no cambia en ninguna.
  for (const pantalla of ['\n' + vista + '\n' + tabla]) {
    assert.match(pantalla, /no llegan a un/)
    assert.match(pantalla, /duplicados en Meta/)
    assert.match(pantalla, /no se reparten ni se inventan/)
  }
  assert.match(coberturaAtribucion, /no llegan a un canal conocido/)
  assert.match(coberturaAtribucion, /no se reparten ni se inventan/)
  assert.match(coberturaAtribucion, /Directo \/ Sin atribuir/, 'el hueco apunta a la fila que existe en el desglose')
  // Y las tres por separado: basta que una se quede sin la nota para el caso que la puso aquí.
  assert.match(vista, /sinAtribuirAnuncios/)
  assert.match(tabla, /sinAtribuir/)
  assert.match(coberturaAtribucion, /hueco/)
})

test('Atribución pasa los recuentos absolutos del lado Directo para poder declarar el hueco', () => {
  // El porcentaje solo no basta: la nota necesita N y M. Los recuentos nacen de la MISMA fila de
  // la RPC (DIRECTO_RPC) que ya alimenta la bancas de arriba — sin una lectura extra a la BD.
  assert.match(paginaAtribucion, /sinOrigen: \{/, 'la página calcula el hueco junto a la cobertura, no aparte')
  assert.match(paginaAtribucion, /directo\?\.leads \?\? 0/)
  // En error global la pantalla pinta el aviso propio y NO la nota: el objeto cortado no trae
  // sinOrigen, así que el componente no la puede pintar aunque quiera.
  assert.match(
    paginaAtribucion,
    /\{ leads: null, sales: null, revenue: null \}/,
    'el fallback de error globaliff corta sinOrigen'
  )
  assert.match(coberturaAtribucion, /sinOrigen\?/, 'la nota es opcional: solo se pinta con recuentos')
})

test('las notas con estéticas de coverage: Estados explican el hueco por causa, no solo por tamaño', () => {
  // coverage.estados (builder) es el desglose por causa. Ambas notas de agenda→anuncio lo consumen:
  // Anuncios via json.coverage.estados y Embudo CRM via data.coverage.estados.
  assert.match(tabla, /crmCobertura\.estados\?\.ad|'estados' in crmCobertura/)
  assert.match(vista, /coverage\.estados\?\.ad/)
  // Si el caos no llegara (respuesta vieja en caché), la nota cae a la redacción base, no desaparece.
  assert.match(tabla, /nombres duplicados en Meta\)/)
  assert.match(vista, /nombres duplicados en Meta\)/)
})

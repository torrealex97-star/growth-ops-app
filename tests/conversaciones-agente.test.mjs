import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIG_POR_DEFECTO,
  decidirAgente,
  dentroDeHorario,
  humanoRespondioDespues,
  seguidosSinRespuesta,
} from '../lib/conversaciones/agente.ts'
import { evaluarTraspaso, exigeNoContactar } from '../lib/conversaciones/traspaso.ts'
import { construirPrompt, pasosPendientes, validarBorrador } from '../lib/conversaciones/redactor.ts'

const AHORA = new Date('2026-10-22T12:00:00Z')
const hace = (h) => new Date(AHORA.getTime() - h * 3_600_000).toISOString()
const cfg = { ...CONFIG_POR_DEFECTO, activo: true, permitirAutonomo: true }
const ctx = (extra = {}) => ({
  canal: 'instagram',
  estado: 'pendiente',
  aiMode: 'autonomo',
  ultimoEntrante: hace(1),
  historial: [{ autor: 'lead', texto: 'hola', enviadoEn: hace(1) }],
  enviosHoyDelAgente: 0,
  ...extra,
})

test('por defecto el agente está APAGADO y no actúa aunque todo lo demás encaje', () => {
  const d = decidirAgente(CONFIG_POR_DEFECTO, ctx(), AHORA)
  assert.equal(d.actua, false)
  assert.equal(d.motivo, 'agente_apagado')
})

test('actúa en autónomo solo con subcuenta y conversación en autónomo; si no, borrador', () => {
  assert.equal(decidirAgente(cfg, ctx(), AHORA).modo, 'autonomo')
  assert.equal(decidirAgente({ ...cfg, permitirAutonomo: false }, ctx(), AHORA).modo, 'borrador')
  assert.equal(decidirAgente(cfg, ctx({ aiMode: 'borrador' }), AHORA).modo, 'borrador')
  assert.equal(decidirAgente(cfg, ctx({ aiMode: 'off' }), AHORA).motivo, 'conversacion_apagada')
})

test('se calla: canal no autorizado, resuelta, sin mensaje del lead y ventana cerrada', () => {
  assert.equal(decidirAgente(cfg, ctx({ canal: 'tiktok' }), AHORA).motivo, 'canal_no_autorizado')
  assert.equal(decidirAgente(cfg, ctx({ canal: 'sms' }), AHORA).motivo, 'canal_no_autorizado')
  assert.equal(decidirAgente(cfg, ctx({ estado: 'resuelta' }), AHORA).motivo, 'conversacion_resuelta')
  assert.equal(decidirAgente(cfg, ctx({ ultimoEntrante: null }), AHORA).motivo, 'sin_mensaje_del_lead')
  // 25 h: abierta para una persona (HUMAN_AGENT) pero CERRADA para la IA.
  assert.equal(decidirAgente(cfg, ctx({ ultimoEntrante: hace(25) }), AHORA).motivo, 'ventana_cerrada')
})

test('si una persona respondió después del lead, la IA se calla; si el lead escribió después, vuelve', () => {
  const h1 = [
    { autor: 'lead', texto: 'a', enviadoEn: hace(3) },
    { autor: 'humano', texto: 'b', enviadoEn: hace(2) },
  ]
  assert.equal(humanoRespondioDespues(h1), true)
  assert.equal(decidirAgente(cfg, ctx({ historial: h1 }), AHORA).motivo, 'humano_atiende')
  assert.equal(humanoRespondioDespues([...h1, { autor: 'lead', texto: 'c', enviadoEn: hace(1) }]), false)
})

test('topes: mensajes seguidos sin respuesta del lead y envíos diarios', () => {
  const h = [
    { autor: 'lead', texto: 'a', enviadoEn: hace(5) },
    { autor: 'ia', texto: 'b', enviadoEn: hace(4) },
    { autor: 'ia', texto: 'c', enviadoEn: hace(3) },
  ]
  assert.equal(seguidosSinRespuesta(h), 2)
  assert.equal(decidirAgente(cfg, ctx({ historial: h, ultimoEntrante: hace(5) }), AHORA).motivo, 'tope_seguidos')
  assert.equal(decidirAgente(cfg, ctx({ enviosHoyDelAgente: 200 }), AHORA).motivo, 'tope_diario')
})

test('horario: dentro, fuera, que cruza medianoche y horario ilegible (se cierra)', () => {
  const h = { desde: 9, hasta: 21, zona: 'Europe/Madrid' } // 12:00 UTC = 14:00 Madrid
  assert.equal(dentroDeHorario(h, AHORA), true)
  assert.equal(dentroDeHorario({ ...h, desde: 15 }, AHORA), false)
  assert.equal(dentroDeHorario({ desde: 22, hasta: 16, zona: 'Europe/Madrid' }, AHORA), true)
  assert.equal(dentroDeHorario({ ...h, zona: 'No/Existe' }, AHORA), false)
  assert.equal(dentroDeHorario(null, AHORA), true)
  assert.equal(decidirAgente({ ...cfg, horario: { ...h, desde: 15 } }, ctx(), AHORA).motivo, 'fuera_de_horario')
})

test('traspaso: pide humano, enfado, baja, precio, intención alta y datos sensibles', () => {
  const t = (m) => evaluarTraspaso(m)
  assert.equal(t('quiero hablar con una persona').motivo, 'pide_humano')
  assert.equal(t('¿eres un bot?').motivo, 'pide_humano')
  assert.equal(t('esto es una estafa').motivo, 'enfado')
  assert.equal(t('STOP').motivo, 'baja_o_stop')
  assert.equal(t('no me escribas más').motivo, 'baja_o_stop')
  assert.equal(t('¿cuánto cuesta?').motivo, 'precio_o_condiciones')
  assert.equal(t('¿tenéis financiación?').motivo, 'precio_o_condiciones')
  assert.equal(t('quiero apuntarme ya').motivo, 'intencion_alta')
  assert.equal(t('mi iban es ES91 2100').motivo, 'datos_sensibles')
  assert.equal(t('Hola, vi tu reel y me interesa saber más').traspasar, false)
  assert.equal(exigeNoContactar('baja_o_stop'), true)
  assert.equal(exigeNoContactar('precio_o_condiciones'), false)
})

test('traspaso por baja confianza o pregunta fuera de guion', () => {
  assert.equal(evaluarTraspaso('hola', { confianza: 0.3 }).motivo, 'sin_confianza')
  assert.equal(evaluarTraspaso('hola', { confianza: 0.9 }).traspasar, false)
  assert.equal(evaluarTraspaso('hola', { fueraDeGuion: true }).traspasar, true)
})

const guion = {
  negocio: 'Academia Demo',
  tono: 'cercano y profesional',
  pasos: [
    { clave: 'situacion', objetivo: 'su situación actual' },
    { clave: 'ingresos', objetivo: 'sus ingresos mensuales', pregunta: '¿Cuánto estás generando ahora?' },
  ],
  objeciones: [{ disparador: 'no tengo tiempo', respuesta: 'la llamada dura 20 minutos' }],
  enlaceAgenda: 'https://cal.example.test/llamada',
  hechosPermitidos: ['El programa es online'],
}

test('prompt: solo pregunta lo que falta, fija el enlace de agenda y trae las reglas duras', () => {
  assert.deepEqual(
    pasosPendientes(guion.pasos, new Set(['situacion'])).map((p) => p.clave),
    ['ingresos']
  )
  const p = construirPrompt(
    guion,
    new Set(['situacion']),
    [
      { autor: 'lead', texto: 'hola' },
      { autor: 'ia', texto: 'hola!' },
    ],
    'Resumen X'
  )
  assert.match(p.system, /sus ingresos mensuales/)
  assert.ok(!/su situación actual/.test(p.system))
  assert.match(p.system, /https:\/\/cal\.example\.test\/llamada/)
  assert.match(p.system, /Nunca des ni insinúes precios/)
  assert.match(p.system, /Resumen X/)
  assert.deepEqual(
    p.messages.map((m) => m.role),
    ['user', 'assistant']
  )
  const completo = construirPrompt(guion, new Set(['situacion', 'ingresos']), [], null)
  assert.match(completo.system, /propón la llamada/)
})

test('validación: rechaza precio, pago, enlaces ajenos, ser persona, vacío y TRASPASO; acepta lo correcto', () => {
  const v = (t) => validarBorrador(t, guion.enlaceAgenda)
  assert.equal(v('Genial, ¿y cuánto estás generando ahora?').ok, true)
  assert.equal(v(`Te paso el enlace: ${guion.enlaceAgenda}.`).ok, true)
  assert.equal(v('El programa cuesta 997 €').ok, false)
  assert.equal(v('Tenemos financiación en cuotas').ok, false)
  assert.equal(v('Mándame tu IBAN').ok, false)
  assert.equal(v('Mira https://otro.example.test/x').ok, false)
  assert.equal(v('Soy una persona real').ok, false)
  assert.equal(v('').ok, false)
  assert.equal(v('TRASPASO').ok, false)
  assert.equal(v('a'.repeat(1000)).ok, false)
  // Sin enlace configurado, ninguna URL es válida.
  assert.equal(validarBorrador(`Mira ${guion.enlaceAgenda}`, null).ok, false)
})

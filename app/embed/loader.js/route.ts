export const dynamic = 'force-dynamic'

// Script que se incrusta en la landing / página de GHL. Hace cuatro cosas:
//  1) Expone window.tccVSL.identify(email) para asociar el lead manualmente.
//  2) AUTO-captura el lead del funnel: lee email/nombre desde los parámetros de la URL
//     (?email=...&name=...) o desde window.tccVSLLead, y llama a identify solo.
//  3) Emite el evento first-party del pixel `window.gop('lead', { email })` al identificar,
//     para que el stitching de identidad escriba analytics_visitors.contact_id y el
//     visitante anónimo (y sus UTMs y % de visión) quede enlazado al contacto en la BD.
//  4) Propaga a Calendly lo que la página conoce: el anonId del VSL (salesforce_uuid,
//     para el % de visión) y las UTMs del anuncio/landing (utm_*), que Calendly reenvía
//     en el bloque tracking del webhook — sin ellas la agenda entra sin origen y la
//     atribución decide que no vino de ninguna campaña aunque la landing las tenga.
export async function GET() {
  const site = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const origin = site.replace(/\/$/, '')

  // NOTA SOBRE LOS `catch` DE ESTE SCRIPT. Se ejecuta en la landing del cliente, que es OTRO dominio, y
  // habla con el iframe del VSL por postMessage. Todas las operaciones de aquí pueden fallar por motivos
  // normales y ajenos: el iframe aún no ha cargado, `contentWindow` no es accesible por origen cruzado,
  // o el widget de Calendly todavía no está en el DOM. Son señales OPCIONALES: si no llegan, el vídeo y
  // el formulario funcionan igual. Por eso se ignoran, y por eso se dice aquí una vez en vez de repetirlo.
  const js = `(function(){
  var ORIGIN = ${JSON.stringify(origin)};
  var pending = null;
  function frames(){
    var out = [];
    var list = document.querySelectorAll('iframe');
    for (var i=0;i<list.length;i++){
      var src = list[i].getAttribute('src') || '';
      if (src.indexOf(ORIGIN + '/embed/vsl/') === 0 || src.indexOf('/embed/vsl/') === 0) out.push(list[i]);
    }
    return out;
  }
  function send(payload){
    frames().forEach(function(f){
      try { f.contentWindow.postMessage(Object.assign({ __tccvsl: 'identify' }, payload), '*'); } catch (_) { /* opcional: ver la nota del fichero */ }
    });
  }
  function isVslFrameSource(source){
    return frames().some(function(f){ return f.contentWindow === source; });
  }
  function bad(v){ return !v || v.indexOf('{{') !== -1 || v.indexOf('}}') !== -1; }
  window.tccVSL = window.tccVSL || {};
  window.tccVSL.identify = function(data){
    var payload = (typeof data === 'string') ? { email: data } : (data || {});
    // Ignora merge fields sin resolver (p.ej. GHL manda "{{contact.email}}" literal).
    if (bad(payload.email)) delete payload.email;
    if (bad(payload.name)) delete payload.name;
    if (!payload.email && !payload.name) return;
    emitLeadPixel(payload.email);
    pending = payload;
    send(payload);
  };

  // === Puente al pixel first-party (stitching visitante→contacto) -------------
  // Al identificar a la persona emitimos también el evento 'lead' del pixel
  // (/tracker.js: window.gop('lead', { email })). El servidor de atribución usa la
  // identidad de ese evento para escribir analytics_visitors.contact_id: con el MISMO
  // email, el visitante anónimo de la sesión queda enlazado al contacto y sus UTMs y su
  // % de visión llegan a atribución SIN depender de que el webhook externo traiga anonId.
  // El nombre NO se emite: no es señal de identidad del pixel y sería PII de más.
  // Sin pixel en la página (typeof window.gop != 'function') es una no-op silenciosa; el
  // VSL/iframe/Calendly funcionan igual (ver nota de los catch arriba).
  // Dedupe por email a propósito: los re-render de GHL vuelven a llamar identify con el
  // mismo lead y cada emisión sería un evento 'lead' de más en raw_events.
  var ultimoLead = null;
  function emitLeadPixel(email){
    if (!email || !email.length || email === ultimoLead) return;
    ultimoLead = email;
    try { if (typeof window.gop === 'function') window.gop('lead', { email: email }); }
    catch (_) { /* opcional: ver la nota del fichero */ }
  }

  // === Enganche del visionado ANÓNIMO con la cita (leads sin optin) -----------
  // El player nos manda su anonId. Lo inyectamos como salesforce_uuid en los enlaces
  // y widgets de Calendly de la página, para que Calendly lo reenvíe en el webhook y
  // el servidor pueda asociar el % visto a la cita aunque el lead nunca se registrara.
  var anonId = null;
  function addParam(url, key, val){
    if (!url || url.indexOf(key + '=') !== -1) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + key + '=' + encodeURIComponent(val);
  }
  // === UTMs de la página → Calendly ---------------------------------------------
  // Calendly solo reporta al webhook las UTMs que LLEGAN en el enlace del booking:
  // si nadie las propaga, Calendly no tiene nada que reportar y el webhook entra con
  // tracking vacío aunque el anuncio/player las hayan traído a la página. Se cogen de
  // la query de la página y, si no hay, de lo que el pixel guardó en esta sesión
  // (clí anuncio → navegó → scroll a Calendly: el origen sigue siendo el anuncio).
  var UTM_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  function pageUtms(){
    var out = {};
    try {
      var q = new URLSearchParams(window.location.search);
      UTM_KEYS.forEach(function(k){ var v = q.get(k); if (v) out[k] = v.slice(0, 200); });
    } catch (_) { /* opcional: ver la nota del fichero */ }
    return out;
  }
  function utmParams(){
    var out = pageUtms();
    try {
      if (Object.keys(out).length === 0) {
        var saved = sessionStorage.getItem('gop_utm');
        if (saved) { out = JSON.parse(saved) || {}; }
      }
    } catch (_) { /* opcional: ver la nota del fichero */ }
    return out;
  }
  function decorateCalendly(){
    // Enlaces / botones que llevan a calendly.com
    var links = document.querySelectorAll('a[href*="calendly.com"], [data-url*="calendly.com"]');
    var params = utmParams();
    if (anonId) params.salesforce_uuid = anonId;
    for (var i=0;i<links.length;i++){
      var el = links[i];
      [['href','href'],['data-url','data-url']].forEach(function(pair){
        var attr = pair[0];
        var url = el.getAttribute(attr);
        if (!url || url.indexOf('calendly.com') === -1) return;
        for (var k in params) url = addParam(url, k, params[k]);
        el.setAttribute(attr, url);
      });
    }
    // Widget inline de Calendly: initInlineWidget lee data-url al crear el iframe, así que
    // basta con decorar el nodo raíz; la consulta con ^= evita re-procesar dos veces los
    // href/data-url ya decorados arriba.
    var inline = document.querySelectorAll('[data-url^="https://calendly.com"], [data-url^="http://calendly.com"]');
    for (var j=0;j<inline.length;j++){
      var el2 = inline[j];
      var url2 = el2.getAttribute('data-url');
      if (!url2) continue;
      for (var k2 in params) url2 = addParam(url2, k2, params[k2]);
      el2.setAttribute('data-url', url2);
    }
  }
  window.tccVSL.anonId = function(){ return anonId; };
  window.tccVSL.bookingParams = function(){
    var p = utmParams();
    if (anonId) p.salesforce_uuid = anonId;
    return p;
  };
  // Alias antiguo conservado por compatibilidad con landings ya desplegadas.
  window.tccVSL.bookingParam = function(){ return anonId ? { salesforce_uuid: anonId } : {}; };

  // Reenvía a iframes que carguen después (cuando avisan 'ready') y capta el anonId.
  window.addEventListener('message', function(e){
    if (!e.data || e.data.__tccvsl !== 'ready') return;
    if (!isVslFrameSource(e.source)) return;
    if (e.data.anonId){ anonId = e.data.anonId; try { decorateCalendly(); } catch (_) { /* opcional: ver la nota del fichero */ } }
    if (pending) { try { e.source.postMessage(Object.assign({ __tccvsl: 'identify' }, pending), '*'); } catch (_) { /* opcional: ver la nota del fichero */ } }
  });
  // Re-decora si Calendly se inyecta después (widgets que cargan async).
  try {
    var mo = new MutationObserver(function(){ decorateCalendly(); });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function(){ mo.observe(document.body, { childList: true, subtree: true }); });
  } catch (_) { /* opcional: ver la nota del fichero */ }
  // AUTO-captura: combina window.tccVSLLead (si sus valores son válidos) con los
  // parámetros de la URL del funnel. Si tccVSLLead trae merge fields sin resolver
  // ("{{contact.email}}"), se ignoran y se cae a la URL igualmente.
  function ok(v){ return (v && v.indexOf('{{') === -1 && v.indexOf('}}') === -1) ? v : null; }
  function autoCapture(){
    var lead = window.tccVSLLead || {};
    var email = ok(lead.email);
    var name  = ok(lead.name);
    try {
      var q = new URLSearchParams(window.location.search);
      if (!email) email = q.get('email') || q.get('lead_email') || q.get('contact_email') || q.get('e');
      if (!name)  name  = q.get('name')  || q.get('first_name') || q.get('full_name') || q.get('fname');
    } catch (_) { /* opcional: ver la nota del fichero */ }
    if (email || name) window.tccVSL.identify({ email: email || undefined, name: name || undefined });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoCapture);
  else autoCapture();
})();`

  return new Response(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  })
}

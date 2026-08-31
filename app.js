/* =====================================================================
   CONTROL MANT · Aplicación de inspecciones
   ---------------------------------------------------------------------
   Todo se guarda primero en el teléfono. La sincronización con la
   planilla ocurre después, sola, cuando hay conexión. Nunca al revés.
   ===================================================================== */

'use strict';

const APP_VER = '2.2';

/* ---------------------------------------------------------------------
   Almacenamiento local
   --------------------------------------------------------------------- */
const K = { cfg: 'cm.cfg', cat: 'cm.catalogo', insp: 'cm.inspecciones', sync: 'cm.ultimaSync' };

function load(k, def) {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; }
  catch (e) { return def; }
}
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) { toast('No entra más en el teléfono. Sincronizá para liberar espacio.'); return false; }
}

let cfg  = load(K.cfg, { url: '', token: '', supId: '', supNom: '', disp: '' });
let cat  = load(K.cat, null);
let insp = load(K.insp, []);

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
if (!cfg.disp) { cfg.disp = 'D-' + uuid().slice(0, 8).toUpperCase(); save(K.cfg, cfg); }

/* ---------------------------------------------------------------------
   Reglas de negocio
   --------------------------------------------------------------------- */

/** operatividad = (total − no operativos) / total. Null si no se puede. */
function operatividad(total, noop) {
  const t = Number(total), n = Number(noop);
  if (!isFinite(t) || t <= 0) return null;
  if (!isFinite(n) || n < 0)  return null;
  return (t - Math.min(n, t)) / t;
}

/** Escala unificada: 3 Verde · 2 Amarillo · 1 Naranja · 0 Rojo. */
function semaforoDeOperatividad(op) {
  if (op === null) return null;
  if (op >= 1)   return 3;
  if (op >= 0.8) return 2;
  if (op >= 0.5) return 1;
  return 0;
}

const SEM_NOM = ['Rojo', 'Naranja', 'Amarillo', 'Verde'];
const SEM_HEX = ['#C5221F', '#E8710A', '#EDB100', '#137333'];

/* ---------------------------------------------------------------------
   Utilidades de pantalla
   --------------------------------------------------------------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function vibrar(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 3200);
}

/* El teclado del celular tapa la barra de acciones si no la escondemos. */
if (window.visualViewport) {
  const vv = window.visualViewport;
  const ajustar = () => {
    const tapado = window.innerHeight - vv.height - vv.offsetTop;
    document.body.classList.toggle('kb', tapado > 130);
  };
  vv.addEventListener('resize', ajustar);
  vv.addEventListener('scroll', ajustar);
}

/* Que la pantalla no se apague mientras se carga una inspección. */
let wake = null;
async function mantenerDespierto(activar) {
  try {
    if (activar && 'wakeLock' in navigator) { if (!wake) wake = await navigator.wakeLock.request('screen'); }
    else if (wake) { await wake.release(); wake = null; }
  } catch (e) { wake = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && pantalla === 'form') mantenerDespierto(true);
});

/* ---------------------------------------------------------------------
   Navegación
   --------------------------------------------------------------------- */
const historia = [];
let pantalla = 'inicio';

const TITULOS = { inicio: 'Control Mant', nueva: 'Nueva inspección', lista: 'Mis inspecciones',
                  tablero: 'Tablero', ajustes: 'Ajustes', form: 'Inspección' };

function ir(nombre, sub, opts) {
  opts = opts || {};
  if (!opts.atras) historia.push(pantalla);
  pantalla = nombre;
  $$('.screen').forEach(s => s.classList.remove('on'));
  $('#sc-' + nombre).classList.add('on');
  $('#ttl').textContent = TITULOS[nombre] || 'Control Mant';
  const s = $('#sub');
  s.hidden = !sub; s.textContent = sub || '';
  $('#btnBack').hidden = (nombre === 'inicio');
  window.scrollTo(0, 0);
  pintarBarra();
  mantenerDespierto(nombre === 'form');
}

function volver() {
  if ($('#sheet').classList.contains('on')) return cerrarBuscador();
  const prev = historia.pop() || 'inicio';
  ir(prev, null, { atras: true });
  if (prev === 'inicio')  pintarInicio();
  if (prev === 'lista')   pintarLista();
  if (prev === 'tablero') pintarTablero();
  if (prev === 'form' && borrador) ir('form', borrador.local, { atras: true });
}

/* El botón físico de "atrás" de Android debe volver de pantalla,
   no cerrar la aplicación. */
history.replaceState({ cm: 0 }, '');
window.addEventListener('popstate', () => {
  history.pushState({ cm: 1 }, '');
  if (pantalla !== 'inicio' || $('#sheet').classList.contains('on')) volver();
});
history.pushState({ cm: 1 }, '');

function pintarBarra() {
  const bar = $('#bar');
  const b = BARRAS[pantalla];
  if (!b) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = b.html();
  b.bind();
}

/* ---------------------------------------------------------------------
   Estado general
   --------------------------------------------------------------------- */
function pendientes() { return insp.filter(i => i.estado === 'PENDIENTE'); }

function pintarEstado() {
  $('#dot').classList.toggle('on', navigator.onLine);
  const n = pendientes().length;
  const b = $('#pend');
  b.hidden = n === 0;
  b.textContent = '↑ ' + n;
  b.classList.toggle('hot', n >= 5);
}
window.addEventListener('online',  () => { pintarEstado(); sincronizar(true); });
window.addEventListener('offline', pintarEstado);

/* =====================================================================
   PANTALLA · Inicio
   ===================================================================== */
function pintarInicio() {
  $('#whoName').textContent = cfg.supNom || 'Sin definir — entrá a Ajustes';
  const bor = insp.filter(i => i.estado === 'BORRADOR').length;
  const pen = pendientes().length;
  const syn = insp.filter(i => i.estado === 'SINCRONIZADA').length;
  $('#mLista').textContent = insp.length === 0
    ? 'Todavía no cargaste ninguna'
    : `${bor} en borrador · ${pen} por enviar · ${syn} enviadas`;

  const u = load(K.sync, null);
  $('#lastSync').textContent = u
    ? 'Última sincronización: ' + new Date(u).toLocaleString('es-PY')
    : 'Todavía no sincronizaste';
  pintarEstado();
}

/* =====================================================================
   PANTALLA · Nueva inspección
   ===================================================================== */
let borrador = null;
let localElegido = null;

function abrirNueva() {
  if (!cat) { toast('Primero descargá los catálogos en Ajustes.'); return abrirAjustes(); }

  $('#fFecha').value = new Date().toISOString().slice(0, 10);
  $('#fSup').innerHTML = cat.supervisores
    .map(s => `<option value="${esc(s.id)}"${s.id === cfg.supId ? ' selected' : ''}>${esc(s.nombre)}</option>`).join('');
  $('#fRubro').innerHTML = '<option value="">Elegí un rubro…</option>' +
    cat.rubros.map(r => `<option value="${esc(r.rubro)}">${esc(r.rubro)}</option>`).join('');

  localElegido = null;
  const t = $('#fLocalTxt');
  t.textContent = 'Buscar local…';
  t.classList.remove('set');

  ir('nueva');
}

/* ---- Buscador de locales a pantalla completa ---- */
function abrirBuscador() {
  if (!cat) return toast('Descargá los catálogos primero.');
  $('#sheet').classList.add('on');
  $('#shInput').value = '';
  listarLocales('');
  setTimeout(() => $('#shInput').focus(), 120);
}
function cerrarBuscador() {
  $('#sheet').classList.remove('on');
  $('#shInput').blur();
}
function normaliza(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function listarLocales(q) {
  const n = normaliza(q.trim());
  const r = (n ? cat.locales.filter(l => normaliza(l.nombre).includes(n)) : cat.locales).slice(0, 80);
  $('#shList').innerHTML = r.length
    ? r.map(l => `<button type="button" data-n="${esc(l.nombre)}" data-f="${esc(l.formato)}">
                    <div class="fmt">${esc(l.formato)}</div>${esc(l.nombre)}</button>`).join('')
    : '<p class="tiny" style="text-align:center;padding:26px">Ningún local coincide.</p>';
}
$('#fLocalBtn').onclick = abrirBuscador;
$('#shClose').onclick = cerrarBuscador;
$('#shInput').addEventListener('input', function () { listarLocales(this.value); });
$('#shList').addEventListener('click', e => {
  const b = e.target.closest('button[data-n]');
  if (!b) return;
  localElegido = { nombre: b.dataset.n, formato: b.dataset.f };
  const t = $('#fLocalTxt');
  t.textContent = b.dataset.n;
  t.classList.add('set');
  cerrarBuscador();
  vibrar(8);
});

function comenzarInspeccion() {
  if (!localElegido) { toast('Elegí un local.'); return abrirBuscador(); }
  const rubro = $('#fRubro').value;
  if (!rubro) return toast('Elegí un rubro.');

  const sup = cat.supervisores.find(s => s.id === $('#fSup').value) || {};
  cfg.supId = sup.id || ''; cfg.supNom = sup.nombre || ''; save(K.cfg, cfg);

  const def = cat.rubros.find(r => r.rubro === rubro);
  const eqs = cat.equipos.filter(e => e.rubro === rubro)
    .sort((a, b) => (a.orden_sector - b.orden_sector) || (a.orden_equipo - b.orden_equipo));

  const sectores = [], vistos = {};
  eqs.forEach(e => {
    if (!vistos[e.sector]) {
      vistos[e.sector] = { uuid: uuid(), sector: e.sector, puntaje: null,
                           metros_cuadrados: '', observacion: '', equipos: [] };
      sectores.push(vistos[e.sector]);
    }
    vistos[e.sector].equipos.push({
      uuid: uuid(), sector: e.sector, equipo: e.equipo,
      total: '', no_operativos: '', puntaje: null, texto: '', observacion: '',
      pide_cantidades: e.pide_cantidades, pide_puntaje: e.pide_puntaje, pide_texto: e.pide_texto
    });
  });

  borrador = {
    uuid: uuid(), fecha: $('#fFecha').value,
    local: localElegido.nombre, formato: localElegido.formato, rubro: rubro,
    supervisor_id: sup.id || '', supervisor: sup.nombre || '',
    observacion: '', creado_en: new Date().toISOString(),
    estado: 'BORRADOR', def: def, sectores: sectores
  };
  insp.unshift(borrador);
  save(K.insp, insp);
  abrirFormulario(borrador);
}

/* =====================================================================
   PANTALLA · Formulario dinámico
   ===================================================================== */
function abrirFormulario(rec) {
  borrador = rec;
  if (!borrador.def) borrador.def = (cat && cat.rubros.find(r => r.rubro === rec.rubro)) || {};
  $('#fObs').value = rec.observacion || '';
  dibujarSectores();
  ir('form', rec.local + ' · ' + rec.rubro);
  actualizarProgreso();
}

$('#fObs').addEventListener('input', function () {
  borrador.observacion = this.value; guardarBorrador();
});

let guardarT;
function guardarBorrador() {
  clearTimeout(guardarT);
  guardarT = setTimeout(() => save(K.insp, insp), 250);
}

function selectorPuntaje(valor, onSet) {
  const d = document.createElement('div');
  d.className = 'grade';
  d.innerHTML = [0, 1, 2, 3].map(v =>
    `<button type="button" data-v="${v}" class="${valor === v ? 'sel' : ''}">
       <span class="chip">${v}</span><span class="n">${SEM_NOM[v]}</span>
     </button>`).join('');
  d.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    d.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
    vibrar(12);
    onSet(Number(b.dataset.v));
  });
  return d;
}

/** Campo numérico con − y +, para no tener que abrir el teclado. */
function contador(valor, onSet) {
  const w = document.createElement('div');
  w.className = 'step';

  const menos = document.createElement('button');
  menos.type = 'button'; menos.textContent = '−'; menos.setAttribute('aria-label', 'Restar');
  const mas = document.createElement('button');
  mas.type = 'button'; mas.textContent = '+'; mas.setAttribute('aria-label', 'Sumar');
  const i = document.createElement('input');
  i.type = 'number'; i.min = '0'; i.inputMode = 'numeric'; i.placeholder = '0';
  i.value = valor;

  function fijar(v, avisar) {
    i.value = (v === null || v === '') ? '' : v;
    onSet(i.value);
    if (avisar) vibrar(6);
  }
  menos.onclick = () => {
    const n = Math.max(0, (Number(i.value) || 0) - 1);
    fijar(n, true);
  };
  mas.onclick = () => fijar((Number(i.value) || 0) + 1, true);
  i.addEventListener('input', () => {
    let n = i.value === '' ? '' : Math.max(0, Math.floor(Number(i.value) || 0));
    if (String(n) !== i.value) i.value = n;
    onSet(i.value);
  });

  w.append(menos, i, mas);
  w.fijar = fijar;
  w.input = i;
  return w;
}

function medidor(op) {
  const s = semaforoDeOperatividad(op);
  const d = document.createElement('div');
  d.className = 'gauge';
  d.innerHTML = op === null
    ? `<div class="row"><span class="tiny">Operatividad</span>
       <span class="val" style="color:#7A8B96;font-size:15px">sin datos</span></div><div class="track"></div>`
    : `<div class="row"><span class="tiny">Operatividad</span>
       <span class="val num c${s}">${Math.round(op * 100)}%</span></div>
       <div class="track"><div class="fill f${s}" style="width:${Math.round(op * 100)}%"></div></div>`;
  return d;
}

function dibujarSectores() {
  const cont = $('#fSectores');
  cont.innerHTML = '';
  const def = borrador.def || {};

  borrador.sectores.forEach((sec, idx) => {
    const det = document.createElement('details');
    det.className = 'sector';
    det.open = (idx === 0);          // el primero abierto: un toque menos

    const sum = document.createElement('summary');
    sum.innerHTML = `<span class="sq"></span><span class="nm">${esc(sec.sector)}</span><span class="st"></span>`;
    det.appendChild(sum);

    // Solo un sector abierto por vez, y que quede a la vista.
    det.addEventListener('toggle', () => {
      if (!det.open) { actualizarProgreso(); return; }
      cont.querySelectorAll('details[open]').forEach(o => { if (o !== det) o.open = false; });
      actualizarProgreso();
      setTimeout(() => det.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
    });

    const body = document.createElement('div');
    body.className = 'body';
    det.appendChild(body);

    /* --- metros cuadrados --- */
    if (def.usa_m2) {
      const l = document.createElement('label');
      l.className = 'f'; l.style.marginTop = '14px';
      l.innerHTML = '<span>Metros cuadrados</span>';
      const i = document.createElement('input');
      i.type = 'number'; i.min = '0'; i.step = '0.01'; i.inputMode = 'decimal';
      i.value = sec.metros_cuadrados; i.placeholder = '0';
      i.addEventListener('input', () => {
        if (Number(i.value) < 0) i.value = '';
        sec.metros_cuadrados = i.value; guardarBorrador();
      });
      l.appendChild(i);
      body.appendChild(l);
    }

    /* --- equipos --- */
    sec.equipos.forEach(eq => {
      const box = document.createElement('div');
      box.className = 'eq';
      const t = document.createElement('div');
      t.className = 'en'; t.textContent = eq.equipo;
      box.appendChild(t);

      if (eq.pide_texto) {
        const i = document.createElement('input');
        i.type = 'text'; i.value = eq.texto; i.placeholder = 'Escribí el dato';
        i.addEventListener('input', () => { eq.texto = i.value; guardarBorrador(); });
        box.appendChild(i);
      }

      if (eq.pide_cantidades) {
        const g = document.createElement('div');
        g.className = 'qty';
        const lT = document.createElement('label');
        lT.innerHTML = '<span class="flabel">Total</span>';
        const lN = document.createElement('label');
        lN.innerHTML = '<span class="flabel">No operativos</span>';

        const aviso = document.createElement('div');
        aviso.className = 'warn'; aviso.hidden = true;

        let cT, cN;
        function revisar() {
          const T = cT.input.value === '' ? null : Number(cT.input.value);
          let   N = cN.input.value === '' ? null : Number(cN.input.value);
          if (T !== null && N !== null && N > T) {
            N = T; cN.input.value = T;
            aviso.hidden = false;
            aviso.textContent = 'No puede haber más equipos rotos que equipos totales. Lo ajusté al total.';
          } else { aviso.hidden = true; }
          eq.total = T === null ? '' : T;
          eq.no_operativos = N === null ? '' : N;
          guardarBorrador();
          refrescarSector(sec, det);
          actualizarProgreso();
        }
        cT = contador(eq.total, revisar);
        cN = contador(eq.no_operativos, revisar);
        lT.appendChild(cT); lN.appendChild(cN);
        g.append(lT, lN);
        box.append(g, aviso);
      }

      if (eq.pide_puntaje && def.nivel_puntaje === 'EQUIPO') {
        box.appendChild(selectorPuntaje(eq.puntaje, v => {
          eq.puntaje = v; guardarBorrador(); refrescarSector(sec, det); actualizarProgreso();
        }));
      }

      body.appendChild(box);
    });

    if (def.usa_operatividad) {
      const m = document.createElement('div');
      m.dataset.rol = 'medidor';
      body.appendChild(m);
    }

    if (def.nivel_puntaje === 'SECTOR') {
      const l = document.createElement('label');
      l.className = 'f'; l.style.marginTop = '16px';
      l.innerHTML = '<span>Calificación del sector</span>';
      l.appendChild(selectorPuntaje(sec.puntaje, v => {
        sec.puntaje = v; guardarBorrador(); refrescarSector(sec, det); actualizarProgreso();
      }));
      body.appendChild(l);
    }

    const lo = document.createElement('label');
    lo.className = 'f'; lo.style.marginTop = '14px'; lo.style.marginBottom = '0';
    lo.innerHTML = '<span>Observaciones</span>';
    const ta = document.createElement('textarea');
    ta.value = sec.observacion;
    ta.placeholder = 'Qué encontraste en este sector';
    ta.addEventListener('input', () => { sec.observacion = ta.value; guardarBorrador(); });
    lo.appendChild(ta);
    body.appendChild(lo);

    /* --- pasar al siguiente sector sin buscarlo --- */
    if (idx < borrador.sectores.length - 1) {
      const n = document.createElement('button');
      n.type = 'button'; n.className = 'next';
      n.textContent = 'Siguiente: ' + borrador.sectores[idx + 1].sector + '  ›';
      n.onclick = () => {
        const sig = cont.children[idx + 1];
        det.open = false;
        sig.open = true;
      };
      body.appendChild(n);
    }

    cont.appendChild(det);
    refrescarSector(sec, det);
  });
}

function totalesSector(sec) {
  let t = 0, n = 0, hay = false;
  sec.equipos.forEach(e => {
    if (!e.pide_cantidades || e.total === '' || e.total === null) return;
    hay = true; t += Number(e.total) || 0; n += Number(e.no_operativos) || 0;
  });
  return hay ? { total: t, noop: n, op: operatividad(t, n) } : { total: null, noop: null, op: null };
}

function semaforoSector(sec, def) {
  if (def.nivel_puntaje === 'SECTOR') return sec.puntaje;
  const vals = sec.equipos.filter(e => e.pide_puntaje && e.puntaje !== null).map(e => e.puntaje);
  if (vals.length) return Math.min.apply(null, vals);
  return semaforoDeOperatividad(totalesSector(sec).op);
}

function refrescarSector(sec, det) {
  const def = borrador.def || {};
  const tot = totalesSector(sec);

  const m = det.querySelector('[data-rol="medidor"]');
  if (m) { m.innerHTML = ''; m.appendChild(medidor(tot.op)); }

  const s = semaforoSector(sec, def);
  det.querySelector('.sq').style.background =
    (s === null || s === undefined) ? '#DFE6EA' : SEM_HEX[s];

  const partes = [];
  if (tot.op !== null) partes.push(Math.round(tot.op * 100) + '%');
  if (s !== null && s !== undefined) partes.push(SEM_NOM[s]);
  det.querySelector('.st').textContent = partes.join(' · ') || 'sin cargar';
}

/** Cuántos sectores están completos, visible en el encabezado. */
function sectorCompleto(sec, def) {
  if (def.nivel_puntaje === 'SECTOR') return sec.puntaje !== null;
  return sec.equipos.filter(e => e.pide_puntaje).every(e => e.puntaje !== null);
}
function actualizarProgreso() {
  if (!borrador) return;
  const def = borrador.def || {};
  const n = borrador.sectores.filter(s => sectorCompleto(s, def)).length;

  // El sector abierto se muestra acá arriba en vez de fijarlo sobre el
  // formulario: así no tapa el primer equipo de la lista.
  const ab = document.querySelector('#fSectores details[open] .nm');
  const donde = ab ? ab.textContent : null;

  const s = $('#sub');
  s.hidden = false;
  s.textContent = (donde ? donde + ' · ' : '') +
                  `${n}/${borrador.sectores.length} sectores · ${borrador.local}`;
}

function faltantes() {
  const def = borrador.def || {};
  return borrador.sectores.filter(s => !sectorCompleto(s, def)).map(s => s.sector);
}

function cerrarInspeccion() {
  const f = faltantes();
  if (f.length && !confirm('Falta calificar: ' + f.join(', ') +
      '.\n\n¿La cerrás igual? Se va a enviar incompleta.')) return;
  borrador.estado = 'PENDIENTE';
  borrador.cerrado_en = new Date().toISOString();
  save(K.insp, insp);
  vibrar(20);
  toast('Inspección guardada. Se envía cuando haya conexión.');
  historia.length = 0;
  ir('inicio', null, { atras: true });
  pintarInicio();
  if (navigator.onLine) sincronizar(true);
}

/* =====================================================================
   PANTALLA · Mis inspecciones
   ===================================================================== */
const TAGS = { BORRADOR: ['bor', 'Borrador'], PENDIENTE: ['pen', 'Por enviar'],
               SINCRONIZADA: ['syn', 'Enviada'] };

function pintarLista() {
  const box = $('#listaBox');
  if (!insp.length) {
    box.innerHTML = `<div class="empty"><div class="big">☰</div>
      <p>Todavía no cargaste inspecciones.<br>Empezá desde el menú principal.</p></div>`;
    return;
  }
  box.innerHTML = insp.map((i, k) => {
    const t = TAGS[i.estado] || TAGS.BORRADOR;
    return `<div class="item">
      <div class="m"><b>${esc(i.local)}</b>
      <span>${esc(i.rubro)} · ${esc(i.fecha)}${i.error ? ' · ' + esc(i.error) : ''}</span></div>
      <span class="tag ${i.error ? 'err' : t[0]}">${i.error ? 'Error' : t[1]}</span>
      ${i.estado === 'BORRADOR' ? `<button class="btn sm ghost" data-abrir="${k}">Seguir</button>` : ''}
    </div>`;
  }).join('');
  box.querySelectorAll('[data-abrir]').forEach(b => {
    b.onclick = () => abrirFormulario(insp[Number(b.dataset.abrir)]);
  });
}

/* =====================================================================
   PANTALLA · Tablero
   ===================================================================== */
function pintarTablero() {
  const box = $('#tabBox');
  const datos = insp.filter(i => i.estado !== 'BORRADOR');

  if (!datos.length) {
    box.innerHTML = `<div class="empty"><div class="big">▤</div>
      <p>El tablero se arma con las inspecciones cerradas.<br>Cerrá una y volvé.</p></div>`;
    return;
  }

  const locales = new Set(datos.map(d => d.local));
  let rojos = 0;
  const porRubro = {}, porLocal = {};

  datos.forEach(d => {
    const def = (cat && cat.rubros.find(r => r.rubro === d.rubro)) || d.def || {};
    d.sectores.forEach(sec => {
      const s = semaforoSector(sec, def);
      if (s === null || s === undefined) return;
      if (s === 0) rojos++;
      (porRubro[d.rubro] = porRubro[d.rubro] || [0, 0, 0, 0])[s]++;
      porLocal[d.local] = porLocal[d.local] || { c: 0, sum: 0 };
      porLocal[d.local].c++; porLocal[d.local].sum += s;
    });
  });

  const barras = obj => Object.keys(obj).sort().map(k => {
    const v = obj[k], tot = v.reduce((a, b) => a + b, 0) || 1;
    const segs = v.map((n, i) => n ? `<i class="f${i}" style="width:${n / tot * 100}%"></i>` : '').join('');
    return `<div class="brow"><span>${esc(k)}</span><span class="bt">${segs}</span><span class="bv">${tot}</span></div>`;
  }).join('');

  const peores = Object.keys(porLocal)
    .map(k => ({ local: k, prom: porLocal[k].sum / porLocal[k].c }))
    .sort((a, b) => a.prom - b.prom).slice(0, 8);

  box.innerHTML = `
    <div class="kpis">
      <div class="kpi"><b class="num">${datos.length}</b><span>Inspecciones</span></div>
      <div class="kpi"><b class="num">${locales.size}</b><span>Locales</span></div>
      <div class="kpi"><b class="num c0">${rojos}</b><span>Alertas rojas</span></div>
    </div>
    <div class="card">
      <div class="eyebrow">Estado por rubro</div>
      <div class="bars">${barras(porRubro)}</div>
      <div class="legend">${SEM_NOM.map((n, i) =>
        `<span><i style="background:${SEM_HEX[i]}"></i>${n}</span>`).join('')}</div>
    </div>
    <div class="card">
      <div class="eyebrow">Locales que peor están</div>
      <div class="bars">${peores.map(p => {
        const s = Math.round(p.prom);
        return `<div class="brow"><span>${esc(p.local)}</span>
          <span class="bt"><i class="f${s}" style="width:${(p.prom / 3) * 100}%"></i></span>
          <span class="bv num">${p.prom.toFixed(1)}</span></div>`;
      }).join('')}</div>
      <p class="tiny" style="margin:11px 0 0">Promedio de calificación de sus sectores, de 0 a 3.</p>
    </div>
    <p class="tiny" style="text-align:center">Se arma con las inspecciones de este teléfono.
    Para el resumen de todos los supervisores, mirá la planilla.</p>`;
}

/* =====================================================================
   PANTALLA · Ajustes
   ===================================================================== */
function abrirAjustes() {
  $('#aUrl').value = cfg.url || '';
  $('#aTok').value = cfg.token || '';
  pintarSupAjustes();
  pintarCatAjustes();
  ir('ajustes', 'Versión ' + APP_VER + ' · ' + cfg.disp);
}

function pintarSupAjustes() {
  const s = $('#aSup');
  if (!cat) { s.innerHTML = '<option>Descargá los catálogos primero</option>'; s.disabled = true; return; }
  s.disabled = false;
  s.innerHTML = cat.supervisores
    .map(x => `<option value="${esc(x.id)}"${x.id === cfg.supId ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('');
  s.onchange = () => {
    const x = cat.supervisores.find(y => y.id === s.value);
    cfg.supId = x.id; cfg.supNom = x.nombre; save(K.cfg, cfg);
    toast('Supervisor guardado.');
  };
}

function pintarCatAjustes() {
  $('#aCat').textContent = cat
    ? `${cat.locales.length} locales · ${cat.supervisores.length} supervisores · ${cat.rubros.length} rubros · ${cat.equipos.length} equipos`
    : 'Sin descargar todavía.';
}

$('#aProbar').onclick = async () => {
  cfg.url = $('#aUrl').value.trim();
  cfg.token = $('#aTok').value.trim();
  save(K.cfg, cfg);
  if (!cfg.url || !cfg.token) return toast('Completá la dirección y la clave.');
  $('#aEstado').textContent = 'Conectando…';
  const r = await bajarCatalogos();
  $('#aEstado').textContent = r.ok ? '✔ Conectado. Catálogos actualizados.' : '✕ ' + r.error;
};

$('#aActualizar').onclick = async () => {
  const r = await bajarCatalogos();
  toast(r.ok ? 'Catálogos actualizados.' : r.error);
};

$('#aBorrar').onclick = () => {
  const n = insp.filter(i => i.estado === 'SINCRONIZADA').length;
  if (!n) return toast('No hay inspecciones enviadas para borrar.');
  if (!confirm(`Se borran ${n} inspecciones de este teléfono.\nSiguen guardadas en la planilla. ¿Confirmás?`)) return;
  insp = insp.filter(i => i.estado !== 'SINCRONIZADA');
  save(K.insp, insp);
  toast('Listo, se liberó espacio.');
  pintarEstado();
};

/* =====================================================================
   Comunicación con la planilla
   ===================================================================== */

/**
 * Se envía como texto plano a propósito: con application/json el navegador
 * hace una consulta previa que Apps Script no sabe responder y todo falla
 * por CORS. Apps Script recibe el contenido igual y lo lee como JSON.
 */
async function llamar(payload, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 30000);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: cfg.token }, payload)),
      signal: ctrl.signal, redirect: 'follow'
    });
    const txt = await res.text();
    try { return JSON.parse(txt); }
    catch (e) { return { ok: false, error: 'Respuesta inesperada. Revisá que la dirección termine en /exec.' }; }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Tardó demasiado.' : 'Sin conexión con la planilla.' };
  } finally { clearTimeout(t); }
}

async function bajarCatalogos() {
  if (!cfg.url || !cfg.token) return { ok: false, error: 'Falta configurar la conexión.' };
  const r = await llamar({ accion: 'catalogos' });
  if (!r.ok) return { ok: false, error: r.error || 'No se pudo descargar.' };
  cat = { version: r.catalogo_version, locales: r.locales || [], supervisores: r.supervisores || [],
          rubros: r.rubros || [], equipos: r.equipos || [] };
  save(K.cat, cat);
  pintarCatAjustes();
  pintarSupAjustes();
  return { ok: true };
}

let sincronizando = false;

async function sincronizar(silencioso) {
  if (sincronizando) return;
  const cola = pendientes();
  if (!cola.length) { if (!silencioso) toast('No hay nada pendiente.'); return; }
  if (!cfg.url || !cfg.token) { if (!silencioso) toast('Configurá la conexión en Ajustes.'); return; }
  if (!navigator.onLine) { if (!silencioso) toast('Sin conexión. Se envía más tarde.'); return; }

  sincronizando = true;
  if (!silencioso) toast('Enviando ' + cola.length + '…');

  const lote = cola.slice(0, 5);
  const r = await llamar({
    dispositivo: cfg.disp, app_version: APP_VER, supervisor: cfg.supNom,
    inspecciones: lote.map(paraEnviar)
  }, 45000);

  if (r.ok) {
    const ok = new Set(r.uuids_confirmados || []);
    insp.forEach(i => { if (ok.has(i.uuid)) { i.estado = 'SINCRONIZADA'; delete i.error; } });
    save(K.insp, insp);
    save(K.sync, Date.now());
    if (!silencioso || r.insertados) {
      toast(`Enviadas ${r.insertados || 0}${r.duplicados ? ' · ' + r.duplicados + ' ya estaban' : ''}.`);
    }
    if (r.catalogo_version && cat && r.catalogo_version !== cat.version) await bajarCatalogos();
  } else {
    // Nada se marca como enviado: se reintenta entero. Es seguro porque
    // la planilla descarta por identificador lo que ya recibió.
    lote.forEach(i => { i.error = r.error; });
    save(K.insp, insp);
    if (!silencioso) toast(r.error);
  }

  sincronizando = false;
  pintarEstado();
  pintarInicio();
  if (pantalla === 'lista') pintarLista();
  if (r.ok && pendientes().length) setTimeout(() => sincronizar(true), 1200);
}

function paraEnviar(i) {
  const def = (cat && cat.rubros.find(r => r.rubro === i.rubro)) || i.def || {};
  const sectores = [], equipos = [];

  i.sectores.forEach(sec => {
    const t = totalesSector(sec);
    sectores.push({
      uuid: sec.uuid, sector: sec.sector,
      puntaje: def.nivel_puntaje === 'SECTOR' ? sec.puntaje : null,
      metros_cuadrados: sec.metros_cuadrados === '' ? null : Number(sec.metros_cuadrados),
      total_equipos: t.total, total_no_operativos: t.noop,
      observacion: sec.observacion
    });
    sec.equipos.forEach(e => {
      if (e.total === '' && e.puntaje === null && !e.texto && !e.observacion) return;
      equipos.push({
        uuid: e.uuid, sector: sec.sector, equipo: e.equipo,
        total: e.total === '' ? null : Number(e.total),
        no_operativos: e.no_operativos === '' ? null : Number(e.no_operativos),
        puntaje: e.puntaje, texto: e.texto, observacion: e.observacion
      });
    });
  });

  return {
    uuid: i.uuid, fecha: i.fecha, local: i.local, formato: i.formato, rubro: i.rubro,
    supervisor_id: i.supervisor_id, supervisor: i.supervisor,
    observacion: i.observacion, creado_en: i.creado_en,
    sectores: sectores, equipos: equipos
  };
}

/* =====================================================================
   Barras de acción por pantalla
   ===================================================================== */
const BARRAS = {
  nueva: {
    html: () => `<button class="btn ghost" data-a="cancelar">Cancelar</button>
                 <button class="btn" data-a="comenzar">Comenzar</button>`,
    bind() {
      $('[data-a="cancelar"]').onclick = volver;
      $('[data-a="comenzar"]').onclick = comenzarInspeccion;
    }
  },
  form: {
    html: () => `<button class="btn ghost" data-a="luego">Seguir después</button>
                 <button class="btn" data-a="cerrar">Cerrar inspección</button>`,
    bind() {
      $('[data-a="luego"]').onclick = () => {
        save(K.insp, insp);
        toast('Guardada como borrador.');
        historia.length = 0;
        ir('inicio', null, { atras: true });
        pintarInicio();
      };
      $('[data-a="cerrar"]').onclick = cerrarInspeccion;
    }
  },
  lista: {
    html: () => `<button class="btn" data-a="sync">Sincronizar ahora</button>`,
    bind() { $('[data-a="sync"]').onclick = () => sincronizar(false); }
  }
};

/* =====================================================================
   Arranque
   ===================================================================== */
$('#btnBack').onclick = volver;
$('#pend').onclick = () => { ir('lista'); pintarLista(); };

$$('.menu button[data-go]').forEach(b => {
  b.onclick = () => {
    const d = b.dataset.go;
    if (d === 'nueva')   return abrirNueva();
    if (d === 'lista')   { ir('lista'); return pintarLista(); }
    if (d === 'tablero') { ir('tablero'); return pintarTablero(); }
    if (d === 'ajustes') return abrirAjustes();
  };
});

pintarInicio();
pintarBarra();

if (cfg.url && cfg.token && navigator.onLine) {
  sincronizar(true);
  if (!cat) bajarCatalogos();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

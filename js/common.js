/* Funzioni condivise tra connector, riepilogo e impostazioni */

var DEFAULT_SOGLIE = { rosso: 2, giallo: 7 };
/* Liste considerate "finali" finché non si salvano le impostazioni */
var REGEX_LISTE_FINALI = /TERMINAT|COLLAUDAT/i;

var BASE_URL = window.location.href.replace(/[^/]*$/, '');
var ICON_URL = BASE_URL + 'icon.svg';

function leggiSoglie(t) {
  return t.get('board', 'shared', 'soglie', DEFAULT_SOGLIE).then(function (s) {
    return {
      rosso: Number(s && s.rosso) >= 0 ? Number(s.rosso) : DEFAULT_SOGLIE.rosso,
      giallo: Number(s && s.giallo) >= 0 ? Number(s.giallo) : DEFAULT_SOGLIE.giallo
    };
  });
}

/* Array di id lista esclusi, oppure null se mai salvato (si usa la regola di default) */
function leggiListeEscluse(t) {
  return t.get('board', 'shared', 'listeEscluse', null);
}

function listaEsclusa(lista, escluse) {
  if (!lista) return false;
  if (Array.isArray(escluse)) return escluse.indexOf(lista.id) !== -1;
  return REGEX_LISTE_FINALI.test(lista.name || '');
}

/* Giorni di calendario tra oggi e la scadenza (negativo = scaduta) */
function giorniMancanti(due) {
  var oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  var d = new Date(due); d.setHours(0, 0, 0, 0);
  return Math.round((d - oggi) / 86400000);
}

/* ---- Giorni lavorativi: esclusi sabato, domenica, festivita' nazionali, Pasquetta
   e chiusure aziendali (Impostazioni del Power-Up, salvate sulla bacheca) ---- */
var CHIUSURE = [];   // [{dal:'2026-12-24', al:'2026-12-24'}, ...] caricate da leggiChiusure()
function chiave(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function pasqua(y) {   // algoritmo di Gauss (anonimo gregoriano)
  var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, mese - 1, giorno);
}
var FESTE_FISSE = ['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26'];
function festivo(d) {
  var k = chiave(d);
  if (FESTE_FISSE.indexOf(k.slice(5)) !== -1) return 'festa';
  var pm = pasqua(d.getFullYear()); pm.setDate(pm.getDate() + 1);
  if (chiave(pm) === k) return 'festa';
  for (var j = 0; j < CHIUSURE.length; j++) if (k >= CHIUSURE[j].dal && k <= CHIUSURE[j].al) return 'chiusura';
  return '';
}
function nonLavorativo(d) { return d.getDay() === 0 || d.getDay() === 6 || !!festivo(d); }
/* giorni lavorativi in (da, a] ; 0 se a <= da */
function lavTra(da, a) {
  var d = new Date(da); d.setHours(0, 0, 0, 0);
  var f = new Date(a); f.setHours(0, 0, 0, 0);
  var n = 0;
  while (d < f) { d.setDate(d.getDate() + 1); if (!nonLavorativo(d)) n++; }
  return n;
}
/* Giorni lavorativi alla scadenza: positivo = mancano, negativo = scaduta da, 0 = oggi
   (o nessun giorno lavorativo prima della scadenza) */
function giorniLavorativi(due) {
  var oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  var d = new Date(due); d.setHours(0, 0, 0, 0);
  if (d < oggi) return -Math.max(1, lavTra(d, oggi));
  return lavTra(oggi, d);
}
/* Testo "dd/mm" -> chiusure; righe "24/12/2026" oppure "24/12/2026 - 31/12/2026" */
function parseChiusure(testo) {
  var out = [], err = [];
  String(testo || '').split(/[\n;,]+/).forEach(function (r) {
    r = r.trim(); if (!r) return;
    var m = r.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4}))?$/);
    if (!m) { err.push(r); return; }
    var dal = new Date(+m[3], +m[2] - 1, +m[1]), al = m[4] ? new Date(+m[6], +m[5] - 1, +m[4]) : dal;
    if (isNaN(dal) || isNaN(al) || al < dal) { err.push(r); return; }
    out.push({ dal: chiave(dal), al: chiave(al) });
  });
  return { chiusure: out, errori: err };
}
function testoChiusure(lista) {
  function it(k) { var p = k.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  return (lista || []).map(function (c) { return c.dal === c.al ? it(c.dal) : it(c.dal) + ' - ' + it(c.al); }).join('\n');
}
function leggiChiusure(t) {
  return t.get('board', 'shared', 'chiusure', []).then(function (c) {
    CHIUSURE = Array.isArray(c) ? c.filter(function (x) { return x && x.dal && x.al; }) : [];
    return CHIUSURE;
  });
}

/* Restituisce { testo, colore, giorni, stato } oppure null se nessuna scadenza.
   giorni = giorni LAVORATIVI (vedi giorniLavorativi); le soglie sono in giorni lavorativi. */
function statoScadenza(due, dueComplete, soglie) {
  if (!due) return null;
  if (dueComplete) return { testo: 'Completata', colore: 'green', giorni: null, stato: 'completata' };
  var cal = giorniMancanti(due), g = giorniLavorativi(due);
  var testo, colore, stato;
  if (cal < 0) { testo = 'Scaduta da ' + (-g) + ' g lav.'; colore = 'red'; stato = 'scaduta'; }
  else if (cal === 0) { testo = 'Scade oggi'; colore = 'red'; stato = 'urgente'; }
  else {
    if (g === 0) testo = 'Scade ' + new Date(due).toLocaleDateString('it-IT', { weekday: 'short' });
    else if (g === 1 && cal === 1) testo = 'Domani';
    else testo = g + ' g lav.';
    if (g <= soglie.rosso) { colore = 'red'; stato = 'urgente'; }
    else if (g <= soglie.giallo) { colore = 'yellow'; stato = 'vicina'; }
    else { colore = 'green'; stato = 'ok'; }
  }
  return { testo: testo, colore: colore, giorni: g, stato: stato };
}

function formattaData(due) {
  return new Date(due).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

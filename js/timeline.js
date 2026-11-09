/* Deadline: una commessa per riga, barra dalla presa in carico (data di inizio) alla scadenza.
   Passato a sinistra, futuro a destra, linea verticale = oggi.
   In ritardo: la barra prosegue oltre la scadenza fino a oggi (rosso fino a 10 g lavorativi, viola oltre).
   Materiale dalla checklist "Materiale fornitori" (aggiornata dal server da Ready Web). */
var APP_KEY = 'f5089339fa1b492c9a45601594a6982c';
var CHECKLIST_MAT = 'Materiale fornitori';
var CHECKLIST_DATE = 'Date commessa';   // scritta dal server: "Finiture gg/mm/aaaa [file]"
var dateComm = {};                       // idScheda -> checklist "Date commessa"
var t = TrelloPowerUp.iframe({ appKey: APP_KEY, appName: 'Scadenze' });
var materiale = null;   // null = non autorizzato/non caricato; {} = mappa idScheda -> checklist
var carte = [], liste = [], listaSel = null, escluse = null;
var TUTTE = '*';                                   // "Tutti gli impianti" (pulsante Dashboard)
var SOLO_TUTTE = /[?&]tutte=1/.test(location.search);
var LAB_W = 280, ROW_H = 58, TOP = 30, GIORNO = 86400000;

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
// codice impianto dal nome della scheda: "1738-P Filva SRL" -> "1738-P"
function codice(nome) {
  var m = /^\s*(\d{3,5})\s*[-\/ ]?\s*([A-Za-z])\b/.exec(nome || '');
  return m ? m[1] + '-' + m[2].toUpperCase() : String(nome || '').split(/\s+/)[0];
}
// lista (fase) della scheda e nome corto: "COMMESSE IN PRODUZIONE" -> "IN PRODUZIONE"
function listaDi(c) { return liste.filter(function (l) { return l.id === c.idList; })[0]; }
function fase(c) {
  var l = listaDi(c);
  if (!l) return '';
  var n = l.name.replace(/^COMMESSE[\s_]*/i, '').replace(/_/g, ' ').replace(/\(.*\)/, '')
    .replace(/^IN\s+/i, '').replace(/\s+DA COMPLETARE$/i, '').trim();
  return n.length > 16 ? n.slice(0, 15) + '\u2026' : n;
}
function oggi0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function giorno0(x) { var d = new Date(x); d.setHours(0, 0, 0, 0); return d; }
// Giorni lavorativi di resa (trasporto) dopo la data del fornitore: stesso valore di GiorniResaFornitore
// in collegamento-programma.json sul server (eccezioni per fornitore solo lato server/mail).
var GIORNI_RESA = 2, GIORNI_PROD_STD = 14, GIORNI_PROD_MIN = 7;   // come collegamento-programma.json
function conResa(d) { if (!d) return d; var r = new Date(d), n = 0; while (n < GIORNI_RESA) { r.setDate(r.getDate() + 1); if (!nonLavorativo(r)) n++; } return r; }
function gm(d) { return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }); }
function gma(d) { return d.toLocaleDateString('it-IT'); }

function colore(g, completa) {
  if (completa) return 'grigio';
  if (g < -10) return 'viola';
  if (g < 0) return 'rosso';
  if (g <= 10) return 'giallo';
  return 'verde';
}

// g = giorni LAVORATIVI (sabato, domenica, festivita' e chiusure aziendali esclusi)
function etichetta(g, completa, due) {
  if (completa) return 'Completata';
  if (g === 0) return (due && giorniMancanti(due) > 0) ? 'Scade ' + gm(giorno0(due)) : 'Scade oggi';
  if (g < 0) return 'In ritardo di ' + (-g) + ' g lav.';
  return 'Mancano ' + g + ' g lav.';
}

function parseData(s) {
  var m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

function calcolaMateriale(c) {
  if (!materiale) return undefined;
  var cl = materiale[c.id];
  if (!cl) return null;
  var oggi = oggi0();
  var due = c.due ? giorno0(c.due) : null;
  var m = { arrivati: 0, totale: 0, voci: 0, vociFatte: 0, mancanti: [], ritardo: false, inRitardo: 0, ultimo: '', ultimoD: null }, ultimo = null;
  cl.checkItems.forEach(function (it) {
    m.voci++; if (it.state === 'complete') m.vociFatte++;
    var gruppo = /^(\d+) pezzi già a magazzino/.exec(it.name);   // voce riassuntiva
    var n = gruppo ? +gruppo[1] : 1;
    m.totale += n;
    if (it.state === 'complete') { m.arrivati += n; return; }
    var parti = it.name.replace(/\s*\[[^\]]*\]\s*$/, '').split(' – ');
    var ordine = (/\[([^\]]+)\]\s*$/.exec(it.name) || [])[1] || '';
    var arr = parseData(it.name), motivo = '';
    if (arr && arr < oggi) motivo = 'doveva arrivare';
    else if (arr && due && arr > due) motivo = 'dopo la scadenza';
    if (motivo) { m.ritardo = true; m.inRitardo++; }
    if (arr && (!ultimo || arr > ultimo)) ultimo = arr;
    m.mancanti.push([parti[0] || it.name, parti[1] || '', (parti[2] || '').replace(/^arrivo.*/, ''),
                     arr ? gma(arr) : 'non indicato', motivo, ordine, arr]);
  });
  m.ultimoD = ultimo;
  m.ultimo = ultimo ? gm(ultimo) : '';
  return m;
}

// VINCOLI col Programma lavori (solo montaggi non ancora finiti; date fornitori fisse):
//  pezzi senza data, in arrivo dopo l'inizio montaggio o gia' in ritardo; scadenza Trello dopo l'inizio montaggio.
// Restituisce i pezzi in conflitto; .scad = scadenza Trello se cade dopo l'inizio montaggio; .n = numero problemi
function conflitto(c, tp) {
  var r = [];
  if (!tp || !tp.montaggio || (tp.montaggioFine || tp.montaggio) < oggi0()) { r.n = 0; return r; }
  var o = oggi0();
  if (c.mat && c.mat.mancanti) r = c.mat.mancanti.filter(function (x) { var d = conResa(x[6]); return !d || d > tp.montaggio || d < o; });
  // produzione: standard 14 g prima del montaggio, forzabile fino a 7 g (margine ridotto, lo organizza Massimo)
  if (c.due && !c.dueComplete && tp.montaggio > o) {
    var sc = giorno0(c.due), lim = new Date(tp.montaggio); lim.setDate(lim.getDate() - GIORNI_PROD_MIN); if (lim < o) lim = o;
    var std = new Date(tp.montaggio); std.setDate(std.getDate() - GIORNI_PROD_STD);
    if (sc > lim) r.scad = sc; else if (sc > std) r.ridotto = sc;
  }
  r.n = r.length + (r.scad ? 1 : 0);
  return r;
}
function testoConflitto(cf, tp) {
  if (cf.length && cf.scad) return 'montaggio ' + gm(tp.montaggio) + ': materiale e scadenza';
  if (cf.scad) return 'scadenza ' + gm(cf.scad) + (cf.scad >= tp.montaggio ? ' dopo il' : ' troppo vicina al') + ' montaggio ' + gm(tp.montaggio);
  return 'montaggio ' + gm(tp.montaggio) + ' prima del materiale';
}

function testoMateriale(m) {
  if (m === undefined) return '';
  if (!m) return '<span class="mat mat-nd">&#128230; nessun dato</span>';
  if (m.arrivati === m.totale) return '<span class="mat mat-ok">&#128230; ' + m.totale + '/' + m.totale + ' a magazzino</span>';
  var cls = m.ritardo ? 'mat-ko' : 'mat-wait';
  var txt = m.ritardo ? '&#9888; ' + m.inRitardo + ' in ritardo' : (m.ultimo ? 'ultimo arrivo ' + m.ultimo : 'in arrivo');
  return '<span class="mat ' + cls + '">&#128230; ' + m.arrivati + '/' + m.totale + ' &middot; ' + txt + '</span>';
}

function dettaglio(c) {
  var m = c.mat, h = '<h4>' + esc(c.name) + ' <button class="apri" data-apri="' + c.id + '">Apri scheda</button></h4>';
  h += '<p>Presa in carico <b>' + (c.start ? gma(new Date(c.start)) : 'non indicata') + '</b> &middot; scadenza <b>' + (c.due ? gma(new Date(c.due)) : 'non indicata') + '</b> &middot; ' + etichetta(c.g, c.dueComplete, c.due) + '</p>';
  var tp = tappe[c.id] ? tappeDi(c.id) : null;
  if (tp) h += '<p>' + TAPPE.map(function (x) { return x.nome + ' <b>' + (tp[x.k] ? gma(tp[x.k]) : '&ndash;') + '</b>'; }).join(' &middot; ') + '</p>';
  var tq = tappeDi(c.id);
  if (tq.montaggio) h += '<p>Programma lavori: montaggio <b>' + gma(tq.montaggio) + ' &ndash; ' + gma(tq.montaggioFine) + '</b>' + (tq.montatori ? ' (' + esc(tq.montatori) + ')' : '') +
    (tq.montaggioNota ? ' <i>' + esc(tq.montaggioNota) + '</i>' : '') + (tq.prodEntro ? ' &middot; produzione entro <b>' + gma(tq.prodEntro) + '</b>' : '') + '</p>';
  var cf = conflitto(c, tq);
  if (cf.length) h += '<p class="conf">&#9888; Il montaggio (dal ' + gma(tq.montaggio) + ') non &egrave; compatibile con ' + cf.length + ' pezz' + (cf.length > 1 ? 'i' : 'o') + ': senza data, in arrivo dopo l\'inizio montaggio o gi&agrave; in ritardo (righe evidenziate sotto). Le date dei fornitori non si spostano: rivedere il programma o sollecitare.</p>';
  if (cf.scad) h += '<p class="conf">&#9888; La scadenza Trello (' + gma(cf.scad) + ') lascia meno di ' + GIORNI_PROD_MIN + ' giorni prima del montaggio (' + gma(tq.montaggio) + '): anticipare la scadenza o rivedere il programma.</p>';
  else if (cf.ridotto) h += '<p>Margine ridotto: produzione ' + gma(cf.ridotto) + ', montaggio ' + gma(tq.montaggio) + ' (' + Math.round((tq.montaggio - cf.ridotto) / 864e5) + ' g invece di ' + GIORNI_PROD_STD + ', da organizzare con Massimo).</p>';
  if (m === undefined) return h + '<p>Autorizza la lettura del materiale (pulsante in alto) per vedere il dettaglio.</p>';
  if (!m) return h + '<p>Nessuna checklist "' + CHECKLIST_MAT + '" su questa scheda.</p>';
  if (!m.mancanti.length) return h + '<p>Tutto il materiale (' + m.totale + ' pezzi) risulta a magazzino.</p>';
  h += '<p>Materiale arrivato <b>' + m.arrivati + ' su ' + m.totale + '</b></p><table><tr><th>Pezzo</th><th>Fornitore</th><th>Stato</th><th>Arrivo</th><th></th><th>Ordine</th></tr>';
  m.mancanti.forEach(function (x) {
    var inConf = cf.indexOf(x) >= 0, dopo = inConf && (!x[6] || conResa(x[6]) > tq.montaggio);
    var mot = x[4] || (inConf ? (dopo ? 'dopo l\'inizio montaggio' : 'in ritardo') : '');
    if (dopo && x[4]) mot += ', dopo l\'inizio montaggio';
    h += '<tr' + (mot ? ' class="rit"' : '') + '><td>' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td><td>' + x[2] + '</td><td>' + x[3] + '</td><td>' + mot + '</td><td>' + esc(x[5]) + '</td></tr>';
  });
  return h + '</table>';
}

// ---------- Milestone dalla cronologia di Trello ----------
// Rilievo   = giorno in cui e' stata spuntata la voce "Rilievo"  (in mancanza: spostamento in RILIEVO FATTO)
// Progetto  = giorno in cui e' stata spuntata la voce "Layout"   (in mancanza: spostamento in COMMESSE IN PRODUZIONE)
// Produzione= giorno in cui la scheda e' entrata in COMMESSE IN PRODUZIONE
var TAPPE = [
  { k: 'rilievo', lettera: 'R', nome: 'Rilievo' },
  { k: 'progetto', lettera: 'P', nome: 'Progetto' },
  { k: 'finiture', lettera: 'F', nome: 'Finiture' },
  { k: 'montaggio', lettera: 'M', nome: 'Montaggio' },
  { k: 'produzione', lettera: '&#9654;', nome: 'In produzione' }
];
var tappe = {}, tokenApi = null, caricoTappe = false;

function calcolaTappe(azioni) {
  var r = {}, spunte = {}, spost = {};
  // le azioni arrivano dalla piu' recente: si tiene la piu' recente "spuntata" / il primo ingresso nella lista
  azioni.forEach(function (a) {
    var d = giorno0(a.date);
    if (a.type === 'updateCheckItemStateOnCard' && a.data.checkItem && a.data.checkItem.state === 'complete') {
      var n = (a.data.checkItem.name || '').trim().toLowerCase();
      if (!spunte[n]) spunte[n] = d;
    }
    if (a.type === 'updateCard' && a.data.listAfter) spost[a.data.listAfter.name.trim().toUpperCase()] = d;   // resta il primo ingresso
  });
  function lista(rx) { for (var k in spost) if (rx.test(k)) return spost[k]; return null; }
  r.rilievo = spunte['rilievo'] || lista(/RILIEVO FATTO/);
  r.produzione = lista(/IN PRODUZIONE/);
  r.progetto = spunte['layout'] || r.produzione;
  return r;
}

// milestone dalla cronologia + data finiture dalla checklist "Date commessa"
function tappeDi(id) {
  var r = {}, tp = tappe[id] || {};
  for (var k in tp) r[k] = tp[k];
  var dc = dateComm[id];
  if (dc) dc.checkItems.forEach(function (it) {
    var m = /^Finiture\s+(\d{2}\/\d{2}\/\d{4})/.exec(it.name);
    if (m) r.finiture = parseData(m[1]);
    // "Montaggio gg/mm/aaaa - gg/mm/aaaa (Montatore)" e "Produzione entro gg/mm/aaaa" (dal Programma lavori)
    var mo = /^Montaggio\s+(\d{2}\/\d{2}\/\d{4})\D+(\d{2}\/\d{2}\/\d{4})\s*(\(([^)]*)\))?(.*)$/.exec(it.name);
    if (mo) { r.montaggio = parseData(mo[1]); r.montaggioFine = parseData(mo[2]); r.montatori = mo[4] || ''; r.montaggioNota = (mo[5] || '').replace(/^\s*-\s*/, ''); }
    var pe = /^Produzione entro\s+(\d{2}\/\d{2}\/\d{4})/.exec(it.name);
    if (pe) r.prodEntro = parseData(pe[1]);
  });
  return r;
}

function caricaTappe(ids) {
  var mancano = ids.filter(function (id) { return !tappe[id]; });
  if (!tokenApi || !mancano.length || caricoTappe) return Promise.resolve(false);
  caricoTappe = true;
  return Promise.all(mancano.map(function (id) {
    return fetch('https://api.trello.com/1/cards/' + id + '/actions?filter=updateCheckItemStateOnCard,updateCard:idList&limit=300&fields=type,date,data&key=' + APP_KEY + '&token=' + tokenApi)
      .then(function (x) { return x.json(); })
      .then(function (az) { tappe[id] = calcolaTappe(az || []); })
      .catch(function () { tappe[id] = {}; });
  })).then(function () { caricoTappe = false; return true; });
}

function disegna() {
  var area = document.getElementById('area');
  var wrap = document.getElementById('wrap');
  var oggi = oggi0();
  var sel = listaSel === TUTTE
    ? carte.filter(function (c) { return !listaEsclusa(listaDi(c), escluse); })
    : carte.filter(function (c) { return c.idList === listaSel; });
  var conData = sel.filter(function (c) { return c.due; })
    .map(function (c) {
      c.g = giorniLavorativi(c.due); c.mat = calcolaMateriale(c);
      c.d = giorno0(c.due); c.s = c.start ? giorno0(c.start) : null;
      return c;
    })
    .sort(function (a, b) { return a.d - b.d; });   // prima le scadenze piu' vicine (o gia' passate)
  var senza = sel.filter(function (c) { return !c.due; });

  document.getElementById('nodata').innerHTML = senza.length
    ? '<b>Senza scadenza (' + senza.length + '):</b><br>' + senza.map(function (c) {
        return '<span data-id="' + c.id + '">' + esc(c.name) + '</span>';
      }).join('')
    : '';

  if (!conData.length) {
    area.style.width = '100%'; area.style.height = 'auto';
    area.innerHTML = '<div class="vuoto">Nessuna commessa con scadenza in questa lista.</div>';
    return;
  }

  // Intervallo dell'asse: dalla presa in carico piu' vecchia alla scadenza piu' lontana (oggi sempre compreso)
  var min = oggi, max = oggi;
  conData.forEach(function (c) {
    var a = c.s && c.s < c.d ? c.s : c.d;
    if (a < min) min = a;
    if (c.d > max) max = c.d;
    var tm = tappeDi(c.id);
    if (tm.montaggioFine && tm.montaggioFine > max) max = tm.montaggioFine;
  });
  min = new Date(min.getTime() - 7 * GIORNO);
  max = new Date(max.getTime() + 14 * GIORNO);
  var nGiorni = Math.round((max - min) / GIORNO);
  var largh = Math.max(wrap.clientWidth - 2 - LAB_W, 600);
  var pxG = Math.max(largh / nGiorni, 1);
  var W = Math.round(LAB_W + nGiorni * pxG);
  var H = TOP + conData.length * ROW_H + 8;
  function xD(d) { return LAB_W + (d - min) / GIORNO * pxG; }

  var html = '';
  // righe alternate
  conData.forEach(function (c, i) {
    html += '<div class="fondo' + (i % 2 ? ' dispari' : '') + '" style="top:' + (TOP + i * ROW_H) + 'px;width:' + W + 'px;height:' + ROW_H + 'px"></div>';
  });
  // tacche: inizio di ogni mese (+ settimane se l'intervallo e' corto)
  var d = new Date(min.getFullYear(), min.getMonth(), 1);
  while (d <= max) {
    if (d >= min) {
      html += '<div class="tick mese" style="left:' + xD(d) + 'px"><span>' +
        d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }) + '</span></div>';
    }
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  if (nGiorni <= 150) {
    var w = new Date(min); w.setDate(w.getDate() + ((8 - w.getDay()) % 7));   // lunedi'
    for (; w <= max; w.setDate(w.getDate() + 7)) {
      if (w.getDate() !== 1) html += '<div class="tick settimana" style="left:' + xD(w) + 'px"></div>';
    }
  }
  html += '<div class="intest" style="width:' + (LAB_W - 8) + 'px">Presa in carico &rarr; scadenza</div>';
  html += '<div class="oggi" style="left:' + (xD(oggi) - 1) + 'px"><span>Oggi ' + gm(oggi) + '</span></div>';

  conData.forEach(function (c, i) {
    var col = colore(c.g, c.dueComplete);
    var y = TOP + i * ROW_H;
    var b = c.badges || {};
    var dcn = dateComm[c.id] ? dateComm[c.id].checkItems.length : 0;
    var dcf = dateComm[c.id] ? dateComm[c.id].checkItems.filter(function (x) { return x.state === 'complete'; }).length : 0;
    var tot = (b.checkItems || 0) - (c.mat ? c.mat.voci : 0) - dcn, fatti = (b.checkItemsChecked || 0) - (c.mat ? c.mat.vociFatte : 0) - dcf;
    var ck = tot > 0 ? ' &middot; <span class="ck">&#9745; ' + fatti + '/' + tot + '</span>' : '';
    var tpc = tappeDi(c.id), cfl = conflitto(c, tpc);
    var alert = (c.mat && c.mat.ritardo) || cfl.n ? ' alert' : '';

    // etichetta a sinistra
    html += '<div class="lab' + (i % 2 ? ' dispari' : '') + alert + '" data-id="' + c.id + '" style="top:' + y + 'px;height:' + ROW_H + 'px" title="' + esc(c.name) + '">' +
      '<b>' + esc(c.name) + '</b><span class="sub">' + (listaSel === TUTTE ? '<span class="fase">' + esc(fase(c)) + '</span> ' : '') + (c.s ? gm(c.s) : '--/--') + ' &rarr; ' + gm(c.d) + ' &middot; <b class="eti ' + colore(c.g, c.dueComplete) + '">' + etichetta(c.g, c.dueComplete, c.due) + '</b></span>' +
      '<span class="sub">' + (cfl.n ? '<span class="mat mat-ko">&#9888; ' + testoConflitto(cfl, tpc) + '</span>' : testoMateriale(c.mat) + ck) + '</span></div>';

    // barra: presa in carico -> scadenza
    var x1 = c.s ? xD(c.s) : xD(c.d) - 40, x2 = xD(c.d);
    if (x2 - x1 < 6) x1 = x2 - 6;
    var ritardo = c.g < 0 && !c.dueComplete;
    var yb = y + Math.round((ROW_H - 22) / 2) + 5, testo = esc(codice(c.name));
    var stretta = (x2 - x1) < 95;
    html += '<div class="bar ' + col + (c.s ? '' : ' noinizio') + alert + '" data-id="' + c.id + '" style="left:' + x1 + 'px;top:' + yb + 'px;width:' + (x2 - x1) + 'px">' +
      (testo && !stretta ? '<span>' + testo + '</span>' : '') + '</div>';
    if (testo && stretta) html += '<div class="fuori sx" style="left:' + (x1 - 206) + 'px;top:' + yb + 'px">' + testo + '</div>';
    // in ritardo: la barra "sborda" dalla scadenza fino a oggi
    if (ritardo) {
      var wc = Math.max(xD(oggi) - x2, 3);
      html += '<div class="coda ' + col + '" data-id="' + c.id + '" style="left:' + x2 + 'px;top:' + yb + 'px;width:' + wc + 'px">' +
        (wc >= 48 ? '<span>+' + (-c.g) + ' g lav.</span>' : '') + '</div>';
      if (wc < 48) html += '<div class="fuori rit" style="left:' + (x2 + wc + 6) + 'px;top:' + yb + 'px">+' + (-c.g) + ' g lav.</div>';
    }
    // milestone (rilievo, progetto, ingresso in produzione)
    // sopra la barra, appoggiate al bordo; se troppo vicine si affiancano (la data esatta e' nel tooltip)
    var tp = tappeDi(c.id), ultimaX = -99;
    TAPPE.filter(function (m) { return tp[m.k]; })
      .sort(function (a, b2) { return tp[a.k] - tp[b2.k]; })
      .forEach(function (m) {
        var xm = Math.max(xD(tp[m.k]) - 8, ultimaX + 16);
        ultimaX = xm;
        html += '<div class="tappa ' + m.k + '" data-id="' + c.id + '" title="' + m.nome + ' ' + gma(tp[m.k]) + '" style="left:' + xm + 'px;top:' + (yb - 11) + 'px">' + m.lettera + '</div>';
      });
    // fascia del montaggio (dal Programma lavori), sotto la barra
    if (tpc.montaggio) {
      var xa = xD(tpc.montaggio), xb = xD(tpc.montaggioFine || tpc.montaggio) + pxG;
      html += '<div class="mont' + (cfl.n ? ' conf' : '') + '" data-id="' + c.id + '" title="Montaggio ' + gma(tpc.montaggio) + ' - ' + gma(tpc.montaggioFine || tpc.montaggio) + (tpc.montatori ? ' (' + esc(tpc.montatori) + ')' : '') + '" style="left:' + xa + 'px;top:' + (yb + 24) + 'px;width:' + Math.max(xb - xa, 4) + 'px"></div>';
    }
    // segno della scadenza
    html += '<div class="scad" style="left:' + (x2 - 1) + 'px;top:' + (yb - 4) + 'px"></div>';
    // arrivo dell'ultimo pezzo atteso
    if (c.mat && c.mat.ultimoD) {
      var late = c.mat.ultimoD > c.d || c.mat.ultimoD < oggi;
      html += '<div class="mk' + (late ? ' late' : '') + '" title="Ultimo pezzo atteso il ' + gma(c.mat.ultimoD) + '" style="left:' + (xD(c.mat.ultimoD) - 5) + 'px;top:' + (yb + 17) + 'px"></div>';
    }
  });

  area.style.width = W + 'px';
  area.style.height = H + 'px';
  area.innerHTML = html;
  wrap.scrollLeft = Math.max(xD(oggi) - wrap.clientWidth * 0.6, 0);
  fissaEtichette();
  caricaTappe(conData.map(function (c) { return c.id; })).then(function (nuove) { if (nuove) disegna(); });
}

// le etichette a sinistra restano ferme quando si scorre la linea del tempo
function fissaEtichette() {
  var sx = document.getElementById('wrap').scrollLeft + 'px';
  Array.prototype.forEach.call(document.querySelectorAll('.lab, .intest'), function (l) { l.style.left = sx; });
}
document.getElementById('wrap').addEventListener('scroll', fissaEtichette);

document.body.addEventListener('click', function (e) {
  var ap = e.target.closest('[data-apri]');
  if (ap) { t.showCard(ap.getAttribute('data-apri')); return; }
  if (e.target.closest('#autorizza')) { autorizza(); return; }
  var riga = e.target.closest('#area [data-id]');
  if (riga) {
    var id = riga.getAttribute('data-id');
    var c = carte.filter(function (x) { return x.id === id; })[0];
    Array.prototype.forEach.call(document.querySelectorAll('#area [data-id]'), function (b) { b.classList.toggle('sel', b.getAttribute('data-id') === id); });
    document.getElementById('det').innerHTML = dettaglio(c);
    return;
  }
  var el = e.target.closest('[data-id]');
  if (el) t.showCard(el.getAttribute('data-id'));
});

function caricaMateriale() {
  var api = t.getRestApi();
  return api.isAuthorized().then(function (ok) {
    document.getElementById('auth').style.display = ok ? 'none' : '';
    if (!ok) { materiale = null; return; }
    return Promise.all([api.getToken(), t.board('id')]).then(function (r) {
      tokenApi = r[0];
      return fetch('https://api.trello.com/1/boards/' + r[1].id + '/cards?fields=id&checklists=all&checklist_fields=name&key=' + APP_KEY + '&token=' + r[0])
        .then(function (x) { return x.json(); })
        .then(function (cards) {
          materiale = {};
          cards.forEach(function (cd) {
            var cl = (cd.checklists || []).filter(function (k) { return k.name === CHECKLIST_MAT; })[0];
            if (cl) materiale[cd.id] = cl;
            var dc = (cd.checklists || []).filter(function (k) { return k.name === CHECKLIST_DATE; })[0];
            if (dc) dateComm[cd.id] = dc;
          });
        });
    });
  }).catch(function () { materiale = null; });
}

function autorizza() {
  t.getRestApi().authorize({ scope: 'read', expiration: 'never' })
    .then(function () { return caricaMateriale(); })
    .then(function () { disegna(); });
}

document.getElementById('lista').addEventListener('change', function () {
  listaSel = this.value;
  if (!SOLO_TUTTE) t.set('board', 'private', 'listaTimeline', listaSel);
  document.getElementById('det').innerHTML = '<i>Clicca una commessa per vedere il dettaglio del materiale.</i>';
  disegna();
});

window.addEventListener('resize', function () { if (carte.length) disegna(); });

// Dimensione della Deadline (A- / A+), ricordata per ogni utente. Default 125%.
var ZOOM_MIN = 1, ZOOM_MAX = 2, ZOOM_STEP = 0.125, zoom = 1.25;
function applicaZoom(z, salva) {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z / ZOOM_STEP) * ZOOM_STEP));
  document.body.style.zoom = zoom;
  document.getElementById('zval').textContent = Math.round(zoom * 100) + '%';
  if (salva) t.set('member', 'private', 'zoomDeadline', zoom);
  if (carte.length) disegna();
}
document.getElementById('zmeno').addEventListener('click', function () { applicaZoom(zoom - ZOOM_STEP, true); });
document.getElementById('zpiu').addEventListener('click', function () { applicaZoom(zoom + ZOOM_STEP, true); });
t.get('member', 'private', 'zoomDeadline', 1.25).then(function (z) { applicaZoom(Number(z) || 1.25, false); }, function () { applicaZoom(1.25, false); });

t.render(function () {
  return Promise.all([
    t.cards('id', 'name', 'start', 'due', 'dueComplete', 'idList', 'badges'),
    t.lists('id', 'name'),
    t.get('board', 'private', 'listaTimeline', null),
    leggiListeEscluse(t),
    leggiChiusure(t)
  ]).then(function (r) {
    carte = r[0]; liste = r[1]; escluse = r[3];
    var salvata = (r[2] === TUTTE || liste.some(function (l) { return l.id === r[2]; })) ? r[2] : null;
    var prod = liste.filter(function (l) { return /IN PRODUZIONE/i.test(l.name); })[0];
    listaSel = SOLO_TUTTE ? TUTTE : (salvata || (prod ? prod.id : (liste[0] && liste[0].id)));
    document.getElementById('lista').innerHTML =
      '<option value="' + TUTTE + '"' + (listaSel === TUTTE ? ' selected' : '') + '>TUTTI GLI IMPIANTI</option>' +
      liste.map(function (l) {
        return '<option value="' + l.id + '"' + (l.id === listaSel ? ' selected' : '') + '>' + esc(l.name) + '</option>';
      }).join('');
    return caricaMateriale();
  }).then(function () { disegna(); });
});

/* Deadline: timeline commesse (in corso a sinistra, in ritardo a destra) + materiale da checklist "Materiale fornitori" */
var APP_KEY = 'f5089339fa1b492c9a45601594a6982c';
var CHECKLIST_MAT = 'Materiale fornitori';
var t = TrelloPowerUp.iframe({ appKey: APP_KEY, appName: 'Scadenze' });
var materiale = null;   // null = non autorizzato/non caricato; {} = mappa idScheda -> checklist
var carte = [], liste = [], listaSel = null;
var BOX_W = 200, BOX_H = 78, GAP = 8, TOP = 30;

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function colore(g, completa) {
  if (completa) return 'grigio';
  if (g < -10) return 'viola';
  if (g < 0) return 'rosso';
  if (g <= 10) return 'giallo';
  return 'verde';
}

function etichetta(g, completa) {
  if (completa) return 'Completata';
  if (g === 0) return 'Scade oggi';
  if (g < 0) return 'Scaduta da ' + (-g) + ' g';
  return 'Tra ' + g + ' g';
}

function parseData(s) {
  var m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

function calcolaMateriale(c) {
  if (!materiale) return undefined;
  var cl = materiale[c.id];
  if (!cl) return null;
  var oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  var due = c.due ? new Date(c.due) : null; if (due) due.setHours(0, 0, 0, 0);
  var m = { arrivati: 0, totale: 0, voci: 0, vociFatte: 0, mancanti: [], ritardo: false, inRitardo: 0, ultimo: '' }, ultimo = null;
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
                     arr ? arr.toLocaleDateString('it-IT') : 'non indicato', motivo, ordine]);
  });
  m.ultimo = ultimo ? ultimo.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '';
  return m;
}

function rigaMateriale(c) {
  var m = c.mat;
  if (m === undefined) return '';
  if (!m) return '<div class="mat mat-nd">&#128230; nessun dato materiale</div>';
  if (m.arrivati === m.totale) return '<div class="mat mat-ok">&#128230; ' + m.arrivati + '/' + m.totale + ' &middot; tutto a magazzino</div>';
  var cls = m.ritardo ? 'mat-ko' : 'mat-wait';
  var txt = m.ritardo ? '&#9888; ' + m.inRitardo + ' in ritardo' : (m.ultimo ? 'ultimo arrivo ' + m.ultimo : 'in arrivo');
  return '<div class="mat ' + cls + '">&#128230; ' + m.arrivati + '/' + m.totale + ' &middot; ' + txt + '</div>';
}

function dettaglio(c) {
  var m = c.mat, h = '<h4>' + esc(c.name) + ' <button class="apri" data-apri="' + c.id + '">Apri scheda</button></h4>';
  h += '<p>Presa in carico <b>' + (c.start ? new Date(c.start).toLocaleDateString('it-IT') : 'non indicata') + '</b> &middot; scadenza <b>' + (c.due ? new Date(c.due).toLocaleDateString('it-IT') : 'non indicata') + '</b></p>';
  if (m === undefined) return h + '<p>Autorizza la lettura del materiale (pulsante in alto) per vedere il dettaglio.</p>';
  if (!m) return h + '<p>Nessuna checklist "' + CHECKLIST_MAT + '" su questa scheda.</p>';
  if (!m.mancanti.length) return h + '<p>Tutto il materiale (' + m.totale + ' pezzi) risulta a magazzino.</p>';
  h += '<p>Materiale arrivato <b>' + m.arrivati + ' su ' + m.totale + '</b></p><table><tr><th>Pezzo</th><th>Fornitore</th><th>Stato</th><th>Arrivo</th><th></th><th>Ordine</th></tr>';
  m.mancanti.forEach(function (x) {
    h += '<tr' + (x[4] ? ' class="rit"' : '') + '><td>' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td><td>' + x[2] + '</td><td>' + x[3] + '</td><td>' + (x[4] || '') + '</td><td>' + esc(x[5]) + '</td></tr>';
  });
  return h + '</table>';
}

function disegna() {
  var area = document.getElementById('area');
  var wrap = document.getElementById('wrap');
  var sel = carte.filter(function (c) { return c.idList === listaSel; });
  var conData = sel.filter(function (c) { return c.due; })
    .map(function (c) { c.g = giorniMancanti(c.due); c.mat = calcolaMateriale(c); return c; })
    .sort(function (a, b) { return b.g - a.g; });   // da sinistra a destra
  var senza = sel.filter(function (c) { return !c.due; });

  document.getElementById('nodata').innerHTML = senza.length
    ? '<b>Senza data (' + senza.length + '):</b><br>' + senza.map(function (c) {
        return '<span data-id="' + c.id + '">' + esc(c.name) + '</span>';
      }).join('')
    : '';

  if (!conData.length) {
    area.style.width = '100%'; area.style.height = 'auto';
    area.innerHTML = '<div class="vuoto">Nessuna commessa con scadenza in questa lista.</div>';
    return;
  }

  // Asse simmetrico attorno a oggi
  var maxG = 14;
  conData.forEach(function (c) { maxG = Math.max(maxG, Math.abs(c.g)); });
  maxG = Math.ceil((maxG + 3) / 7) * 7;
  var largh = Math.max(wrap.clientWidth - 2, 900);
  var pxG = Math.max((largh - BOX_W) / (2 * maxG), 6);
  var W = Math.round(2 * maxG * pxG + BOX_W);
  var x0 = W / 2;
  function xDi(g) { return x0 - g * pxG; }   // specchiata: in corso a sinistra, in ritardo a destra

  // Righe: ogni casella va nella prima riga libera
  var righe = [];
  conData.forEach(function (c) {
    var left = Math.min(Math.max(xDi(c.g) - BOX_W / 2, 0), W - BOX_W);
    var r = 0;
    while (righe[r] !== undefined && righe[r] > left - GAP) r++;
    righe[r] = left + BOX_W;
    c.left = left; c.riga = r;
  });
  var H = TOP + righe.length * (BOX_H + GAP) + 10;

  var html = '';
  var passo = maxG > 60 ? 14 : 7;
  for (var g = -maxG; g <= maxG; g += passo) {
    if (g === 0) continue;
    var d = new Date(); d.setDate(d.getDate() + g);
    html += '<div class="tick" style="left:' + xDi(g) + 'px"><span>' +
      d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) + '</span></div>';
  }
  html += '<div class="oggi" style="left:' + (x0 - 1) + 'px"><span>Oggi ' +
    new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) + '</span></div>';

  conData.forEach(function (c) {
    var col = colore(c.g, c.dueComplete);
    var top = TOP + c.riga * (BOX_H + GAP);
    var b = c.badges || {};
    var tot = (b.checkItems || 0) - (c.mat ? c.mat.voci : 0), fatti = (b.checkItemsChecked || 0) - (c.mat ? c.mat.vociFatte : 0);
    var ck = tot > 0 ? ' · ☑ ' + fatti + '/' + tot : '';
    html += '<div class="pin ' + col + '" style="left:' + xDi(c.g) + 'px;top:' + (TOP - 6) + 'px;height:' + (top - TOP + 6) + 'px"></div>';
    html += '<div class="box ' + col + (c.mat && c.mat.ritardo ? ' alert' : '') + '" data-id="' + c.id + '" title="' + esc(c.name) + '" style="left:' + c.left + 'px;top:' + top + 'px">' +
      '<b>' + esc(c.name) + '</b>' + formattaData(c.due) + '<br>' +
      '<strong>' + etichetta(c.g, c.dueComplete) + '</strong><span class="ck">' + ck + '</span>' + rigaMateriale(c) + '</div>';
  });

  area.style.width = W + 'px';
  area.style.height = H + 'px';
  area.innerHTML = html;
  wrap.scrollLeft = x0 - wrap.clientWidth / 2;
}

document.body.addEventListener('click', function (e) {
  var ap = e.target.closest('[data-apri]');
  if (ap) { t.showCard(ap.getAttribute('data-apri')); return; }
  if (e.target.closest('#autorizza')) { autorizza(); return; }
  var box = e.target.closest('.box[data-id]');
  if (box) {
    var c = carte.filter(function (x) { return x.id === box.getAttribute('data-id'); })[0];
    Array.prototype.forEach.call(document.querySelectorAll('.box'), function (b) { b.classList.toggle('sel', b === box); });
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
      return fetch('https://api.trello.com/1/boards/' + r[1].id + '/cards?fields=id&checklists=all&checklist_fields=name&key=' + APP_KEY + '&token=' + r[0])
        .then(function (x) { return x.json(); })
        .then(function (cards) {
          materiale = {};
          cards.forEach(function (cd) {
            var cl = (cd.checklists || []).filter(function (k) { return k.name === CHECKLIST_MAT; })[0];
            if (cl) materiale[cd.id] = cl;
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
  t.set('board', 'private', 'listaTimeline', listaSel);
  disegna();
});

window.addEventListener('resize', function () { if (carte.length) disegna(); });

t.render(function () {
  return Promise.all([
    t.cards('id', 'name', 'start', 'due', 'dueComplete', 'idList', 'badges'),
    t.lists('id', 'name'),
    t.get('board', 'private', 'listaTimeline', null)
  ]).then(function (r) {
    carte = r[0]; liste = r[1];
    var salvata = liste.some(function (l) { return l.id === r[2]; }) ? r[2] : null;
    var prod = liste.filter(function (l) { return /IN PRODUZIONE/i.test(l.name); })[0];
    listaSel = salvata || (prod ? prod.id : (liste[0] && liste[0].id));
    document.getElementById('lista').innerHTML = liste.map(function (l) {
      return '<option value="' + l.id + '"' + (l.id === listaSel ? ' selected' : '') + '>' + esc(l.name) + '</option>';
    }).join('');
    return caricaMateriale();
  }).then(function () { disegna(); });
});

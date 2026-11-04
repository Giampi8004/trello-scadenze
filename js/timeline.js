/* Timeline commesse: asse centrale = oggi */
var t = TrelloPowerUp.iframe();
var carte = [], liste = [], listaSel = null;
var BOX_W = 180, BOX_H = 58, GAP = 8, TOP = 30;

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

function disegna() {
  var area = document.getElementById('area');
  var wrap = document.getElementById('wrap');
  var sel = carte.filter(function (c) { return c.idList === listaSel; });
  var conData = sel.filter(function (c) { return c.due; })
    .map(function (c) { c.g = giorniMancanti(c.due); return c; })
    .sort(function (a, b) { return a.g - b.g; });
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
  function xDi(g) { return x0 + g * pxG; }

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
    var ck = b.checkItems ? ' · ☑ ' + b.checkItemsChecked + '/' + b.checkItems : '';
    html += '<div class="pin ' + col + '" style="left:' + xDi(c.g) + 'px;top:' + (TOP - 6) + 'px;height:' + (top - TOP + 6) + 'px"></div>';
    html += '<div class="box ' + col + '" data-id="' + c.id + '" title="' + esc(c.name) + '" style="left:' + c.left + 'px;top:' + top + 'px">' +
      '<b>' + esc(c.name) + '</b>' + formattaData(c.due) + '<br>' +
      '<strong>' + etichetta(c.g, c.dueComplete) + '</strong><span class="ck">' + ck + '</span></div>';
  });

  area.style.width = W + 'px';
  area.style.height = H + 'px';
  area.innerHTML = html;
  wrap.scrollLeft = x0 - wrap.clientWidth / 2;
}

document.body.addEventListener('click', function (e) {
  var el = e.target.closest('[data-id]');
  if (el) t.showCard(el.getAttribute('data-id'));
});

document.getElementById('lista').addEventListener('change', function () {
  listaSel = this.value;
  t.set('board', 'private', 'listaTimeline', listaSel);
  disegna();
});

window.addEventListener('resize', function () { if (carte.length) disegna(); });

t.render(function () {
  return Promise.all([
    t.cards('id', 'name', 'due', 'dueComplete', 'idList', 'badges'),
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
    disegna();
  });
});

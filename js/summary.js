/* Riepilogo scadenze */
var t = TrelloPowerUp.iframe();
var dati = [];
var filtro = 'aperte';

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function checklist(d) {
  if (!d.ckTot) return '<span class="ck">—</span>';
  var pct = Math.round(d.ckFatti / d.ckTot * 100);
  return '<span class="ck">' + d.ckFatti + '/' + d.ckTot +
    '<span class="bar"><i style="width:' + pct + '%"></i></span></span>';
}

function impostaFiltro(f) {
  filtro = f;
  Array.prototype.forEach.call(document.querySelectorAll('#filtri button'), function (x) {
    x.classList.toggle('attivo', x.getAttribute('data-f') === f);
  });
  disegna();
}

function disegna() {
  var conta = { scaduta: 0, urgente: 0, vicina: 0, ok: 0, senzadata: 0 };
  dati.forEach(function (d) { if (conta[d.s.stato] !== undefined) conta[d.s.stato]++; });
  var box = [['scaduta', 'Scadute'], ['urgente', 'Urgenti'], ['vicina', 'In arrivo'], ['ok', 'Nei tempi'], ['senzadata', 'Senza data']];
  document.getElementById('stats').innerHTML = box.map(function (b) {
    var f = (b[0] === 'vicina' || b[0] === 'ok') ? 'aperte' : b[0];
    return '<div class="stat" data-f="' + f + '"><b>' + conta[b[0]] + '</b>' + b[1] + '</div>';
  }).join('');

  var righe = dati.filter(function (d) {
    if (filtro === 'tutte') return true;
    if (filtro === 'aperte') return ['scaduta', 'urgente', 'vicina', 'ok'].indexOf(d.s.stato) !== -1;
    return d.s.stato === filtro;
  });

  var tb = document.getElementById('righe');
  if (!righe.length) {
    tb.innerHTML = '<tr><td colspan="5" class="vuoto">Nessuna scheda in questa vista.</td></tr>';
    return;
  }
  tb.innerHTML = righe.map(function (d) {
    return '<tr class="riga" data-id="' + d.id + '">' +
      '<td>' + esc(d.name) + '</td>' +
      '<td class="lista">' + esc(d.lista) + '</td>' +
      '<td>' + checklist(d) + '</td>' +
      '<td>' + (d.due ? formattaData(d.due) : '—') + '</td>' +
      '<td><span class="pill ' + d.s.colore + '">' + esc(d.s.testo) + '</span></td></tr>';
  }).join('');
}

document.getElementById('righe').addEventListener('click', function (e) {
  var tr = e.target.closest('tr.riga');
  if (tr) t.showCard(tr.getAttribute('data-id'));
});
document.getElementById('filtri').addEventListener('click', function (e) {
  var b = e.target.closest('button');
  if (b) impostaFiltro(b.getAttribute('data-f'));
});
document.getElementById('stats').addEventListener('click', function (e) {
  var s = e.target.closest('.stat');
  if (s) impostaFiltro(s.getAttribute('data-f'));
});

t.render(function () {
  return Promise.all([
    t.cards('id', 'name', 'due', 'dueComplete', 'idList', 'badges'),
    t.lists('id', 'name'),
    leggiSoglie(t),
    leggiListeEscluse(t)
  ]).then(function (r) {
    var liste = {};
    r[1].forEach(function (l) { liste[l.id] = l; });
    var soglie = r[2], escluse = r[3];

    dati = r[0]
      .filter(function (c) { return liste[c.idList]; })        // solo liste aperte
      .map(function (c) {
        var lista = liste[c.idList], s;
        if (listaEsclusa(lista, escluse)) s = { testo: 'Lista finale', colore: 'grey', stato: 'chiusa' };
        else if (!c.due) s = { testo: 'Senza data', colore: 'grey', stato: 'senzadata' };
        else s = statoScadenza(c.due, c.dueComplete, soglie);
        var b = c.badges || {};
        return { id: c.id, name: c.name, due: c.due, lista: lista.name, s: s,
                 ckTot: b.checkItems || 0, ckFatti: b.checkItemsChecked || 0 };
      })
      .sort(function (a, b) {
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return new Date(a.due) - new Date(b.due);
      });
    disegna();
  });
});

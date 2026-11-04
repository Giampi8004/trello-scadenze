/* global TrelloPowerUp, leggiSoglie, leggiListeEscluse, listaEsclusa, statoScadenza, formattaData, ICON_URL */

function badgeScadenza(t, dettaglio) {
  return Promise.all([
    t.card('due', 'dueComplete'),
    t.list('id', 'name'),
    leggiSoglie(t),
    leggiListeEscluse(t)
  ]).then(function (r) {
    var card = r[0], lista = r[1], soglie = r[2], escluse = r[3];
    if (listaEsclusa(lista, escluse)) return [];   // es. TERMINATI: nessun badge
    var s = statoScadenza(card.due, card.dueComplete, soglie);
    if (!s) return [];
    var badge = { text: s.testo, color: s.colore };
    if (dettaglio) {
      badge.title = 'Scadenza';
      badge.text = s.testo + ' · ' + formattaData(card.due);
    } else {
      badge.icon = ICON_URL;
    }
    return [badge];
  });
}

TrelloPowerUp.initialize({
  // Badge sul fronte della scheda (si aggiorna ogni ora)
  'card-badges': function (t) {
    return [{
      dynamic: function () {
        return badgeScadenza(t, false).then(function (b) {
          return b[0] ? Object.assign({ refresh: 3600 }, b[0]) : { text: '' };
        });
      }
    }];
  },

  // Badge dentro la scheda aperta
  'card-detail-badges': function (t) {
    return badgeScadenza(t, true);
  },

  // Pulsante in alto sulla bacheca → riepilogo scadenze
  'board-buttons': function () {
    return [{
      icon: { dark: ICON_URL, light: ICON_URL },
      text: 'Scadenze',
      callback: function (t) {
        return t.modal({
          title: 'Riepilogo scadenze',
          url: './summary.html',
          fullscreen: false,
          height: 640
        });
      }
    }, {
      icon: { dark: ICON_URL, light: ICON_URL },
      text: 'Deadline',
      callback: function (t) {
        return t.modal({
          title: 'Deadline',
          url: './timeline.html',
          fullscreen: true
        });
      }
    }];
  },

  // Ingranaggio "Impostazioni" del Power-Up
  'show-settings': function (t) {
    return t.popup({
      title: 'Impostazioni scadenze',
      url: './settings.html',
      height: 480
    });
  }
}, {
  appKey: 'f5089339fa1b492c9a45601594a6982c',
  appName: 'Scadenze'
});

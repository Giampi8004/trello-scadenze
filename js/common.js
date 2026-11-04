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

/* Restituisce { testo, colore, giorni, stato } oppure null se nessuna scadenza */
function statoScadenza(due, dueComplete, soglie) {
  if (!due) return null;
  if (dueComplete) return { testo: 'Completata', colore: 'green', giorni: null, stato: 'completata' };
  var g = giorniMancanti(due);
  var testo, colore, stato;
  if (g < 0) { testo = 'Scaduta da ' + (-g) + ' g'; colore = 'red'; stato = 'scaduta'; }
  else if (g === 0) { testo = 'Scade oggi'; colore = 'red'; stato = 'urgente'; }
  else if (g === 1) { testo = 'Domani'; colore = g <= soglie.rosso ? 'red' : 'yellow'; stato = colore === 'red' ? 'urgente' : 'vicina'; }
  else {
    testo = g + ' giorni';
    if (g <= soglie.rosso) { colore = 'red'; stato = 'urgente'; }
    else if (g <= soglie.giallo) { colore = 'yellow'; stato = 'vicina'; }
    else { colore = 'green'; stato = 'ok'; }
  }
  return { testo: testo, colore: colore, giorni: g, stato: stato };
}

function formattaData(due) {
  return new Date(due).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

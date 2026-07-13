import GLib from 'gi://GLib';
import System from 'system';
import * as S from '../static/js/solver.js';

const [selfPath] = GLib.filename_from_uri(import.meta.url);
const here = GLib.path_get_dirname(selfPath);
const read = p => JSON.parse(new TextDecoder().decode(GLib.file_get_contents(here + '/../' + p)[1]));

const V = read('static/data/test-vectors.json');
const ANSWERS = read('static/data/answers.json');
const EXTENDED = read('static/data/extended.json');
const answerSet = new Set(ANSWERS);

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let pass = 0;
const fails = [];

for (const v of V.feedback) {
  const enc = [...v.guess].map((c, i) => c + S.feedback(v.answer, v.guess)[i]).join('');
  eq(enc, v.enc) ? pass++ : fails.push(`feedback ${v.answer}/${v.guess}: ${enc} != ${v.enc}`);
}

for (const [gi, g] of V.games.entries()) {
  const pool = g.list === 'both' ? ANSWERS.concat(EXTENDED) : ANSWERS;
  const st = S.stateFromRows(g.rows);
  const cands = S.filterWords(pool, st);
  const top = S.rankSuggestions(cands, answerSet).slice(0, 3);
  eq(cands.length, g.count) && eq(cands.slice(0, 10), g.first) && eq(top, g.top)
    ? pass++ : fails.push(`game ${gi}: count ${cands.length}/${g.count} top ${top}/${g.top}`);
}

if (fails.length) {
  for (const f of fails) print(f);
  print(`${fails.length} FAILED (${pass} passed)`);
  System.exit(1);
} else {
  print(`ALL ${pass} PASS`);
  System.exit(0);
}

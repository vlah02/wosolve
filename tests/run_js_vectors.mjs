// Node ESM runner for the JS↔Python solver equivalence vectors.
// Mirrors tests/run_js_vectors.js (gjs) but uses Node's fs/URL so CI needs no gjs.
// Run with: node tests/run_js_vectors.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as S from '../static/js/solver.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = p => JSON.parse(readFileSync(join(here, '..', p), 'utf8'));

const V = read('static/data/test-vectors.json');
const ANSWERS = read('static/data/answers.json');
const EXTENDED = read('static/data/extended.json');
const FREQ = read('static/data/freq.json');
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
  const top = S.rankSuggestions(cands, answerSet, FREQ).slice(0, 3);
  eq(cands.length, g.count) && eq(cands.slice(0, 10), g.first) && eq(top, g.top)
    ? pass++ : fails.push(`game ${gi}: count ${cands.length}/${g.count} top ${top}/${g.top}`);
}

if (fails.length) {
  for (const f of fails) console.error(f);
  console.error(`${fails.length} FAILED (${pass} passed)`);
  process.exit(1);
} else {
  console.log(`ALL ${pass} PASS`);
  process.exit(0);
}

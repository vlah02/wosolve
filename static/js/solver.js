export function stateFromRows(rows) {
  const st = { greens: Array(5).fill(null), bannedAt: Array.from({length: 5}, () => new Set()),
               minCounts: {}, maxCounts: {}, excluded: new Set() };
  for (const { word, marks } of rows) {
    const plusStar = {};
    for (let i = 0; i < 5; i++) {
      const l = word[i], m = marks[i];
      if (m === '+') { st.greens[i] = l; plusStar[l] = (plusStar[l] || 0) + 1; }
      else if (m === '*') { st.bannedAt[i].add(l); plusStar[l] = (plusStar[l] || 0) + 1; }
    }
    for (let i = 0; i < 5; i++) {
      const l = word[i];
      if (marks[i] !== '-') continue;
      const p = plusStar[l] || 0;
      if (p === 0) st.excluded.add(l);
      else { st.maxCounts[l] = p; st.bannedAt[i].add(l); }
    }
    for (const [l, p] of Object.entries(plusStar))
      st.minCounts[l] = Math.max(st.minCounts[l] || 0, p);
  }
  return st;
}

function count(word, l) { let n = 0; for (const c of word) if (c === l) n++; return n; }

export function isValid(word, st) {
  for (const l of st.excluded) if (word.includes(l)) return false;
  for (const [l, n] of Object.entries(st.minCounts)) if (count(word, l) < n) return false;
  for (const [l, n] of Object.entries(st.maxCounts)) if (count(word, l) > n) return false;
  for (let i = 0; i < 5; i++) {
    if (st.greens[i] && word[i] !== st.greens[i]) return false;
    if (st.bannedAt[i].has(word[i])) return false;
  }
  return true;
}

export function filterWords(words, st) { return words.filter(w => isValid(w, st)); }

export function feedback(answer, guess) {
  const marks = Array(5).fill(null), remaining = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) marks[i] = '+';
    else remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) {
    if (marks[i]) continue;
    if (remaining[guess[i]] > 0) { marks[i] = '*'; remaining[guess[i]]--; }
    else marks[i] = '-';
  }
  return marks.join('');
}

export function rankSuggestions(candidates, answerSet, freq = {}) {
  if (!candidates.length) return [];
  const letterFreq = {};
  for (const w of candidates) for (const l of new Set(w)) letterFreq[l] = (letterFreq[l] || 0) + 1;
  const coverage = w => { let s = 0; for (const l of new Set(w)) s += letterFreq[l]; return s; };
  const tier = w => freq[w] ?? 30;
  let cmp;
  if (candidates.length > 20) {
    const pos = Array.from({length: 5}, () => ({}));
    for (const w of candidates) for (let i = 0; i < 5; i++) pos[i][w[i]] = (pos[i][w[i]] || 0) + 1;
    const posScore = w => { let s = 0; for (let i = 0; i < 5; i++) s += pos[i][w[i]] || 0; return s; };
    cmp = (a, b) => coverage(b) - coverage(a) || posScore(b) - posScore(a) || tier(a) - tier(b) || (a < b ? -1 : 1);
  } else {
    const inAns = w => answerSet.has(w) ? 0 : 1;
    cmp = (a, b) => inAns(a) - inAns(b) || tier(a) - tier(b) || coverage(b) - coverage(a) || (a < b ? -1 : 1);
  }
  return [...candidates].sort(cmp);
}

export function keyboardHints(rows) {
  const st = stateFromRows(rows), hints = {};
  for (const l of st.excluded) hints[l] = 'excluded';
  for (const l of Object.keys(st.minCounts)) hints[l] = 'yellow';
  for (const l of st.greens) if (l) hints[l] = 'green';
  return hints;
}

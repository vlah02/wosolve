import json, random, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from solver_ref import WordleState, find_valid_words, feedback, rank_suggestions

ANSWERS = json.load(open(ROOT / "static/data/answers.json"))
EXTENDED = json.load(open(ROOT / "static/data/extended.json"))
rng = random.Random(42)

fb = []
for _ in range(200):
    a, g = rng.choice(ANSWERS), rng.choice(ANSWERS)
    fb.append({"answer": a, "guess": g, "enc": feedback(a, g)})
# force duplicate-letter coverage
for a, g in [("medal", "salsa"), ("crest", "geese"), ("melee", "geese"), ("early", "eerie")]:
    fb.append({"answer": a, "guess": g, "enc": feedback(a, g)})

games = []
for trial in range(60):
    answer = rng.choice(ANSWERS)
    use_ext = trial % 3 == 0
    pool = ANSWERS + EXTENDED if use_ext else ANSWERS
    st, rows = WordleState(), []
    for g in rng.sample(ANSWERS, rng.randint(1, 4)):
        enc = feedback(answer, g)
        rows.append({"word": g, "marks": enc[1::2]})
        st.update_state(enc)
    cands = find_valid_words(pool, st)
    ranked = rank_suggestions(cands, set(ANSWERS))
    games.append({"list": "both" if use_ext else "answers", "rows": rows,
                  "count": len(cands), "first": cands[:10], "top": ranked[:3]})

json.dump({"feedback": fb, "games": games},
          open(ROOT / "static/data/test-vectors.json", "w"), separators=(",", ":"))
print(f"{len(fb)} feedback vectors, {len(games)} game vectors")

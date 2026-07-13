import os, sys, random, types, json, zlib, base64

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(PROJECT_ROOT)  # app.py opens the word lists via relative paths

flask_stub = types.ModuleType("flask")
class _FakeApp:
    def __init__(self, *a, **k): self.secret_key = None
    def route(self, *a, **k):
        def deco(f): return f
        return deco
    def run(self, *a, **k): pass
flask_stub.Flask = _FakeApp
flask_stub.request = None
flask_stub.render_template = lambda *a, **k: None
flask_stub.session = {}
flask_stub.redirect = lambda x: x
flask_stub.url_for = lambda x: x
sys.modules["flask"] = flask_stub

sys.path.insert(0, PROJECT_ROOT)
from app import (WordleState, find_valid_words, state_to_dict, state_from_dict,
                 suggest_word, ANSWER_WORDS, EXTENDED_WORDS)
from solver_ref import feedback

def wordle_feedback(answer, guess):
    return feedback(answer, guess)

ok = True

# 1: soundness — the true answer must never be filtered out (incl. state round-trip
# through the session dict, as the app does between requests)
random.seed(42)
fails = 0
for trial in range(3000):
    answer = random.choice(ANSWER_WORDS)
    state = WordleState()
    for g in random.sample(ANSWER_WORDS, 4):
        state.update_state(wordle_feedback(answer, g))
        state = state_from_dict(state_to_dict(state))
        if not state.is_valid_word(answer):
            fails += 1
            print(f"SOUNDNESS FAIL: answer={answer} guess={g}")
            break
print(f"1. soundness (3000 games x 4 guesses, with session round-trip): {fails} failures")
ok &= fails == 0

# 2: gray-duplicate position exclusion now enforced
state = WordleState()
state.update_state(wordle_feedback("medal", "salsa"))
bad = [w for w in find_valid_words(ANSWER_WORDS, state) if w[4] == 'a']
print(f"2. medal/salsa impossible suggestions (was 4): {len(bad)} {bad}")
ok &= len(bad) == 0

random.seed(7)
leak_games = 0
checked = 0
for trial in range(500):
    answer = random.choice(ANSWER_WORDS)
    guess = random.choice([w for w in ANSWER_WORDS if len(set(w)) < 5])
    enc = wordle_feedback(answer, guess)
    marks = [(enc[i], enc[i+1], i//2) for i in range(0, 10, 2)]
    plus_star = {l for l, s, _ in marks if s in '+*'}
    graypos = [(l, p) for l, s, p in marks if s == '-' and l in plus_star]
    if not graypos:
        continue
    checked += 1
    st = WordleState()
    st.update_state(enc)
    if any(any(w[p] == l for l, p in graypos) for w in find_valid_words(ANSWER_WORDS, st)):
        leak_games += 1
print(f"2b. dup-letter sweep (was 80/163 leaking): {leak_games}/{checked} games leak")
ok &= leak_games == 0

# 3: triple-letter cases still behave
st = WordleState(); st.update_state(wordle_feedback("crest", "geese"))
t3a = st.is_valid_word("crest") and not [w for w in find_valid_words(ANSWER_WORDS, st) if w.count('e') > 1]
st = WordleState(); st.update_state(wordle_feedback("melee", "geese"))
t3b = st.is_valid_word("melee")
print(f"3. triple-letter (crest/geese, melee/geese): {'ok' if t3a and t3b else 'FAIL'}")
ok &= t3a and t3b

# 4: session cookie stays small — new session stores only state + history
worst = 0
random.seed(1)
for trial in range(200):
    answer = random.choice(ANSWER_WORDS)
    st = WordleState()
    history = []
    for g in random.sample(ANSWER_WORDS, 6):
        enc = wordle_feedback(answer, g)
        st.update_state(enc)
        history.append(enc)
        payload = {"state": state_to_dict(st), "history": history, "include_extended": True}
        raw = json.dumps(payload, separators=(',', ':')).encode()
        size = len(base64.urlsafe_b64encode(zlib.compress(raw))) + 50
        worst = max(worst, size)
print(f"4. worst cookie over 200 games x 6 guesses (limit 4093): ~{worst} bytes")
ok &= worst < 4093

# 5: suggest_word sanity
op = suggest_word(ANSWER_WORDS)
st = WordleState(); st.update_state(wordle_feedback("medal", "salsa"))
cands = find_valid_words(ANSWER_WORDS + EXTENDED_WORDS, st)
mid = suggest_word(cands)
print(f"5. suggested opener: {op}; after medal/salsa: {mid} (in candidates: {mid in cands}); empty -> {suggest_word([])}")
ok &= op is not None and mid in cands and suggest_word([]) is None

# Test functions from Task 1 brief
def test_feedback_duplicates():
    from solver_ref import feedback
    assert feedback("medal", "salsa") == "s-a*l*s-a-"
    assert feedback("crest", "geese") == "g-e-e+s+e-"
    assert feedback("melee", "geese") == "g-e+e*s-e+"

def test_rank_suggestions_information_phase():
    from solver_ref import rank_suggestions
    # >20 candidates: distinct-letter coverage wins; repeated-letter words rank lower
    cands = ["slate", "crane", "eerie", "geese"] + [f"{c}{c}{c}{c}{c}" for c in "abdefghijklmnopqrst"]
    ranked = rank_suggestions(cands, set(cands))
    assert ranked[0] in ("slate", "crane")          # 5 distinct common letters
    assert ranked.index("eerie") > ranked.index("slate")

def test_rank_suggestions_likelihood_phase():
    from solver_ref import rank_suggestions
    # <=20 candidates: answer-list words rank above non-answers
    cands = ["aback", "zonal", "aahed"]
    ranked = rank_suggestions(cands, {"aback", "zonal"})
    assert set(ranked[:2]) == {"aback", "zonal"}
    assert ranked[2] == "aahed"

def test_rank_deterministic():
    from solver_ref import rank_suggestions
    cands = ["medal", "decal"]
    assert rank_suggestions(cands, set(cands)) == rank_suggestions(list(reversed(cands)), set(cands))

# Run new tests
try:
    test_feedback_duplicates()
    print("6. test_feedback_duplicates: PASS")
    ok &= True
except AssertionError as e:
    print(f"6. test_feedback_duplicates: FAIL - {e}")
    ok = False

try:
    test_rank_suggestions_information_phase()
    print("7. test_rank_suggestions_information_phase: PASS")
    ok &= True
except AssertionError as e:
    print(f"7. test_rank_suggestions_information_phase: FAIL - {e}")
    ok = False

try:
    test_rank_suggestions_likelihood_phase()
    print("8. test_rank_suggestions_likelihood_phase: PASS")
    ok &= True
except AssertionError as e:
    print(f"8. test_rank_suggestions_likelihood_phase: FAIL - {e}")
    ok = False

try:
    test_rank_deterministic()
    print("9. test_rank_deterministic: PASS")
    ok &= True
except AssertionError as e:
    print(f"9. test_rank_deterministic: FAIL - {e}")
    ok = False

print("\nALL PASS" if ok else "\nFAILURES PRESENT")
sys.exit(0 if ok else 1)

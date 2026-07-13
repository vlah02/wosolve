import os, sys, random, subprocess, pathlib

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(PROJECT_ROOT)  # solver_ref.py opens the word lists via relative paths

sys.path.insert(0, PROJECT_ROOT)
from solver_ref import (WordleState, find_valid_words, feedback, rank_suggestions,
                         suggest_word, ANSWER_WORDS, EXTENDED_WORDS)

ok = True

# 1: soundness — the true answer must never be filtered out
random.seed(42)
fails = 0
for trial in range(3000):
    answer = random.choice(ANSWER_WORDS)
    state = WordleState()
    for g in random.sample(ANSWER_WORDS, 4):
        state.update_state(feedback(answer, g))
        if not state.is_valid_word(answer):
            fails += 1
            print(f"SOUNDNESS FAIL: answer={answer} guess={g}")
            break
print(f"1. soundness (3000 games x 4 guesses): {fails} failures")
ok &= fails == 0

# 2: gray-duplicate position exclusion now enforced
state = WordleState()
state.update_state(feedback("medal", "salsa"))
bad = [w for w in find_valid_words(ANSWER_WORDS, state) if w[4] == 'a']
print(f"2. medal/salsa impossible suggestions (was 4): {len(bad)} {bad}")
ok &= len(bad) == 0

random.seed(7)
leak_games = 0
checked = 0
for trial in range(500):
    answer = random.choice(ANSWER_WORDS)
    guess = random.choice([w for w in ANSWER_WORDS if len(set(w)) < 5])
    enc = feedback(answer, guess)
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
st = WordleState(); st.update_state(feedback("crest", "geese"))
t3a = st.is_valid_word("crest") and not [w for w in find_valid_words(ANSWER_WORDS, st) if w.count('e') > 1]
st = WordleState(); st.update_state(feedback("melee", "geese"))
t3b = st.is_valid_word("melee")
print(f"3. triple-letter (crest/geese, melee/geese): {'ok' if t3a and t3b else 'FAIL'}")
ok &= t3a and t3b

# 4: suggest_word sanity
op = suggest_word(ANSWER_WORDS)
st = WordleState(); st.update_state(feedback("medal", "salsa"))
cands = find_valid_words(ANSWER_WORDS + EXTENDED_WORDS, st)
mid = suggest_word(cands)
print(f"4. suggested opener: {op}; after medal/salsa: {mid} (in candidates: {mid in cands}); empty -> {suggest_word([])}")
ok &= op is not None and mid in cands and suggest_word([]) is None

# Test functions from Task 1 brief
def test_feedback_duplicates():
    assert feedback("medal", "salsa") == "s-a*l*s-a-"
    assert feedback("crest", "geese") == "g-e-e+s+e-"
    assert feedback("melee", "geese") == "g-e+e*s-e+"

def test_rank_suggestions_information_phase():
    # >20 candidates: distinct-letter coverage wins; repeated-letter words rank lower
    cands = ["slate", "crane", "eerie", "geese"] + [f"{c}{c}{c}{c}{c}" for c in "abdefghijklmnopqrst"]
    ranked = rank_suggestions(cands, set(cands))
    assert ranked[0] in ("slate", "crane")          # 5 distinct common letters
    assert ranked.index("eerie") > ranked.index("slate")

def test_rank_suggestions_likelihood_phase():
    # <=20 candidates: answer-list words rank above non-answers
    cands = ["aback", "zonal", "aahed"]
    ranked = rank_suggestions(cands, {"aback", "zonal"})
    assert set(ranked[:2]) == {"aback", "zonal"}
    assert ranked[2] == "aahed"

def test_rank_suggestions_freq_tiebreak_info_phase():
    # >20 candidates, two words with identical coverage/positional score (a word
    # and its letter-disjoint-from-fillers reverse): the commoner (lower tier)
    # word must win, even when that contradicts plain alphabetical order.
    common, rare = "edcba", "abcde"          # alphabetically "abcde" < "edcba"
    letters = "fghijklmnopqrstuvwxyz"
    fillers = [(letters + letters)[i:i + 5] for i in range(19)]
    cands = [common, rare] + fillers
    assert len(cands) > 20
    freq = {common: 3, rare: 27}              # common has the lower (rarer-tier-number = commoner) tier
    ranked = rank_suggestions(cands, set(cands), freq)
    assert ranked.index(common) < ranked.index(rare)

def test_rank_suggestions_freq_tiebreak_likelihood_phase():
    # <=20 candidates, both in the answer set: tier must decide before coverage
    # and before alphabetical order.
    cands = ["medal", "decal"]                # alphabetically "decal" < "medal"
    freq = {"medal": 3, "decal": 20}
    ranked = rank_suggestions(cands, set(cands), freq)
    assert ranked[0] == "medal"

def test_rank_suggestions_freq_absent_word_gets_tier_30():
    cands = ["medal", "decal"]
    freq = {"decal": 5}                       # "medal" absent -> tier 30, loses to tier 5
    ranked = rank_suggestions(cands, set(cands), freq)
    assert ranked[0] == "decal"

def test_rank_suggestions_freq_none_matches_empty():
    cands = ["aback", "zonal", "aahed"]
    ans = {"aback", "zonal"}
    assert rank_suggestions(cands, ans) == rank_suggestions(cands, ans, None) == rank_suggestions(cands, ans, {})

def test_rank_deterministic():
    cands = ["medal", "decal"]
    assert rank_suggestions(cands, set(cands)) == rank_suggestions(list(reversed(cands)), set(cands))

# 5: generated static vectors must be reproducible from the current solver_ref.py
def test_generated_files_fresh():
    ROOT = pathlib.Path(PROJECT_ROOT)
    vectors_path = ROOT / "static/data/test-vectors.json"
    before = vectors_path.read_bytes()
    try:
        subprocess.run([sys.executable, str(ROOT / "scripts/gen_test_vectors.py")], check=True)
        after = vectors_path.read_bytes()
    finally:
        vectors_path.write_bytes(before)
    assert after == before, \
        "vectors changed - solver_ref.py was modified; regenerate vectors and re-verify static/tests.html"

named_tests = [
    ("test_feedback_duplicates", test_feedback_duplicates),
    ("test_rank_suggestions_information_phase", test_rank_suggestions_information_phase),
    ("test_rank_suggestions_likelihood_phase", test_rank_suggestions_likelihood_phase),
    ("test_rank_suggestions_freq_tiebreak_info_phase", test_rank_suggestions_freq_tiebreak_info_phase),
    ("test_rank_suggestions_freq_tiebreak_likelihood_phase", test_rank_suggestions_freq_tiebreak_likelihood_phase),
    ("test_rank_suggestions_freq_absent_word_gets_tier_30", test_rank_suggestions_freq_absent_word_gets_tier_30),
    ("test_rank_suggestions_freq_none_matches_empty", test_rank_suggestions_freq_none_matches_empty),
    ("test_rank_deterministic", test_rank_deterministic),
    ("test_generated_files_fresh", test_generated_files_fresh),
]

n = 5
for name, fn in named_tests:
    n += 1
    try:
        fn()
        print(f"{n}. {name}: PASS")
    except AssertionError as e:
        print(f"{n}. {name}: FAIL - {e}")
        ok = False

print("\nALL PASS" if ok else "\nFAILURES PRESENT")
sys.exit(0 if ok else 1)

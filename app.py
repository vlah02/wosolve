from flask import Flask, request, render_template, session, redirect, url_for
import os
import re
import secrets

app = Flask(__name__)
# Without SECRET_KEY set, sessions reset on every server restart.
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)


def load_words(path):
    with open(path) as f:
        return [w.strip() for w in f if len(w.strip()) == 5]


ANSWER_WORDS = load_words("words/wordle-ta.txt")
EXTENDED_WORDS = load_words("words/wordle-la.txt")


class WordleState:
    def __init__(self):
        self.green_chars    = [' '] * 5
        self.yellow_chars   = [set() for _ in range(5)]
        self.letter_counts  = {}
        self.max_counts     = {}
        self.excluded_chars = set()

    def update_state(self, guess):
        marks = [(guess[i], guess[i + 1], i // 2) for i in range(0, len(guess), 2)]

        plus_and_star_counts = {}
        for letter, symbol, pos in marks:
            if symbol == '+':
                self.green_chars[pos] = letter
                plus_and_star_counts[letter] = plus_and_star_counts.get(letter, 0) + 1
            elif symbol == '*':
                self.yellow_chars[pos].add(letter)
                plus_and_star_counts[letter] = plus_and_star_counts.get(letter, 0) + 1

        for letter, symbol, pos in marks:
            if symbol != '-':
                continue
            pcount = plus_and_star_counts.get(letter, 0)
            if pcount == 0:
                self.excluded_chars.add(letter)
            else:
                # A gray copy of a letter that is green/yellow elsewhere in the
                # same guess: the answer has exactly pcount of it, and none here.
                self.max_counts[letter] = pcount
                self.yellow_chars[pos].add(letter)

        for letter, pcount in plus_and_star_counts.items():
            self.letter_counts[letter] = max(self.letter_counts.get(letter, 0), pcount)

    def is_valid_word(self, word):
        if any(l in word for l in self.excluded_chars):
            return False

        for letter, minc in self.letter_counts.items():
            if word.count(letter) < minc:
                return False

        for letter, maxc in self.max_counts.items():
            if word.count(letter) > maxc:
                return False

        for i, must in enumerate(self.green_chars):
            if must != ' ' and word[i] != must:
                return False

        for i, badset in enumerate(self.yellow_chars):
            if word[i] in badset:
                return False

        return True


def find_valid_words(word_list, state):
    return [w for w in word_list if state.is_valid_word(w)]


def suggest_word(candidates):
    """Pick the candidate covering the most common letters among all candidates."""
    if not candidates:
        return None
    freq = {}
    for w in candidates:
        for l in set(w):
            freq[l] = freq.get(l, 0) + 1
    return max(candidates, key=lambda w: sum(freq[l] for l in set(w)))


def state_to_dict(st):
    return {
        "green_chars":    st.green_chars,
        "yellow_chars":   [list(s) for s in st.yellow_chars],
        "letter_counts":  st.letter_counts,
        "max_counts":     st.max_counts,
        "excluded_chars": list(st.excluded_chars),
    }


def state_from_dict(d):
    st = WordleState()
    st.green_chars    = d.get("green_chars", st.green_chars)
    st.yellow_chars   = [set(lst) for lst in d.get("yellow_chars", [[], [], [], [], []])]
    st.letter_counts  = d.get("letter_counts", {})
    st.max_counts     = d.get("max_counts", {})
    st.excluded_chars = set(d.get("excluded_chars", []))
    return st


@app.route('/', methods=['GET', 'POST'])
def index():
    if request.method == 'POST':
        session['include_extended'] = request.form.get('includeExtended') == 'on'

        guess = request.form.get('guess', '')
        if re.fullmatch(r"([a-z][+\-*]){5}", guess):
            state = state_from_dict(session.get('state', {}))
            state.update_state(guess)
            session['state'] = state_to_dict(state)
            session['history'] = session.get('history', []) + [guess]
        return redirect(url_for('index'))

    include_ext = session.get('include_extended', False)
    word_list = ANSWER_WORDS + EXTENDED_WORDS if include_ext else ANSWER_WORDS

    history = session.get('history', [])
    if history:
        state = state_from_dict(session.get('state', {}))
        suggestions = find_valid_words(word_list, state)
        suggested = suggest_word(suggestions)
    else:
        suggestions = []
        suggested = suggest_word(ANSWER_WORDS)

    return render_template(
        'index.html',
        words=            suggestions,
        history=          history,
        suggested_word=   suggested,
        include_extended= include_ext
    )


@app.route('/reset')
def reset():
    for key in ('state', 'history', 'include_extended', 'words', 'random_word'):
        session.pop(key, None)
    return redirect(url_for('index'))


if __name__ == '__main__':
    app.run(debug=True)

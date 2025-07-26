from flask import Flask, request, render_template, session, redirect, url_for
import random
import re

app = Flask(__name__)
app.secret_key = 'poop'


class WordleState:
    def __init__(self):
        self.available_chars = "abcdefghijklmnopqrstuvwxyz"
        self.green_chars    = [' '] * 5
        self.yellow_chars   = [set() for _ in range(5)]
        self.required_chars = set()
        self.letter_counts  = {}   
        self.max_counts     = {}   
        self.excluded_chars = set()

    def update_state(self, guess):
        minus_counts = {}
        plus_and_star_counts = {}

        for i in range(0, len(guess), 2):
            letter = guess[i]
            symbol = guess[i+1]
            pos    = i // 2

            if symbol == '+':
                self.green_chars[pos] = letter
                plus_and_star_counts[letter] = plus_and_star_counts.get(letter, 0) + 1
            elif symbol == '*':
                self.yellow_chars[pos].add(letter)
                self.required_chars.add(letter)
                plus_and_star_counts[letter] = plus_and_star_counts.get(letter, 0) + 1
            elif symbol == '-':
                minus_counts[letter] = minus_counts.get(letter, 0) + 1

        
        for letter, mcount in minus_counts.items():
            pcount = plus_and_star_counts.get(letter, 0)
            if pcount == 0:
                self.available_chars = self.available_chars.replace(letter, '')
                self.excluded_chars.add(letter)
            else:
                self.max_counts[letter] = pcount

        
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
    return [w for w in word_list if len(w) == 5 and state.is_valid_word(w)]


def state_to_dict(st):
    return {
        "available_chars": st.available_chars,
        "green_chars":     st.green_chars,
        "yellow_chars":    [list(s) for s in st.yellow_chars],
        "required_chars":  list(st.required_chars),
        "letter_counts":   st.letter_counts,
        "max_counts":      st.max_counts,
        "excluded_chars":  list(st.excluded_chars),
    }


def state_from_dict(d):
    st = WordleState()
    st.available_chars = d.get("available_chars", st.available_chars)
    st.green_chars     = d.get("green_chars", st.green_chars)
    st.yellow_chars    = [set(lst) for lst in d.get("yellow_chars", [[]]*5)]
    st.required_chars  = set(d.get("required_chars", []))
    st.letter_counts   = d.get("letter_counts", {})
    st.max_counts      = d.get("max_counts", {})
    st.excluded_chars  = set(d.get("excluded_chars", []))
    return st


@app.route('/', methods=['GET', 'POST'])
def index():
    if request.method == 'POST':
        ext = request.form.get('includeExtended') == 'on'
        session['include_extended'] = ext
    include_ext = session.get('include_extended', False)

    word_list = []
    if include_ext:
        with open("words/wordle-la.txt") as f:
            word_list += [w.strip() for w in f]
    with open("words/wordle-ta.txt") as f:
        word_list += [w.strip() for w in f]

    if 'state' not in session:
        state = WordleState()
    else:
        state = state_from_dict(session['state'])

    if 'random_word' not in session:
        session['random_word'] = random.choice(word_list)

    if request.method == 'POST':
        guess = request.form.get('guess', '')
        if re.fullmatch(r"([a-z][+\-*]){5}", guess):
            state.update_state(guess)
            valid = find_valid_words(word_list, state)

            session['words'] = valid

            history = session.get('history', [])
            history.append(guess)
            session['history'] = history

            if valid:
                session['random_word'] = random.choice(valid)
        else:
            session['words'] = []

        session['state'] = state_to_dict(state)
        return redirect(url_for('index'))

    suggestions = session.get('words', [])
    history     = session.get('history', [])
    random_word = session.get('random_word')

    return render_template(
        'index.html',
        words=              suggestions,
        history=            history,
        random_word=        random_word,
        include_extended=   include_ext
    )


@app.route('/reset')
def reset():
    for key in ('state', 'random_word', 'include_extended', 'words', 'history'):
        session.pop(key, None)
    return redirect(url_for('index'))


if __name__ == '__main__':
    app.run(debug=True)

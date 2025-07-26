from flask import Flask, request, render_template, session, redirect, url_for
import random
import re

app = Flask(__name__)
app.secret_key = 'poop'


class WordleState:
    def __init__(self):
        self.available_chars = "abcdefghijklmnopqrstuvwxyz"
        self.green_chars = [' '] * 5
        self.yellow_chars = [set() for _ in range(5)]
        self.required_chars = set()
        self.letter_counts = {}
        self.max_counts = {}
        self.excluded_chars = set()

    def update_state(self, guess):
        minus_counts = {}
        plus_and_star_counts = {}

        for i in range(0, len(guess), 2):
            letter = guess[i]
            symbol = guess[i + 1]
            pos = i // 2

            if symbol == '+':
                self.green_chars[pos] = letter
                plus_and_star_counts[letter] = plus_and_star_counts.get(letter, 0) + 1
            elif symbol == '*':
                self.yellow_chars[pos].add(letter)
                self.required_chars.add(letter)
                plus_and_star_counts[letter] = plus_and_star_counts.get(letter, 0) + 1
            elif symbol == '-':
                minus_counts[letter] = minus_counts.get(letter, 0) + 1

        for letter, count in minus_counts.items():
            got_count = plus_and_star_counts.get(letter, 0)
            if got_count == 0:
                self.available_chars = self.available_chars.replace(letter, '')
                self.excluded_chars.add(letter)
            else:
                self.max_counts[letter] = got_count

        for letter, count in plus_and_star_counts.items():
            self.letter_counts[letter] = max(self.letter_counts.get(letter, 0), count)

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


def state_to_dict(s):
    return {
        "available_chars": s.available_chars,
        "green_chars": s.green_chars,
        "yellow_chars": [list(x) for x in s.yellow_chars],
        "required_chars": list(s.required_chars),
        "letter_counts": s.letter_counts,
        "max_counts": s.max_counts,
        "excluded_chars": list(s.excluded_chars),
    }


def state_from_dict(d):
    s = WordleState()
    s.available_chars = d["available_chars"]
    s.green_chars = d["green_chars"]
    s.yellow_chars = [set(x) for x in d["yellow_chars"]]
    s.required_chars = set(d["required_chars"])
    s.letter_counts = d["letter_counts"]
    s.max_counts = d.get("max_counts", {})
    s.excluded_chars = set(d["excluded_chars"])
    return s


@app.route('/', methods=['GET', 'POST'])
def index():
    history = session.get('history', [])

    include_extended = session.get('include_extended', False)
    if request.method == 'POST':
        include_extended = (request.form.get('includeExtended') == 'on')
        session['include_extended'] = include_extended

    word_list = []
    if include_extended:
        with open("words/wordle-la.txt") as f:
            word_list += [w.strip() for w in f]
    with open("words/wordle-ta.txt") as f:
        word_list += [w.strip() for w in f]

    if 'state' not in session:
        state = WordleState()
        session['state'] = state_to_dict(state)
        session['random_word'] = random.choice(word_list)
    else:
        state = state_from_dict(session['state'])

    words = []
    message = ""
    random_word = session.get('random_word')

    if request.method == 'POST':
        guess = request.form.get('guess')
        if guess and re.fullmatch(r"([a-z][+\-*]){5}", guess):
            history.append(guess)
            session['history'] = history

            state.update_state(guess)
            words = find_valid_words(word_list, state)
            if words:
                random_word = random.choice(words)
                session['random_word'] = random_word
        else:
            message = "ERROR: Incorrect format!"

    session['state'] = state_to_dict(state)

    return render_template(
        'index.html',
        words=words,
        message=message,
        random_word=random_word,
        include_extended=include_extended,
        history=history
    )


@app.route('/reset')
def reset():
    for key in ('state', 'random_word', 'include_extended', 'history'):
        session.pop(key, None)
    return redirect(url_for('index'))


if __name__ == '__main__':
    app.run(debug=True)

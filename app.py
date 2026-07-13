from flask import Flask, request, render_template, session, redirect, url_for
import os
import re
import secrets

from solver_ref import (
    WordleState, find_valid_words, suggest_word, load_words,
    ANSWER_WORDS, EXTENDED_WORDS
)

app = Flask(__name__)
# Without SECRET_KEY set, sessions reset on every server restart.
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)


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

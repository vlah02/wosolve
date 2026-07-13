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


def feedback(answer, guess):
    marks = [None] * 5
    remaining = {}
    for i in range(5):
        if guess[i] == answer[i]:
            marks[i] = '+'
        else:
            remaining[answer[i]] = remaining.get(answer[i], 0) + 1
    for i in range(5):
        if marks[i] is None:
            if remaining.get(guess[i], 0) > 0:
                marks[i] = '*'
                remaining[guess[i]] -= 1
            else:
                marks[i] = '-'
    return ''.join(guess[i] + marks[i] for i in range(5))


def rank_suggestions(candidates, answer_set, freq=None):
    if not candidates:
        return []
    if freq is None:
        freq = {}
    letter_freq = {}
    for w in candidates:
        for l in set(w):
            letter_freq[l] = letter_freq.get(l, 0) + 1
    tier = lambda w: freq.get(w, 30)
    if len(candidates) > 20:
        pos = [dict() for _ in range(5)]
        for w in candidates:
            for i, l in enumerate(w):
                pos[i][l] = pos[i].get(l, 0) + 1
        key = lambda w: (-sum(letter_freq[l] for l in set(w)),
                         -sum(pos[i].get(l, 0) for i, l in enumerate(w)),
                         tier(w), w)
    else:
        key = lambda w: (0 if w in answer_set else 1,
                         tier(w),
                         -sum(letter_freq[l] for l in set(w)), w)
    return sorted(candidates, key=key)

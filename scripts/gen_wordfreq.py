"""Generate static/data/freq.json: a {word: tier} map (tier 0 = most common, 29
= rarest of the words we tier) built from Norvig's word-frequency corpus.

Only 5-letter, a-z words that appear in our answers.json + extended.json lists
are considered. Words are ranked by corpus count and split into 30 equal-
population tiers by rank. A word absent from this file is understood by the
solver to be tier 30 (rarer than anything we tiered).

Fails loudly and writes nothing on any error (network, parsing, or otherwise) -
never leaves a partial freq.json behind.
"""
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = "https://norvig.com/ngrams/count_1w.txt"
USER_AGENT = "Mozilla/5.0 (compatible; wosolve-wordfreq-gen/1.0)"
NUM_TIERS = 30
WORD_RE = re.compile(r"^[a-z]{5}$")


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def download_corpus():
    req = urllib.request.Request(URL, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200:
                fail(f"unexpected HTTP status {resp.status} fetching {URL}")
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        fail(f"could not fetch {URL}: {e}")
    except OSError as e:
        fail(f"network error fetching {URL}: {e}")


def load_words(path):
    with open(path) as f:
        return set(json.load(f))


def main():
    our_words = load_words(ROOT / "static/data/answers.json") | \
        load_words(ROOT / "static/data/extended.json")
    if not our_words:
        fail("answers.json / extended.json loaded empty word sets")

    text = download_corpus()

    counts = []  # (count, word), corpus order is already frequency-descending
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) != 2:
            continue
        word, count_s = parts
        if not WORD_RE.match(word):
            continue
        if word not in our_words:
            continue
        try:
            count = int(count_s)
        except ValueError:
            continue
        counts.append((count, word))

    if not counts:
        fail("no matching 5-letter words found in downloaded corpus")

    # Sort by corpus count descending (most common first); ties broken by word
    # for determinism.
    counts.sort(key=lambda c: (-c[0], c[1]))

    n = len(counts)
    freq = {}
    for rank, (_, word) in enumerate(counts):
        tier = rank * NUM_TIERS // n
        freq[word] = min(tier, NUM_TIERS - 1)

    out = {word: freq[word] for word in sorted(freq)}

    out_path = ROOT / "static/data/freq.json"
    out_path.write_text(json.dumps(out, separators=(",", ":")))

    coverage = len(freq) / len(our_words) * 100
    print(f"{len(freq)}/{len(our_words)} words tiered ({coverage:.1f}% coverage)")


if __name__ == "__main__":
    main()

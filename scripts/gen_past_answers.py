"""Generate static/data/past-answers.json: a full Wordle answers-by-date
history, keyed by ISO date, going back to the first NYT Wordle (2021-06-19,
"cigar").

Tries a short list of public sources, in order, until one parses into a
validated dataset. A source is skipped (not fatal) if it does not expose
per-date data at all (e.g. a plain alphabetical archive) or if what it
produces fails validation. If every source fails, exits nonzero with an
explanation and writes nothing - never leaves a partial/stale file behind.

Output shape:
  {"meta": {"through": "YYYY-MM-DD", "source": "<url that supplied the data>"},
   "byDate": {"YYYY-MM-DD": "cigar", ...}}

Note: past Wordle answers are common nouns/adjectives, never proper nouns -
everything is lowercased. Some historical answers may not appear in our
answers.json/extended.json (the NYT has swapped words over time); that's
fine and expected - we do not filter against our own lists, we just report
how many fall outside them.
"""
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "static/data/past-answers.json"
USER_AGENT = "Mozilla/5.0 (compatible; wosolve-pastanswers-gen/1.0)"
EPOCH = date(2021, 6, 19)  # Wordle #0
WORD_RE = re.compile(r"^[a-z]{5}$")
MIN_ENTRIES = 1500
MAX_STALENESS_DAYS = 45

SOURCES = [
    "https://www.rockpapershotgun.com/wordle-past-answers",
    "https://wordfinder.yourdictionary.com/wordle/answers/",
    "https://www.fiveforks.com/wordle/",
]

TAG_RE = re.compile(r"<[^>]+>")
MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
          "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}


def fail(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 200:
            raise RuntimeError(f"unexpected HTTP status {resp.status}")
        return resp.read().decode("utf-8", errors="replace")


def parse_date_number_word_table(html):
    """Parses tables laid out as <tr><td>date</td><td>Wordle number</td>
    <td>answer</td></tr> (one such table is wordfinder.yourdictionary.com's
    archive, paginated across many <table> blocks on one page). The Wordle
    number is used to derive the exact calendar date (EPOCH + number days);
    the page's own month/day text is cross-checked against it as a sanity
    check and any mismatching row is dropped rather than trusted blindly.

    Returns {} if the page doesn't look like this shape at all (so the
    caller treats it as "no dated data here" and moves to the next source).
    """
    rows = re.findall(r"<tr[^>]*>.*?</tr>", html, re.S)
    by_date = {}
    mismatches = 0
    for row in rows:
        if "<th" in row:
            continue
        tds = re.findall(r"<td.*?</td>", row, re.S)
        if len(tds) != 3:
            continue
        date_txt = TAG_RE.sub("\n", tds[0])
        date_lines = [l.strip() for l in date_txt.split("\n")
                      if l.strip() and l.strip().lower() not in ("today", "yesterday")]
        if not date_lines:
            continue
        m = re.match(r"([A-Za-z]{3})\.?\s*0*(\d{1,2})", date_lines[-1])
        if not m or m.group(1).lower() not in MONTHS:
            continue
        num_txt = TAG_RE.sub("", tds[1]).strip()
        if not num_txt.isdigit():
            continue
        num = int(num_txt)
        word_txt = TAG_RE.sub("\n", tds[2])
        word = None
        for tok in reversed([t.strip() for t in word_txt.split("\n") if t.strip()]):
            if re.fullmatch(r"[A-Za-z]+", tok):
                word = tok.lower()
                break
        if not word:
            continue
        d = EPOCH + timedelta(days=num)
        if MONTHS[m.group(1).lower()] != d.month or int(m.group(2)) != d.day:
            mismatches += 1
            continue
        by_date[d.isoformat()] = word
    # If most rows mismatched the epoch math, this page probably isn't
    # actually using the same Wordle-number epoch - don't trust it.
    if by_date and mismatches > len(by_date) * 0.05:
        return {}
    return by_date


PARSERS = {
    "https://www.rockpapershotgun.com/wordle-past-answers": parse_date_number_word_table,
    "https://wordfinder.yourdictionary.com/wordle/answers/": parse_date_number_word_table,
    "https://www.fiveforks.com/wordle/": parse_date_number_word_table,
}


def validate(by_date):
    reasons = []
    if len(by_date) < MIN_ENTRIES:
        reasons.append(f"only {len(by_date)} entries (need >= {MIN_ENTRIES})")
        return reasons  # further checks aren't meaningful on a tiny/empty set
    bad_words = sorted({w for w in by_date.values() if not WORD_RE.match(w or "")})
    if bad_words:
        reasons.append(f"{len(bad_words)} entries aren't 5-letter a-z words, e.g. {bad_words[:5]}")
    bad_dates = []
    for d in by_date:
        try:
            date.fromisoformat(d)
        except ValueError:
            bad_dates.append(d)
    if bad_dates:
        reasons.append(f"{len(bad_dates)} unparseable dates, e.g. {bad_dates[:5]}")
    if by_date.get("2021-06-19") != "cigar":
        reasons.append(f"2021-06-19 entry is {by_date.get('2021-06-19')!r}, expected 'cigar'")
    through = max(by_date)
    try:
        through_date = date.fromisoformat(through)
        if abs((date.today() - through_date).days) > MAX_STALENESS_DAYS:
            reasons.append(f"through-date {through} is more than {MAX_STALENESS_DAYS} "
                            f"days from today ({date.today().isoformat()})")
    except ValueError:
        pass  # already reported above as a bad date
    return reasons


def load_our_words():
    def load(p):
        with open(p) as f:
            return set(json.load(f))
    return load(ROOT / "static/data/answers.json") | load(ROOT / "static/data/extended.json")


def main():
    our_words = load_our_words()
    for url in SOURCES:
        print(f"trying {url} ...")
        try:
            html = fetch(url)
        except (urllib.error.URLError, OSError, RuntimeError) as e:
            print(f"  skip: fetch failed: {e}")
            continue
        parser = PARSERS[url]
        by_date = parser(html)
        if not by_date:
            print("  skip: no per-date answer table found on this page")
            continue
        reasons = validate(by_date)
        if reasons:
            print(f"  skip: validation failed: {'; '.join(reasons)}")
            continue

        through = max(by_date)
        outside = sorted(w for w in by_date.values() if w not in our_words)
        out = {"meta": {"through": through, "source": url},
               "byDate": dict(sorted(by_date.items()))}
        OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
        print(f"wrote {OUT_PATH.relative_to(ROOT)}: {len(by_date)} entries, "
              f"2021-06-19..{through}, source={url}")
        print(f"{len(outside)} answers are outside our combined answers.json/extended.json lists"
              + (f" (e.g. {outside[:10]})" if outside else ""))
        return

    fail("no source produced a valid dated answers dataset; wrote nothing")


if __name__ == "__main__":
    main()

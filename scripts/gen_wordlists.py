import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "data"
OUT.mkdir(parents=True, exist_ok=True)
for src, dst in [("wordle-ta.txt", "answers.json"), ("wordle-la.txt", "extended.json")]:
    words = [w.strip() for w in open(ROOT / "words" / src) if len(w.strip()) == 5]
    json.dump(words, open(OUT / dst, "w"), separators=(",", ":"))
    print(dst, len(words))

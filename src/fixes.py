"""(3.0) Fixes you make to subtitles, remembered: a word it keeps getting wrong ("mine craft") is
written the way you fixed it ("Minecraft") next time, and it listens for the words you typed."""

import difflib
import json
import os
import re
import threading

import settings

FILE = os.path.join(settings.DATA_DIR, "Subtitle fixes.json")
MOST = 300
_lock = threading.Lock()
# Short everyday words are never learned on their own: changing one "a" to "the" once shouldn't
# change every "a" after it.
COMMON = set("""a an the and or but so to of in on at by for with from up out is are was were be been am i you he
she it we they me him her us them my your his its our their this that these those do does did have has had not no
yes oh ok okay yeah uh um like just then than there here what who how why when where which will would can could
should all some any one two""".split())

_word = re.compile(r"[\w'’]+")


def _load():
    try:
        with open(FILE, encoding="utf-8") as f:
            data = json.load(f)
        return {str(k): str(v) for k, v in data.get("fixes", {}).items()}
    except (OSError, ValueError, AttributeError):
        return {}


def _save(fixes):
    os.makedirs(os.path.dirname(FILE), exist_ok=True)
    temp = FILE + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump({"fixes": fixes}, f, ensure_ascii=False, indent=1)
    os.replace(temp, FILE)


def all_fixes():
    with _lock:
        return _load()


def forget():
    with _lock:
        _save({})


def learn(pairs, direct=False):
    """pairs: [(as made, as you fixed it)]. direct: you said "change them all", so it's a fix as it
    is. Returns how many fixes are remembered now."""
    found = {}
    for heard, typed in pairs:
        if direct:
            old, new = " ".join(_word.findall(str(heard)[:100])), " ".join(_word.findall(str(typed)[:100]))
            if old and new and old != new and old.lower() not in COMMON and new.lower() not in COMMON:
                found[old.lower()] = new
            continue
        a, b = _word.findall(str(heard)[:300]), _word.findall(str(typed)[:300])
        matcher = difflib.SequenceMatcher(a=[w.lower() for w in a], b=[w.lower() for w in b], autojunk=False)
        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op == "equal":
                # only the case changed ("minecraft" -> "Minecraft")
                for k in range(i2 - i1):
                    old, new = a[i1 + k], b[j1 + k]
                    if old != new and old.lower() not in COMMON and len(new) >= 3 and j1 + k > 0:  # (not a line's first word)
                        found[old.lower()] = new
                continue
            if op != "replace" or not (1 <= i2 - i1 <= 3 and 1 <= j2 - j1 <= 3):
                continue
            old, new = " ".join(a[i1:i2]), " ".join(b[j1:j2])
            if old.lower() in COMMON or new.lower() in COMMON or len(new) < 3:
                continue
            found[old.lower()] = new
    with _lock:
        fixes = _load()
        if found:
            fixes.update(found)
            fixes = dict(list(fixes.items())[-MOST:])
            _save(fixes)
        return len(fixes)


def apply(cues, fixes=None):
    """The remembered fixes, made in [(start, end, text)]."""
    fixes = all_fixes() if fixes is None else fixes
    if not fixes:
        return cues
    pattern = re.compile(r"(?<![\w'])(" + "|".join(re.escape(k).replace(r"\ ", r"\s+")
                                                     for k in sorted(fixes, key=len, reverse=True)) + r")(?![\w'])", re.I)
    lookup = {re.sub(r"\s+", " ", k): v for k, v in fixes.items()}
    return [(a, b, pattern.sub(lambda m: lookup.get(re.sub(r"\s+", " ", m[1].lower()), m[1]), t), *rest) for a, b, t, *rest in cues]


def words_to_listen_for(typed=""):
    """Names you typed, plus the words from your fixes (so it hears them better)."""
    have = {w.lower() for w in re.split(r"[,\s]+", typed) if w}
    extra = []
    for new in reversed(list(all_fixes().values())):
        for w in new.split():
            if w.lower() not in have and w.lower() not in COMMON:
                have.add(w.lower())
                extra.append(w)
    return ", ".join([typed.strip()] * bool(typed.strip()) + extra[:40])

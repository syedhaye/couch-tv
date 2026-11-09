#!/usr/bin/env python3
"""Fetches the built-in photo library: real photographs from Wikimedia Commons, every one a Commons
"featured picture" under a free licence, saved into the app so they show with no internet and
before the TV's first daily fetch (home.photos, tv-home/web/photos.js).

Reads tv-home/library.json, for example {"collections": ["new-york"], "count": 12}, and writes
tv-home/web/backgrounds/library/: the photos (1920 wide, made by Commons) and library.js, the list
the home reads, with each photo's title, photographer and licence. git ignores that folder; a build
fetches it again (scripts/build-apk.sh runs this when tv-home/library.json is there).

Standard library only. Any failure leaves the library as it was and exits 0, so a build without
internet still works (the home then simply has no built-in library).

Usage, from the repo root:  python3 scripts/fetch-library.py
"""
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tv-home", "web", "backgrounds", "library")
API = "https://commons.wikimedia.org/w/api.php"
UA = "couch-tv-photo-library/1.0 (https://github.com/Seagey/couch-tv)"
FP = 'incategory:"Featured pictures on Wikimedia Commons"'
# the same searches as tv-home/web/photos.js: keep the two in step
COLLECTIONS = {
    # no quoted phrases inside an OR group: Commons' search then finds nothing at all
    "new-york": FP + " (Manhattan OR Brooklyn OR NYC)",
    "landscapes": FP + " (landscape OR mountains OR lake OR valley OR fjord OR glacier)",
    "culture": FP + " (temple OR mosque OR cathedral OR festival OR market OR palace OR old town)",
    "art": FP + " (painting OR mural OR fresco OR museum)",
    "cities": FP + " (skyline OR cityscape OR panorama city OR night city)",
    "nature": FP + " (forest OR waterfall OR coast OR desert OR aurora)",
}


# Commons serves its picture copies from these two hosts (thumb. since 2026); nothing else is kept
HOST = re.compile(r"^https://(upload|thumb)\.wikimedia\.org/")


def too_old(cid, date):
    """Old archive photographs (black and white, 1900s): skipped, except in art. No date: kept."""
    if cid == "art":
        return False
    m = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", strip(date))
    return bool(m) and int(m.group(1)) < 1960


def get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else json.loads(data.decode("utf-8"))


def strip(s):
    s = re.sub(r"<(script|style)\b[\s\S]*?</\1\s*>", " ", str(s or ""), flags=re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def collection(cid):
    q = COLLECTIONS[cid] + " filew:>1800"
    params = {
        "action": "query", "format": "json", "generator": "search", "gsrnamespace": "6", "gsrlimit": "50",
        "gsrsearch": q, "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": "1920",
        "iiextmetadatafilter": "Artist|LicenseShortName|ObjectName|DateTimeOriginal",
    }
    pages = get(API + "?" + urllib.parse.urlencode(params)).get("query", {}).get("pages", {})
    out = []
    # the search's own order (best matches first), so the library is the same on every build until Commons changes
    for p in sorted(pages.values(), key=lambda p: p.get("index", 0)):
        ii = (p.get("imageinfo") or [{}])[0]
        if ii.get("mime") != "image/jpeg" or not ii.get("thumburl") or not ii.get("width") or not ii.get("height"):
            continue
        if not HOST.match(ii["thumburl"]):  # Commons' own picture servers only
            continue
        ratio = ii["width"] / ii["height"]
        if ratio < 1.33 or ratio > 2.2 or ii.get("thumbwidth", 0) < 1600:
            continue
        m = ii.get("extmetadata") or {}
        val = lambda k: (m.get(k) or {}).get("value")
        lic = strip(val("LicenseShortName"))
        if not lic or too_old(cid, val("DateTimeOriginal")):
            continue
        title = strip(val("ObjectName")) or re.sub(r"\.[a-z]+$", "", strip(p.get("title", "")).replace("File:", ""), flags=re.I)
        out.append({"id": "lib%d" % p["pageid"], "src": ii["thumburl"], "coll": cid,
                    "title": title, "by": strip(val("Artist"))[:60], "lic": lic})
    return out


def main():
    try:
        with open(os.path.join(ROOT, "tv-home", "library.json"), encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        print("photo library: no tv-home/library.json, nothing to fetch")
        return 0
    colls = [c for c in cfg.get("collections", ["new-york"]) if c in COLLECTIONS]
    try:
        count = max(1, min(30, int(cfg.get("count", 12))))
    except (TypeError, ValueError):
        count = 12
    try:
        lists = [collection(c) for c in colls]
    except Exception as e:  # no internet, Commons not answering
        print("photo library: Commons did not answer (%s), keeping what was there" % e)
        return 0
    picked, seen = [], set()
    while len(picked) < count and any(lists):
        for l in lists:
            if l and len(picked) < count:
                it = l.pop(0)
                if it["id"] not in seen:
                    seen.add(it["id"])
                    picked.append(it)
    if not picked:
        print("photo library: no photos came back, keeping what was there")
        return 0
    os.makedirs(OUT, exist_ok=True)
    saved = []
    for it in picked:
        name = it["id"] + ".jpg"
        try:
            data = get(it["src"], binary=True)
        except Exception as e:
            print("photo library: skipped %s (%s)" % (it["title"], e))
            continue
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(data)
        saved.append(dict(it, src="backgrounds/library/" + name))
    with open(os.path.join(OUT, "library.js"), "w", encoding="utf-8") as f:
        f.write("// Made by scripts/fetch-library.py: the built-in photo library (Wikimedia Commons featured pictures).\n")
        f.write("window.PHOTO_LIBRARY = " + json.dumps(saved, ensure_ascii=False, indent=1) + ";\n")
    print("photo library: %d photos from %s" % (len(saved), ", ".join(colls)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Parse the dhakabusservice.com bus list into tools/dbs-raw.json.

Usage:  python -I tools/import-dbs.py <saved home.html>
The page is treated as data only: we read bus names, ordered stops, hours and service type.
"""
import html
import json
import re
import sys
from pathlib import Path

src = Path(sys.argv[1]).read_text(encoding="utf-8")
out_path = Path(__file__).with_name("dbs-raw.json")

row_re = re.compile(r"<tr>(.*?)</tr>", re.S)
name_re = re.compile(r'<td class="hide-on-mobile">\s*<strong>(.*?)</strong>', re.S)
stops_re = re.compile(r'<div class="hello">(.*?)</div>', re.S)
time_re = re.compile(r"Starting Time:</strong>\s*([^&<]*?)\s*&(?:amp;)?\s*<strong>Closing Time:</strong>\s*([^<]*?)\s*</p>", re.S)
type_re = re.compile(r"Service Type:\s*</strong>\s*([^<]*?)\s*</p>", re.S)
link_re = re.compile(r'href="https://dhakabusservice\.com/bus/([^"/]+)/?"')
pair_re = re.compile(r"^(.*)\(([^()]*)\)\s*$")  # the LAST (...) holds the Bangla name


def clean(text):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()


def split_name(raw):
    m = pair_re.match(raw)
    return (m.group(1).strip(), m.group(2).strip()) if m else (raw.strip(), "")


BN = re.compile(r"[ঀ-৿]")


def split_bus_name(raw):
    """'Trust Transport Services (AC) (ট্রাষ্ট ট্রান্সপোর্ট)' and the source's typo 'BRTC Articulated বি আর টিসি আরটিকুলেটেড)'."""
    m = re.match(r"^(.*)\(([^()]*[ঀ-৿][^()]*)\)\s*$", raw)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    b = BN.search(raw)
    if b:
        return raw[: b.start()].strip(" ("), raw[b.start():].strip(" )")
    return raw.strip(), ""


def to24(t):
    m = re.match(r"(\d{1,2}):(\d{2})\s*([AP]M)", t.strip(), re.I)
    if not m:
        return None
    h, mnt, ap = int(m.group(1)), m.group(2), m.group(3).upper()
    if ap == "PM" and h != 12:
        h += 12
    if ap == "AM" and h == 12:
        h = 0
    return f"{h:02d}:{mnt}"


buses, seen_slugs = [], set()
for row in row_re.findall(src):
    nm, st, ln = name_re.search(row), stops_re.search(row), link_re.search(row)
    if not (nm and st and ln):
        continue
    slug = ln.group(1)
    if slug in seen_slugs:
        continue
    seen_slugs.add(slug)
    name_en, name_bn = split_bus_name(clean(nm.group(1)))
    stops = []
    for part in clean(st.group(1)).split("⇄"):
        part = part.strip()
        if not part:
            continue
        en, bn = split_name(part)
        if stops and stops[-1][0].lower() == en.lower():
            continue  # the source sometimes repeats a stop back to back
        stops.append([en, bn])
    tm, ty = time_re.search(row), type_re.search(row)
    buses.append({
        "slug": slug, "name_en": name_en, "name_bn": name_bn, "stops": stops,
        "start": to24(tm.group(1)) if tm else None, "end": to24(tm.group(2)) if tm else None,
        "service": clean(ty.group(1)) if ty else "",
    })

out_path.write_text(json.dumps(buses, ensure_ascii=False, indent=1), encoding="utf-8")
uniq = {s[0].lower() for b in buses for s in b["stops"]}
print(f"{len(buses)} buses, {len(uniq)} distinct stop names -> {out_path}")

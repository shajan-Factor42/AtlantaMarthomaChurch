#!/usr/bin/env python3
"""Make a front-page image for every newsletter in _data/newsletters.yml that doesn't have one yet.

Renders page 1 of the PDF to assets/newsletters/covers/<Title>.jpg and adds a "cover:" line
under that entry. Run by the "Newsletter covers" GitHub Action; needs pdftoppm (poppler-utils).
"""
import re, subprocess, sys, tempfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "_data" / "newsletters.yml"
OUT = ROOT / "assets" / "newsletters" / "covers"
OUT.mkdir(parents=True, exist_ok=True)

media_base = re.search(r'^media_base:\s*"?([^"\n]+)"?', (ROOT / "_config.yml").read_text(), re.M).group(1).rstrip("/")
lines = DATA.read_text().splitlines()

# Group lines into entries ("- title: ..." plus its indented keys)
entries, cur = [], None
for i, line in enumerate(lines):
    if line.startswith("- "):
        cur = {"start": i, "end": i, "keys": {}}
        entries.append(cur)
    elif cur is None or not line.startswith("  "):
        cur = None if not line.startswith("  ") else cur
        continue
    if cur is not None:
        cur["end"] = i
        m = re.match(r"^(?:- |  )(\w+):\s*(.+?)\s*$", line)
        if m:
            cur["keys"][m.group(1)] = m.group(2).strip('"\'')

made = 0
for e in reversed(entries):  # bottom-up so inserted lines don't shift earlier entries
    k = e["keys"]
    if k.get("cover") or not k.get("title"):
        continue
    slug = re.sub(r"[^A-Za-z0-9]+", "", k["title"])
    target = OUT / f"{slug}.jpg"
    with tempfile.TemporaryDirectory() as tmp:
        pdf = Path(tmp) / "n.pdf"
        try:
            if k.get("url", "").startswith("/"):
                src = ROOT / k["url"].lstrip("/")
                pdf.write_bytes(src.read_bytes())
            elif k.get("url", "").startswith("http"):
                urllib.request.urlretrieve(k["url"], pdf)
            elif k.get("file"):
                if media_base.startswith("http"):
                    urllib.request.urlretrieve(f"{media_base}/{k['file']}", pdf)
                else:
                    pdf.write_bytes((ROOT / media_base.lstrip("/") / k["file"]).read_bytes())
            else:
                continue
            subprocess.run(["pdftoppm", "-f", "1", "-l", "1", "-r", "80", "-jpeg", "-jpegopt", "quality=82",
                            "-singlefile", str(pdf), str(target.with_suffix(""))], check=True)
        except Exception as err:  # keep going; that newsletter just shows the plain card
            print(f"skip {k['title']}: {err}", file=sys.stderr)
            continue
    lines.insert(e["end"] + 1, f"  cover: /assets/newsletters/covers/{slug}.jpg")
    made += 1
    print(f"cover made: {k['title']}")

if made:
    DATA.write_text("\n".join(lines) + "\n")
print(f"{made} new cover(s)")

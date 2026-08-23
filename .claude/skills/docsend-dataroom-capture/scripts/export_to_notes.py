#!/usr/bin/env python3
"""Export captured DocSend pages into Apple Notes (macOS only).

Creates one Notes folder per dataroom and one note per document, with the page
images embedded inline. This is the slower, heavier of the two export paths —
every image travels to Notes as base64 through the scripting bridge and lands in
the NoteStore database — so it downscales aggressively and splits long documents
across several notes. If you are choosing, build_docx.py is faster and produces
much smaller output; use this when you specifically want the pages searchable
and annotatable inside Notes on your phone.

Some macOS versions strip embedded images out of scripted note bodies. This
script detects that (it counts attachments on each note it creates) and tells
you rather than silently leaving you with empty notes.

Usage:
    python3 export_to_notes.py <capture-dir> [--folder "Name"] [options]
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import tempfile
from html import escape
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    Image = None

HERE = Path(__file__).resolve().parent


def log(msg: str) -> None:
    print(msg, flush=True)


def encoded_image(path: Path, max_width: int, quality: int) -> str | None:
    """Return a data: URI for the image, downscaled to keep the bridge fast."""
    try:
        if Image is None:
            data = path.read_bytes()
            mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
        else:
            import io

            with Image.open(path) as im:
                im = im.convert("RGB")
                if im.width > max_width:
                    im = im.resize((max_width, round(im.height * max_width / im.width)), Image.LANCZOS)
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=quality, optimize=True)
                data = buf.getvalue()
            mime = "image/jpeg"
        return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")
    except Exception as exc:
        log(f"      could not encode {path.name}: {exc}")
        return None


def build_notes(manifest: dict, capture_dir: Path, args) -> list[dict]:
    notes: list[dict] = []
    for doc in manifest.get("documents", []):
        pages = doc.get("pages") or []
        if not pages:
            continue
        chunks = [pages[i : i + args.max_pages_per_note] for i in range(0, len(pages), args.max_pages_per_note)]
        for ci, chunk in enumerate(chunks, start=1):
            title = doc.get("title") or doc["dir"]
            name = title if len(chunks) == 1 else f"{title} ({ci}/{len(chunks)})"
            parts = [
                f"<div><b>{escape(name)}</b></div>",
                f"<div><font size='1'>{escape(doc.get('url', ''))} · captured "
                f"{escape(manifest.get('captured_at', ''))}</font></div><br>",
            ]
            for page in chunk:
                src = capture_dir / doc["dir"] / page["file"]
                if not src.exists():
                    continue
                uri = encoded_image(src, args.max_width_px, args.quality)
                if uri:
                    parts.append(f"<div><font size='1'>p.{page['n']}</font></div>")
                    parts.append(f"<div><img src=\"{uri}\"></div><br>")
            notes.append({"name": name, "html": "".join(parts), "images": len(chunk)})
            log(f"  prepared note: {name} ({len(chunk)} pages)")
    return notes


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("capture_dir", help="Directory produced by capture_dataroom.py")
    p.add_argument("--folder", default=None, help="Notes folder name (default: the room title)")
    p.add_argument("--max-pages-per-note", type=int, default=40,
                   help="Split long documents across notes (default: 40)")
    p.add_argument("--max-width-px", type=int, default=1000, help="Downscale wider images (default: 1000)")
    p.add_argument("--quality", type=int, default=65, help="JPEG quality (default: 65)")
    p.add_argument("--dry-run", action="store_true", help="Prepare notes but do not touch Notes.app")
    args = p.parse_args(argv)

    if sys.platform != "darwin" and not args.dry_run:
        sys.exit("Apple Notes export only works on macOS. Use build_docx.py instead.")

    capture_dir = Path(args.capture_dir).expanduser().resolve()
    manifest_path = capture_dir / "manifest.json"
    if not manifest_path.exists():
        sys.exit(f"No manifest.json in {capture_dir}. Run capture_dataroom.py first.")
    manifest = json.loads(manifest_path.read_text())

    folder = args.folder or manifest.get("room_title") or "DocSend capture"
    notes = build_notes(manifest, capture_dir, args)
    if not notes:
        sys.exit("Nothing to export — the manifest has no captured pages.")

    payload = {"folder": folder, "notes": notes}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(payload, fh)
        payload_path = Path(fh.name)
    size_mb = payload_path.stat().st_size / (1024 * 1024)
    log(f"\n{len(notes)} note(s), {size_mb:.1f}MB of embedded images -> Notes folder '{folder}'")

    if args.dry_run:
        log(f"Dry run: payload left at {payload_path}")
        return 0

    try:
        proc = subprocess.run(
            ["osascript", "-l", "JavaScript", str(HERE / "notes_import.js"), str(payload_path)],
            capture_output=True, text=True, timeout=max(120, 8 * len(notes)),
        )
    finally:
        payload_path.unlink(missing_ok=True)

    if proc.returncode != 0:
        log(proc.stderr.strip())
        log("\nNotes export failed. The Word path (build_docx.py) does not need Notes.app "
            "and is the faster option anyway.")
        return 1

    try:
        result = json.loads(proc.stdout.strip() or "{}")
    except json.JSONDecodeError:
        log(proc.stdout.strip())
        return 1

    log(f"Created {result.get('created', 0)} note(s) in '{result.get('folder', folder)}'")
    for err in result.get("errors", []):
        log(f"  error: {err}")
    attachments = result.get("attachments", [])
    if attachments and all(a in (0, -1) for a in attachments):
        log(
            "\nWARNING: the notes were created but contain no image attachments — this macOS "
            "version strips embedded images from scripted notes. Use build_docx.py and, if you "
            "want the pages in Notes, drag the .docx files into a note manually."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

---
name: docsend-dataroom-capture
description: >
  Capture every page of every document in a DocSend dataroom (or a single
  DocSend /view/ link) as images, then assemble them into Word notebooks — one
  .docx per document — or into Apple Notes. Use this whenever someone wants to
  save, archive, keep, read offline, annotate, or "get a copy of" material in a
  DocSend room, space, or link that has downloads disabled, including phrasings
  like "screenshot every page of this deck", "the VC sent me a data room and I
  can't download anything", "turn this DocSend link into a Word doc", "grab all
  the fund documents from this room", or "save these pages so I can mark them
  up". Also use it for the follow-on steps: verifying a capture is complete,
  rebuilding the .docx files at different quality, or pushing captured pages
  into Notes. Trigger even when the user does not say "DocSend" but pastes a
  docsend.com URL or describes a view-only investor/diligence room.
---

# DocSend dataroom capture

DocSend rooms with downloads disabled still render every page to the browser as
an image. This skill drives a real Chromium session through the email gate,
enumerates the documents in the room, saves each page image, and assembles them
into files you can read offline and annotate.

Use it on rooms that were shared with you. Captured pages carry whatever
watermark DocSend stamps for your viewer email, so treat the output as the
confidential material it is. If a room asks the viewer to accept an NDA, the
capture script stops instead of clicking through — accepting an agreement is the
human's call.

## Scripts

All four live in `scripts/` next to this file:

| Script | Job |
| --- | --- |
| `setup.sh` / `setup.ps1` | One-time: virtualenv + Playwright + python-docx + Pillow + Chromium (bash / PowerShell) |
| `dashboard.py` / `dashboard.ps1` | Local web UI over the whole flow: saved rooms, live log, results table, one-click Word build |
| `capture_dataroom.py` | Gate → discover documents → save page images + `manifest.json` |
| `build_docx.py` | `manifest.json` → one Word notebook per document (**default export**) |
| `export_to_notes.py` | `manifest.json` → Apple Notes folder, one note per document (macOS) |

## Word or Notes?

**Default to Word unless the user specifically wants the pages inside Notes.**
Word is both faster and lighter, and the reason is structural rather than a
matter of taste: `build_docx.py` is a plain file write — no application has to
be running, nothing crosses a process boundary, and the images are downscaled
and JPEG-encoded on the way in (a 9.5 MB page PNG lands at ~670 KB, and a
4-page deck comes out around 45 KB). The Notes path has to launch Notes.app and
hand every page across the AppleScript bridge as base64 text, which then gets
copied into the NoteStore database; it is far slower per page, the payload
balloons, and some macOS versions silently strip embedded images from scripted
notes. `export_to_notes.py` detects that stripping and tells you, but the
cheaper answer is Word.

Pick Notes anyway when the user wants the pages on their phone, searchable in
Notes, or alongside existing Notes-based deal notes. It is a real option, just
not the fast one.

## The dashboard, for repeat use

Someone capturing rooms regularly should not be assembling command lines. Point
them at the dashboard instead:

```bash
~/.docsend-capture/venv/bin/python scripts/dashboard.py        # macOS / Linux
powershell -ExecutionPolicy Bypass -File scripts\dashboard.ps1  # Windows
```

On Windows, `scripts\DocSend-Capture.cmd` does the same thing by double-click —
no terminal, and it drops a copy on the Desktop the first time it runs so there
is a permanent icon. Prefer offering that to anyone who would rather not touch a
command line; the console window it opens is the server itself, which is worth
saying out loud, because closing it stops the dashboard.

It serves a page on `127.0.0.1` with a form (URL, email, passcode, output
folder), the same options the CLI takes, a live log, and a results table showing
each document's captured versus reported page count so a shortfall is visible
rather than buried. Rooms are remembered by name, so a second capture of the
same dataroom is two clicks. Word files build from a button.

It binds to loopback only and requires a token embedded in its own page, so
another site in the same browser cannot drive it. Passcodes are only written to
disk when the user explicitly ticks that box — `rooms.json` is plain JSON in
their home folder, not a keychain — and passcodes are redacted from the log the
page displays.

The CLI stays the right tool for a one-off, for scripting, and for anything
needing a flag the form does not expose. Everything below describes it, and the
dashboard is a front end over exactly these steps.

## Workflow

### 1. Collect what you need from the user

- the room or document URL (`docsend.com/room/...`, `/s/...`, `/view/s/...`, or `/view/<id>`)
- the email address the link was shared with — DocSend often only admits that address
- the passcode, if the link is protected

Ask for a missing passcode rather than guessing; a wrong one wastes a gate attempt.

### 2. Set up once

macOS / Linux:

```bash
bash scripts/setup.sh                 # creates ~/.docsend-capture/venv
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

Then use `~/.docsend-capture/venv/bin/python` (macOS/Linux) or
`%USERPROFILE%\.docsend-capture\venv\Scripts\python.exe` (Windows) for the other
scripts. If the machine already has a Chromium you want to drive instead, pass
`--browser-path` (or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`).

`export_to_notes.py` is macOS-only — it automates Apple Notes. On Windows the
Word path is the whole story.

### 3. Look before you capture

```bash
VENV=~/.docsend-capture/venv/bin/python
$VENV scripts/capture_dataroom.py "<url>" --email you@example.com --dry-run --out ~/Desktop/room
```

This lists every document it found and its page count without downloading
anything. It is the cheapest way to catch the two failure modes that matter: the
gate not opening, and documents the room hides behind a collapsed section. Show
the user the list and confirm it matches what they see in the room — you cannot
tell from inside the script that a document is missing, but they can.

### 4. Capture

```bash
$VENV scripts/capture_dataroom.py "<url>" --email you@example.com \
    --passcode "<if any>" --out ~/Desktop/room
```

Useful flags: `--only "Deck"` for one document, `--concurrency 4` to go wider on
a big room, `--headed` to watch the browser (or solve an unusual gate by hand),
`--session-state ~/.docsend-capture/session.json` to reuse cookies next time,
`--strategy screenshot` to force pixel capture.

The script writes `<out>/<NN>-<document-title>/p001.jpg…` plus
`<out>/manifest.json`, and prints a per-document count as it goes.

### 5. Check completeness before exporting

The script compares what it captured against the page count the viewer reported
and flags any shortfall in both its summary and the manifest. Read that summary.
A document that came up short is worth a retry with a different strategy before
you build anything:

```bash
$VENV scripts/capture_dataroom.py "<doc-url>" --email you@example.com \
    --strategy screenshot --out ~/Desktop/room
```

Report honestly if a document stayed incomplete — a Word file that silently
skips pages 14–20 of a term sheet is worse than a warning.

### 6. Export

```bash
$VENV scripts/build_docx.py ~/Desktop/room                    # one .docx per document + index
$VENV scripts/build_docx.py ~/Desktop/room --mode single      # everything in one file
$VENV scripts/build_docx.py ~/Desktop/room --no-recompress    # archival quality, bigger files
```

Each page fills a Word page, orientation follows the source (16:9 decks come out
landscape), and a small caption carries the document title and page number so
quotes can be cited later. `00-INDEX.docx` lists every document, its page count,
and its file.

For Notes instead:

```bash
$VENV scripts/export_to_notes.py ~/Desktop/room --folder "Series A — Acme"
```

Long documents are split across several notes (`--max-pages-per-note`, default
40) because a single note holding hundreds of images becomes unusable.

### 7. Tell the user what they got

Report the output directory, the document and page counts, the total size, and
anything that came up short. If they asked for Notes and the images were
stripped, say so plainly and point them at the Word files.

## Where this fits in InvestIQ

This skill exists in this repo because diligence material arrives as view-only
DocSend rooms, and InvestIQ's document analysis needs files.

**Capture outside the repo, or into an ignored folder.** Fund documents are
confidential and watermarked with the viewer's email; they must never be
committed. `docsend-captures/` is git-ignored for exactly this — anywhere outside
the working tree is fine too.

**Feeding captures into the app has one real limitation, so be straight about
it.** `/api/data-room/upload` accepts PDF and DOCX up to 50 MB, and
`server/fileParser.ts` pulls text out of PDFs with `pdf-parse`. Captured PDFs are
*images of pages* — there is no text layer — so `pdf-parse` returns nothing and
memo generation has no source text to work with. The pages are perfectly readable
by a human and useless to the parser.

That leaves three honest options, in the order worth trying:

1. **Ask the manager for the original PDFs.** Routine for an LP or prospective
   LP, and the files come with a real text layer, no watermark, and no analytics
   question. This is the only path that makes the documents fully usable inside
   InvestIQ.
2. **Use the capture for reading and annotation**, and key the numbers that
   matter into the app by hand. Fine for a handful of figures.
3. **Add OCR** if captures need to be machine-readable at volume. Nothing in this
   repo does OCR today — the `ocrPrompt` in `server/routes.ts` runs over text that
   has already been extracted, not over images. Adding it is real work (a
   Tesseract step in the capture pipeline, or a vision model pass) and should be
   a deliberate decision, not something assumed to be already handled.

## When something goes wrong

`references/troubleshooting.md` maps symptoms to fixes: gate loops, zero
documents found, partial captures, blurry pages, canvas-rendered viewers,
oversized output. Read it before improvising.

`references/docsend-internals.md` explains how the viewer is put together, what
the three capture strategies actually do, and which selectors to update if
DocSend changes its markup. Read it when a fix means editing
`capture_dataroom.py` rather than changing a flag.

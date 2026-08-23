# How the DocSend viewer works, and what the scripts do about it

Read this when a fix means editing `scripts/capture_dataroom.py` rather than
changing a flag. Everything here is observed behaviour of a third-party product,
so expect drift: the code is written so that a change in any one layer degrades
to the next strategy instead of failing outright.

## URL shapes

| Shape | What it is | How the script treats it |
| --- | --- | --- |
| `docsend.com/view/<id>` | one document | captured directly |
| `docsend.com/view/s/<space>` | a space (multi-document room) | crawled for documents |
| `docsend.com/view/s/<space>/d/<doc>` | a document **inside** a space | captured directly, full path preserved |
| `docsend.com/view/<space>/d/<doc>` | same thing, without the `s/` prefix | captured directly, full path preserved |
| `docsend.com/room/...`, `docsend.com/s/<slug>` | dataroom / space | crawled for documents |

The nested shapes are the subtle ones, and getting them wrong is how a room that
plainly contains documents yields zero — or, worse, exactly one. Note that the
`s/` prefix is optional: a room reached at `/view/s/<space>` may well link its
documents as `/view/<space>/d/<doc>`. Two failure modes follow from that, both
observed in the wild:

- A matcher that rejects everything beginning with `/view/s/` (to avoid treating
  the space as a document) discards every document in a prefixed room.
- A matcher that misses the un-prefixed form falls back to the standalone
  `/view/<id>` pattern, which truncates every document URL to the space itself.
  All of them then collapse into a single phantom "document" — the room's own
  link, wearing whatever name happened to sit next to it.

So `doc_match` tests the nested pattern *first*, with the prefix optional, and
only then the standalone one. The full nested path is preserved rather than
rewritten to `/view/<doc>`, because `page_data` and the viewer are served
relative to it. A candidate whose id equals the space's own id, with no `/d/` in
its path, is dropped as the room's self-link.

## The gate

The email wall is a normal form. Field ids have been stable for a long time
(`#link_auth_form_email`, `#link_auth_form_passcode`), but the script tries a
descending ladder of selectors — id, `name`, `type`, then attribute-contains —
so a rename does not break it. Three things commonly happen instead of entry:

- **The email is not on the allow list.** The form re-renders. The script retries
  three times, then raises `GateFailed` with the likely causes.
- **A passcode is required and was not supplied.** Detected explicitly so the
  message says so rather than timing out.
- **An agreement (NDA/terms) must be accepted.** `check_agreement` looks for
  agreement language plus a checkbox and raises `AgreementRequired`. Clicking
  someone's NDA on their behalf is not the script's call, so `--accept-agreements`
  is an explicit opt-in.

Once inside, `--session-state <path>` saves cookies so later runs skip the gate
entirely. That is also the escape hatch for gates that need a human: run
`--headed`, complete it by hand, and the session is reused.

## Finding the documents in a room

Discovery deliberately does **not** decide what a document is from the URL's
shape. Rooms differ too much, and every time the guess is wrong the symptom is
the worst possible one: a confident report of one document in a room that holds
six. Instead it gathers candidates broadly and then verifies each one.

**Gather.** `expand_and_scroll` clicks everything with `aria-expanded="false"`,
opens `<details>`, and scrolls until the page stops growing. Then
`collect_candidate_urls` takes two passes over the result:

1. every same-host `<a href>`, which conveniently carries the document name as
   link text; and
2. every path quoted inside the page's own scripts (`EMBEDDED_PATH_RE`). This is
   the one that matters for single-page rooms: they ship the file list as JSON
   and render rows as `<div>`s with click handlers, so there are no anchors to
   crawl at all. `name_near` then pulls each document's name out of the
   surrounding JSON, taking the name *closest* to the path — entries sit next to
   each other in the payload, so taking the first name in the window labels every
   file with its predecessor's name.

**Verify.** `is_document` asks DocSend directly, by requesting `page_data/1` and
checking for a page image. A real document answers; a settings path or a
marketing link does not. This is what lets a room invent any URL scheme without
breaking discovery.

The ordering matters, though: verification is there to **rescue** unfamiliar
schemes, never to **veto** familiar ones. A recognised URL shape is accepted on
its own evidence, and only the leftovers get probed. Gating every candidate on a
successful probe means any unrelated reason the endpoint fails — a room that
serves its pages some other way, a transient error — empties the entire room and
reports "no documents found", which is a far worse failure than admitting one
stray URL.

Titles that end up duplicated across documents are cleared, because the viewer
knows its own name: `capture_document` falls back to the viewer's `<title>` when
the room supplied nothing usable.

If discovery still comes up short, `--doc-url` (repeatable) bypasses it entirely.

## Page count

`get_page_count` gathers candidates from embedded JSON (`total_pages`,
`page_count`, `pageCount`), `data-total-pages`/`data-page-count` attributes, and
"n / m"-style viewer text, then takes the largest plausible value (1–2000). It is
a heuristic and it is allowed to be wrong: it only decides when to stop and what
number to compare the result against. When it returns nothing, the strategies
probe forward until the source stops yielding pages, bounded by `--max-pages`.

## The three strategies

1. **`page_data`** — `GET /view/<id>/page_data/<n>` returns JSON containing a
   signed URL for that page's rendered image. The script then fetches those bytes
   through the browser context (so cookies apply). This is the best path in every
   dimension: original resolution, no rendering cost, and page count discovered by
   the endpoint 404-ing. It walks pages sequentially and stops at the first
   failure.

2. **`dom`** — Read the images the viewer itself put in the document and download
   those bytes. Handles both viewer layouts: scroll-all-pages (scroll until no new
   images appear) and one-page-at-a-time (read the largest visible image, advance
   with a next control or `ArrowRight`, stop when the image stops changing). Same
   fidelity as `page_data` when the viewer serves full-size images, lower when it
   serves a display-sized variant.

3. **`screenshot`** — Screenshot the page element at `--scale` (default 2×). The
   only strategy that works when pages are drawn to a `<canvas>` with no image
   URL to grab, and the only one that always captures exactly what is on screen —
   including overlays and watermarks. Text is softer because it is resampled
   pixels, not the original render.

In `auto` mode the script tries them in that order and keeps the best result: a
strategy that returns a complete page set wins immediately, a partial result is
retained only until something better comes along, and the shortfall is recorded
in `manifest.json` as `error`.

## Watermarks and fidelity

DocSend commonly burns the viewer's email into each page. Nothing here removes
it, and nothing here should: the watermark is part of the document as shared.
Expect it in the output and in anything built from the output.

## Manifest

`manifest.json` is the contract between capture and export:

```json
{
  "source_url": "...", "room_title": "...", "captured_at": "...",
  "viewer_email": "...",
  "documents": [
    {"id": "...", "title": "...", "url": "...", "dir": "01-seed-deck",
     "pages": [{"n": 1, "file": "p001.jpg"}],
     "page_count": 4, "reported_page_count": 4,
     "strategy": "page_data", "error": null}
  ]
}
```

## Filenames and collisions

Two captures must never be able to quietly overwrite each other, because the
loss is silent: a page or a whole document is simply replaced, and nothing in the
output says so. Three rules keep that from happening.

**Page images carry their document id**: `hkft3557-p001.png`, not `p001.png`.
Page numbers alone collide the moment images from two documents land in one
folder, which is exactly what happens when someone flattens a capture to file or
attach the images. DocSend document ids are per-document, so the prefix makes
each image identifiable on its own.

**Document folders carry the id too**: `04-Volt-III-Deck-wzqsmww2`. Two documents
in one room can share a title, and the ordinal prefix is not stable across runs
because discovery order varies with concurrency — so without the id, a re-run can
point folder `01-` at a different document than last time.

**A folder holding a different room gets a subfolder.** `resolve_output_dir`
compares `source_url` in any existing `manifest.json` against the room being
captured. Same room refreshes in place, which is what a re-run should do; a
different room nests under a slug of its title. `--if-exists` chooses
`nest` (default), `overwrite`, or `fail`. Re-using one output folder for every
dataroom is the natural habit and the one that destroys data.

A refresh also calls `clear_stale_pages` first, so a capture that yields fewer
pages than last time — or switches strategy and therefore file extension — does
not leave orphans that look like real pages.

## Manifest

Both exporters read only this file plus the image files it names, so a capture
can be re-exported at any quality without re-downloading, and a hand-edited
manifest (dropping a document, reordering pages) is a legitimate way to fix up a
messy room.

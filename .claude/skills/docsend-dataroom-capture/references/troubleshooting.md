# Troubleshooting

Symptoms in the order you are likely to hit them. `$VENV` below is
`~/.docsend-capture/venv/bin/python`.

## "Still sitting on the email gate after 3 attempts"

In order of likelihood:

1. **The email is not the one the link was shared with.** DocSend links are often
   restricted to a single address. Confirm the exact address with the user,
   including which of their mailboxes the invite arrived in.
2. **A passcode is required.** Re-run with `--passcode "..."`.
3. **DocSend wants email verification** (it mails a code). Scripted entry cannot
   complete that. Run `--headed --session-state ~/.docsend-capture/session.json`,
   finish the gate by hand in the window that opens, and the saved session carries
   the rest of the run — and later runs.

## The page title is a CDN error ("The request could not be satisfied")

The request never reached DocSend — a CDN in front of it refused. The
diagnostics call this out explicitly. Work through it in this order, because the
first case is not fixable from here:

1. **Open the same link in your own browser.** If it errors there too, the link
   is expired, revoked, or mistyped, and no capture flag will help — ask the
   sender for a fresh link.
2. **If it loads in your browser but not here, the CDN is blocking automation.**
   The script already sends this browser's own user agent with the `HeadlessChrome`
   marker stripped, since that token alone is enough to get refused. Beyond that,
   try a visible run and your real Chrome, which is the hardest fingerprint to
   distinguish from a person:

   ```
   --headed --browser-path "C:\Program Files\Google\Chrome\Application\chrome.exe"
   ```

   Once a visible run gets in, add `--session-state <path>` so the cookies carry
   into later headless runs.
3. **Region or network restrictions.** A VPN, or a corporate network the room
   does not allow, will produce the same page.

## "No documents found in this room"

The script now dumps evidence instead of leaving you guessing: it prints the
final URL, the page title, whether an email field is still visible (meaning the
gate never opened), and every `/view/` link it saw, then saves
`discovery-debug.png` and `discovery-debug.html` into the output directory.

Read the diagnostics in this order:

1. **An email field is still visible** → the gate did not open. Wrong address,
   or a passcode/verification step is needed. Fix that first; discovery was
   never the problem.
2. **`/view/` links were listed but none matched** → the room uses a URL shape
   the matcher does not know. Pass them directly with `--doc-url <url>` (one per
   document) and report the shapes so the matcher can learn them.
3. **Zero links on the page** → the file list is not made of anchors, or never
   loaded. Look at `discovery-debug.png`: if it shows the document list, open the
   room in a normal browser, copy each document URL, and use `--doc-url`. If it
   shows a login or error page, go back to step 1.

## A document captured fewer pages than reported

The summary and `manifest.json` both flag this. Re-capture just that document
with a different strategy:

```bash
$VENV scripts/capture_dataroom.py "<doc-url>" --email you@example.com \
    --strategy dom --out <same-out-dir>
$VENV scripts/capture_dataroom.py "<doc-url>" --email you@example.com \
    --strategy screenshot --out <same-out-dir>
```

If it still comes up short, check whether the viewer's reported count includes
pages the room does not actually serve (appendices excluded from sharing are a
common cause). Say which pages are missing rather than shipping a file that looks
complete.

## Pages are blurry

You are on the `screenshot` strategy. Raise `--scale 3` and re-run, or force
`--strategy page_data` / `--strategy dom` to see whether an image URL is
available after all. Blurriness in `page_data` output means DocSend itself only
serves a display-resolution render — nothing to be done at capture time.

## Capture is very slow

Raise `--concurrency` (4 is comfortable; much higher risks rate limiting) and
prefer `page_data`, which does no rendering. `screenshot` is inherently slow
because every page is a real browser paint.

## Word files are too big to email

Defaults already downscale to 1600px JPEG q80. Push further:

```bash
$VENV scripts/build_docx.py <dir> --max-width-px 1200 --quality 70
```

Or split: per-document mode (the default) keeps each file small, whereas
`--mode single` concentrates everything into one large file.

## Word files look wrong

- **Pages letterboxed on portrait paper** — orientation is taken from the first
  page of each document. A document whose first page is portrait but whose body is
  landscape will look wrong; capture that document separately, or accept it.
- **A blank page between images** — an image slightly too tall for the printable
  area. Lower `--margin 0.2`, or `--no-captions` to reclaim the caption strip.
- **Text unreadably small** — the source render is low-resolution; re-capture with
  `--strategy page_data` or a higher `--scale`.

## Notes export created notes with no images

Some macOS versions strip embedded images out of scripted note bodies. The script
detects this (it counts attachments) and warns. There is no scripted workaround —
use `build_docx.py` and, if the pages must live in Notes, drag the resulting
files into a note by hand.

## Notes export is slow or Notes.app hangs

Expected on large rooms: every image crosses the AppleScript bridge as base64.
Reduce the load with `--max-pages-per-note 20 --max-width-px 800 --quality 55`,
or use the Word path.

## `Executable doesn't exist at …chrome-headless-shell`

Playwright's Python package and its browser build are out of step. Either
`$VENV -m playwright install chromium`, or point at a Chromium already on the
machine: `--browser-path /path/to/chrome` (or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`).

## Windows specifics

- `setup.sh` needs bash — use `setup.ps1` instead, or run the .sh under Git Bash
  or WSL. Do not mix them: a WSL virtualenv holds Linux binaries that Windows
  Python cannot use.
- The interpreter is at `%USERPROFILE%\.docsend-capture\venv\Scripts\python.exe`,
  not `bin/python`.
- `PowerShell cannot run scripts` — launch it as
  `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1` rather than
  changing the machine-wide policy.
- Quote paths containing spaces, and call the interpreter with the `&` operator:
  `& "$env:USERPROFILE\.docsend-capture\venv\Scripts\python.exe" .\capture_dataroom.py …`
- `export_to_notes.py` will not run: it automates Apple Notes and exits on any
  non-macOS platform. Use `build_docx.py`.
- Very long output paths can trip the 260-character limit; capture into a short
  directory such as `C:\rooms\<name>` if a write fails for no apparent reason.
- **Keep the `.ps1` files pure ASCII when editing them.** Windows PowerShell 5.1
  reads a BOM-less `.ps1` as ANSI, so a UTF-8 em dash or curly quote decodes into
  three characters, the last of which is a right smart quote — and PowerShell
  honours that as a string delimiter. One stray dash in a comment unbalances the
  whole file, and the reported error points at a later line than the real cause.
  A `Parse error: string is missing the terminator` on a line that looks fine is
  this. Check with `Select-String -Path *.ps1 -Pattern '[^\x00-\x7F]'`.

## The room requires accepting an NDA

The script stops with `AgreementRequired` on purpose. Have the user read and
accept it — either in their own browser (then reuse the session with
`--session-state`), or with `--accept-agreements` once they have told you to
proceed.

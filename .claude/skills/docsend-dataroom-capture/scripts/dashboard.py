#!/usr/bin/env python3
"""Local web dashboard for capturing DocSend datarooms.

Runs a small server on 127.0.0.1 and opens a page where you fill in a room URL,
email and passcode, press Capture, and watch the log. Saved rooms let you come
back to a dataroom without retyping anything. Word notebooks are built with one
more click.

Deliberately built on the standard library alone: the capture already needs
Playwright, python-docx and Pillow, and a dashboard is not a good reason to add
a web framework to that list.

Usage:
    python3 dashboard.py [--port 8765] [--no-browser]

The server binds to loopback only and requires a token that is embedded in the
page it serves, so another site open in your browser cannot drive it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
CAPTURE = HERE / "capture_dataroom.py"
BUILD = HERE / "build_docx.py"
CONFIG_DIR = Path.home() / ".docsend-capture"
ROOMS_FILE = CONFIG_DIR / "rooms.json"
SESSION_FILE = CONFIG_DIR / "session.json"
TOKEN = secrets.token_urlsafe(24)

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()


# --------------------------------------------------------------------------- #
# Saved rooms
# --------------------------------------------------------------------------- #

def load_rooms() -> list[dict]:
    try:
        data = json.loads(ROOMS_FILE.read_text())
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_rooms(rooms: list[dict]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    ROOMS_FILE.write_text(json.dumps(rooms, indent=2))


def upsert_room(room: dict) -> list[dict]:
    rooms = [r for r in load_rooms() if r.get("url") != room.get("url")]
    rooms.append(room)
    rooms.sort(key=lambda r: (r.get("name") or "").lower())
    save_rooms(rooms)
    return rooms


# --------------------------------------------------------------------------- #
# Jobs
# --------------------------------------------------------------------------- #

def start_job(kind: str, argv: list[str], out_dir: str, secret_values: list[str]) -> str:
    """Run a script as a subprocess, streaming its output into a job record."""
    job_id = secrets.token_hex(8)
    job = {
        "id": job_id,
        "kind": kind,
        "out": out_dir,
        "status": "running",
        "returncode": None,
        "log": [],
        "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    with JOBS_LOCK:
        JOBS[job_id] = job

    def redact(line: str) -> str:
        for value in secret_values:
            if value:
                line = line.replace(value, "***")
        return line

    def run() -> None:
        try:
            proc = subprocess.Popen(
                argv,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env={**os.environ, "PYTHONUNBUFFERED": "1"},
            )
            job["pid"] = proc.pid
            assert proc.stdout is not None
            for line in proc.stdout:
                with JOBS_LOCK:
                    job["log"].append(redact(line.rstrip("\n")))
            proc.wait()
            job["returncode"] = proc.returncode
            job["status"] = "done" if proc.returncode == 0 else "failed"
        except Exception as exc:  # pragma: no cover - defensive
            with JOBS_LOCK:
                job["log"].append(f"dashboard error: {type(exc).__name__}: {exc}")
            job["status"] = "failed"
            job["returncode"] = -1

    threading.Thread(target=run, daemon=True).start()
    return job_id


def read_manifest(out_dir: str) -> dict | None:
    try:
        return json.loads((Path(out_dir) / "manifest.json").read_text())
    except Exception:
        return None


def output_files(out_dir: str, subfolder: str, pattern: str) -> list[dict]:
    folder = Path(out_dir) / subfolder
    if not folder.is_dir():
        return []
    return sorted(
        ({"name": f.name, "bytes": f.stat().st_size} for f in folder.glob(pattern)),
        key=lambda f: f["name"],
    )


def word_files(out_dir: str) -> list[dict]:
    return output_files(out_dir, "word", "*.docx")


def pdf_files(out_dir: str) -> list[dict]:
    return output_files(out_dir, "pdf", "*.pdf")


def reveal(path: str) -> str:
    """Open a folder in the system file manager."""
    target = Path(path)
    if not target.exists():
        return f"not found: {path}"
    try:
        if sys.platform.startswith("win"):
            os.startfile(str(target))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])
        return "opened"
    except Exception as exc:
        return f"{type(exc).__name__}: {exc}"


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

class Handler(BaseHTTPRequestHandler):
    server_version = "docsend-dashboard"

    def log_message(self, *args) -> None:  # quiet; the page is the interface
        pass

    # -- helpers ----------------------------------------------------------- #

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def _json(self, payload, code: int = 200) -> None:
        self._send(code, json.dumps(payload).encode(), "application/json")

    def _local_only(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0]
        return self.client_address[0] in ("127.0.0.1", "::1") and host in ("127.0.0.1", "localhost")

    def _authed(self) -> bool:
        return secrets.compare_digest(self.headers.get("X-Dash-Token", ""), TOKEN)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode() or "{}")
        except Exception:
            return {}

    # -- routes ------------------------------------------------------------ #

    def do_GET(self) -> None:
        if not self._local_only():
            return self._send(403, b"local only", "text/plain")
        route = urlparse(self.path)
        if route.path == "/":
            page = PAGE.replace("__TOKEN__", TOKEN).replace(
                "__DEFAULT_OUT__", str(Path.home() / "Desktop" / "dataroom")
            )
            return self._send(200, page.encode(), "text/html; charset=utf-8")
        if route.path == "/api/rooms":
            return self._json({"rooms": load_rooms(), "session": str(SESSION_FILE)})
        if route.path == "/api/job":
            params = parse_qs(route.query)
            job_id = (params.get("id") or [""])[0]
            since = int((params.get("since") or ["0"])[0])
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if not job:
                    return self._json({"error": "unknown job"}, 404)
                lines = job["log"][since:]
                payload = {
                    "status": job["status"],
                    "returncode": job["returncode"],
                    "kind": job["kind"],
                    "out": job["out"],
                    "lines": lines,
                    "next": since + len(lines),
                }
            if payload["status"] != "running":
                payload["manifest"] = read_manifest(job["out"])
                payload["word"] = word_files(job["out"])
                payload["pdf"] = pdf_files(job["out"])
            return self._json(payload)
        if route.path == "/api/capture":
            params = parse_qs(route.query)
            out = (params.get("out") or [""])[0]
            return self._json({"manifest": read_manifest(out), "word": word_files(out),
                               "pdf": pdf_files(out)})
        return self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:
        if not self._local_only():
            return self._send(403, b"local only", "text/plain")
        if not self._authed():
            return self._send(403, b"bad token", "text/plain")
        route = urlparse(self.path)
        body = self._body()

        if route.path == "/api/run":
            url = (body.get("url") or "").strip()
            email = (body.get("email") or "").strip()
            out = (body.get("out") or "").strip()
            if not url or not email or not out:
                return self._json({"error": "url, email and output folder are required"}, 400)
            passcode = body.get("passcode") or ""
            argv = [sys.executable, str(CAPTURE), url, "--email", email, "--out", out]
            if passcode:
                argv += ["--passcode", passcode]
            if body.get("dry_run"):
                argv.append("--dry-run")
            if body.get("debug"):
                argv.append("--debug")
            strategy = body.get("strategy") or "auto"
            if strategy != "auto":
                argv += ["--strategy", strategy]
            argv += ["--concurrency", str(int(body.get("concurrency") or 2))]
            if body.get("headed"):
                argv.append("--headed")
            if body.get("use_session", True):
                argv += ["--session-state", str(SESSION_FILE)]
            if body.get("browser_path"):
                argv += ["--browser-path", body["browser_path"]]
            argv += ["--collate", "pdf" if body.get("collate", True) else "none"]
            if body.get("discard_pages"):
                argv.append("--discard-pages")

            if body.get("save_room"):
                upsert_room({
                    "name": (body.get("room_name") or "").strip() or url,
                    "url": url,
                    "email": email,
                    "out": out,
                    # Passcodes are only written when explicitly asked for: this
                    # file is plain JSON in the user's profile, not a keychain.
                    "passcode": passcode if body.get("save_passcode") else "",
                })
            job_id = start_job("capture", argv, out, [passcode])
            return self._json({"job": job_id})

        if route.path == "/api/build":
            out = (body.get("out") or "").strip()
            if not out:
                return self._json({"error": "output folder is required"}, 400)
            argv = [sys.executable, str(BUILD), out]
            if body.get("mode") == "single":
                argv += ["--mode", "single"]
            if body.get("no_recompress"):
                argv.append("--no-recompress")
            return self._json({"job": start_job("build", argv, out, [])})

        if route.path == "/api/reveal":
            return self._json({"result": reveal((body.get("path") or "").strip())})

        if route.path == "/api/rooms/delete":
            url = (body.get("url") or "").strip()
            rooms = [r for r in load_rooms() if r.get("url") != url]
            save_rooms(rooms)
            return self._json({"rooms": rooms})

        return self._send(404, b"not found", "text/plain")


PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DocSend Capture</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='13'>📄</text></svg>">
<style>
  :root {
    --bg: #f6f7f9; --panel: #ffffff; --ink: #16181d; --muted: #6b7280;
    --line: #e3e6ea; --accent: #2f5fd0; --accent-ink: #ffffff;
    --ok: #1a7f4b; --warn: #9a6700; --bad: #b3261e; --code-bg: #0f1115; --code-ink: #dfe3ea;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #101216; --panel: #181b21; --ink: #e8eaee; --muted: #9aa1ac;
      --line: #272c34; --accent: #5b8def; --accent-ink: #0b1020;
      --ok: #52c98b; --warn: #e0b341; --bad: #ff7b72; --code-bg: #0b0d11; --code-ink: #d7dbe2;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  header { padding: 22px 24px 6px; }
  h1 { margin: 0; font-size: 19px; letter-spacing: -0.01em; }
  header p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
  main { display: grid; grid-template-columns: minmax(320px, 420px) 1fr; gap: 18px; padding: 18px 24px 32px; align-items: start; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
  .panel h2 { margin: 0 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  label { display: block; margin-bottom: 11px; font-size: 13px; color: var(--muted); }
  input[type=text], input[type=password], input[type=number], select {
    width: 100%; margin-top: 4px; padding: 8px 10px; font: inherit; font-size: 14px;
    color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 7px;
  }
  input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  .row { display: flex; gap: 10px; }
  .row > * { flex: 1; }
  .checks { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 6px 0 14px; }
  .checks label { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--ink); font-size: 13px; }
  .checks input { width: auto; margin: 0; }
  button {
    font: inherit; font-size: 14px; padding: 9px 14px; border-radius: 7px; cursor: pointer;
    border: 1px solid var(--line); background: var(--panel); color: var(--ink);
  }
  button.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; font-weight: 600; }
  button:disabled { opacity: .55; cursor: default; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .rooms { list-style: none; margin: 0; padding: 0; }
  .rooms li { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid var(--line); }
  .rooms li:first-child { border-top: 0; }
  .rooms button.link { border: 0; background: none; padding: 0; text-align: left; flex: 1; color: var(--accent); }
  .rooms small { color: var(--muted); display: block; font-size: 11px; }
  .status { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; font-size: 14px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.running { background: var(--accent); animation: pulse 1.1s ease-in-out infinite; }
  .dot.done { background: var(--ok); } .dot.failed { background: var(--bad); }
  @keyframes pulse { 50% { opacity: .3; } }
  pre.log {
    margin: 0; padding: 12px; height: 320px; overflow: auto; border-radius: 8px;
    background: var(--code-bg); color: var(--code-ink); font-size: 12.5px; line-height: 1.45;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .short { color: var(--bad); font-weight: 600; }
  .hint { color: var(--muted); font-size: 12px; margin: 8px 0 0; }
  .tablewrap { max-height: 340px; overflow: auto; }
</style>
</head>
<body>
<header>
  <h1>DocSend Capture</h1>
  <p>Capture every page of every document in a dataroom, then build Word notebooks. Runs on this machine only.</p>
</header>
<main>
  <section class="panel">
    <h2>Room</h2>
    <label>Dataroom or document URL
      <input id="url" type="text" placeholder="https://docsend.com/view/s/..." autocomplete="off">
    </label>
    <label>Email the link was shared with
      <input id="email" type="text" placeholder="you@example.com" autocomplete="off">
    </label>
    <label>Passcode (if the link asks for one)
      <input id="passcode" type="password" autocomplete="off">
    </label>
    <div class="row">
      <label>Name (for the saved list)
        <input id="room_name" type="text" placeholder="Volt III" autocomplete="off">
      </label>
      <label>Output folder
        <input id="out" type="text" value="__DEFAULT_OUT__" autocomplete="off">
      </label>
    </div>

    <div class="checks">
      <label><input id="dry_run" type="checkbox" checked> List only (no download)</label>
      <label><input id="use_session" type="checkbox" checked> Reuse saved session</label>
      <label><input id="headed" type="checkbox"> Show browser</label>
      <label><input id="debug" type="checkbox"> Debug dump</label>
    </div>

    <div class="row">
      <label>Strategy
        <select id="strategy">
          <option value="auto">auto</option>
          <option value="page_data">page_data</option>
          <option value="dom">dom</option>
          <option value="screenshot">screenshot</option>
        </select>
      </label>
      <label>Parallel documents
        <input id="concurrency" type="number" min="1" max="8" value="4">
      </label>
    </div>
    <label>Chrome executable (optional)
      <input id="browser_path" type="text" placeholder="C:\Program Files\Google\Chrome\Application\chrome.exe">
    </label>
    <div class="checks">
      <label><input id="collate" type="checkbox" checked> Collate each document into one PDF</label>
      <label><input id="discard_pages" type="checkbox"> Delete page images after collating</label>
      <label><input id="save_room" type="checkbox" checked> Remember this room</label>
      <label><input id="save_passcode" type="checkbox"> Also store passcode</label>
    </div>
    <p class="hint">Deleting the page images leaves the PDFs as the only copy, and Word
    notebooks are built from those images - so leave that box unticked if you want Word files.</p>
    <p class="hint">Stored rooms live in a plain JSON file in your home folder, so leave the
    passcode box unchecked unless the convenience is worth that.</p>

    <div class="actions">
      <button id="run" class="primary">Capture</button>
      <button id="build">Build Word files</button>
      <button id="open">Open folder</button>
    </div>

    <h2 style="margin-top:22px">Saved rooms</h2>
    <ul class="rooms" id="rooms"></ul>
  </section>

  <section class="panel">
    <h2>Progress</h2>
    <div class="status"><span class="dot" id="dot"></span><span id="statusText">Idle</span></div>
    <pre class="log" id="log">Fill in a room and press Capture.

The first run of a new room should keep "List only" checked: it shows every
document it found and its page count without downloading anything, which is how
you confirm nothing is missing before spending the time.</pre>
    <div id="results"></div>
  </section>
</main>
<script>
const TOKEN = "__TOKEN__";
const $ = id => document.getElementById(id);
let polling = null;

const api = async (path, body) => {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json", "X-Dash-Token": TOKEN } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};

const setStatus = (state, text) => {
  $("dot").className = "dot " + (state || "");
  $("statusText").textContent = text;
};

const say = line => {
  const log = $("log");
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
  log.textContent += (log.textContent ? "\n" : "") + line;
  if (atBottom) log.scrollTop = log.scrollHeight;
};

const fields = () => ({
  url: $("url").value, email: $("email").value, passcode: $("passcode").value,
  out: $("out").value, dry_run: $("dry_run").checked, debug: $("debug").checked,
  headed: $("headed").checked, use_session: $("use_session").checked,
  strategy: $("strategy").value, concurrency: Number($("concurrency").value),
  browser_path: $("browser_path").value,
  collate: $("collate").checked, discard_pages: $("discard_pages").checked,
  save_room: $("save_room").checked, save_passcode: $("save_passcode").checked,
  room_name: $("room_name").value,
});

const busy = on => { $("run").disabled = on; $("build").disabled = on; };

const poll = (jobId, label) => {
  let since = 0;
  clearInterval(polling);
  polling = setInterval(async () => {
    const data = await api(`/api/job?id=${jobId}&since=${since}`);
    if (data.error) { clearInterval(polling); busy(false); return; }
    since = data.next;
    (data.lines || []).forEach(say);
    if (data.status !== "running") {
      clearInterval(polling);
      busy(false);
      const ok = data.returncode === 0;
      setStatus(ok ? "done" : "failed", `${label} ${ok ? "finished" : "failed (exit " + data.returncode + ")"}`);
      render(data.manifest, data.word, data.pdf);
      loadRooms();
    }
  }, 700);
};

const render = (manifest, word, pdf) => {
  const box = $("results");
  box.innerHTML = "";
  if (manifest && manifest.documents) {
    const docs = manifest.documents;
    const pages = docs.reduce((n, d) => n + (d.page_count || 0), 0);
    const short = docs.filter(d => d.error).length;
    const h = document.createElement("h2");
    h.style.marginTop = "18px";
    h.textContent = `${docs.length} document(s), ${pages} page(s)` + (short ? ` — ${short} need attention` : "");
    box.appendChild(h);
    const wrap = document.createElement("div");
    wrap.className = "tablewrap";
    wrap.innerHTML = `<table><thead><tr><th>Document</th><th class="num">Pages</th>
      <th class="num">Reported</th><th>Note</th></tr></thead><tbody>${
      docs.map(d => `<tr><td>${esc(d.title || d.id)}</td>
        <td class="num">${d.page_count || 0}</td>
        <td class="num">${d.reported_page_count ?? "?"}</td>
        <td class="${d.error ? "short" : ""}">${esc(d.error || "")}</td></tr>`).join("")
    }</tbody></table>`;
    box.appendChild(wrap);
  }
  fileList(box, pdf, "PDF file(s)");
  fileList(box, word, "Word file(s)");
};

const fileList = (box, files, label) => {
  if (!files || !files.length) return;
  const h = document.createElement("h2");
  h.style.marginTop = "18px";
  h.textContent = `${files.length} ${label}`;
  box.appendChild(h);
  const ul = document.createElement("ul");
  ul.className = "rooms";
  files.forEach(f => {
    const li = document.createElement("li");
    li.innerHTML = `<span style="flex:1">${esc(f.name)}</span><small>${(f.bytes / 1024).toFixed(0)} KB</small>`;
    ul.appendChild(li);
  });
  box.appendChild(ul);
};

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
));

const loadRooms = async () => {
  const { rooms } = await api("/api/rooms");
  const ul = $("rooms");
  ul.innerHTML = "";
  if (!rooms.length) {
    ul.innerHTML = `<li><small>Rooms you capture will be listed here.</small></li>`;
    return;
  }
  rooms.forEach(r => {
    const li = document.createElement("li");
    const pick = document.createElement("button");
    pick.className = "link";
    pick.innerHTML = `${esc(r.name || r.url)}<small>${esc(r.email || "")}</small>`;
    pick.onclick = () => {
      $("url").value = r.url || "";
      $("email").value = r.email || "";
      $("out").value = r.out || $("out").value;
      $("room_name").value = r.name && r.name !== r.url ? r.name : "";
      $("passcode").value = r.passcode || "";
      $("passcode").focus();
    };
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Forget this room";
    del.onclick = async () => { await api("/api/rooms/delete", { url: r.url }); loadRooms(); };
    li.append(pick, del);
    ul.appendChild(li);
  });
};

$("run").onclick = async () => {
  const f = fields();
  if (!f.url || !f.email) { setStatus("failed", "URL and email are required"); return; }
  $("log").textContent = "";
  busy(true);
  setStatus("running", f.dry_run ? "Listing documents…" : "Capturing…");
  const { job, error } = await api("/api/run", f);
  if (error) { setStatus("failed", error); busy(false); return; }
  poll(job, f.dry_run ? "Listing" : "Capture");
};

$("build").onclick = async () => {
  busy(true);
  setStatus("running", "Building Word files…");
  const { job, error } = await api("/api/build", { out: $("out").value });
  if (error) { setStatus("failed", error); busy(false); return; }
  poll(job, "Build");
};

$("open").onclick = () => api("/api/reveal", { path: $("out").value });

loadRooms();
(async () => {
  const data = await api(`/api/capture?out=${encodeURIComponent($("out").value)}`);
  if (data.manifest) render(data.manifest, data.word, data.pdf);
})();
</script>
</body>
</html>
"""


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--no-browser", action="store_true", help="Do not open a browser window")
    args = p.parse_args(argv)

    if not CAPTURE.exists() or not BUILD.exists():
        sys.exit(f"capture_dataroom.py / build_docx.py not found next to {__file__}")

    url = f"http://127.0.0.1:{args.port}/"
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"DocSend Capture dashboard: {url}")
    print("Serving on loopback only. Press Ctrl+C to stop.")
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())

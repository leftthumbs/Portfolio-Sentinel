// JXA helper for export_to_notes.py — creates Apple Notes from a JSON payload.
//
// Run:  osascript -l JavaScript notes_import.js /path/to/payload.json
//
// Payload shape:
//   { "folder": "Room name", "notes": [ { "name": "Doc (1/2)", "html": "<div>…" } ] }
//
// The payload is read from disk rather than argv because the note bodies carry
// base64-embedded page images and would blow past argv size limits.
ObjC.import('Foundation');

function readJSON(path) {
  const s = $.NSString.stringWithContentsOfFileEncodingError(
    $(path), $.NSUTF8StringEncoding, $()
  );
  if (!s.js) throw new Error('could not read payload: ' + path);
  return JSON.parse(s.js);
}

function findOrCreateFolder(Notes, name) {
  const folders = Notes.folders();
  for (let i = 0; i < folders.length; i++) {
    if (folders[i].name() === name) return folders[i];
  }
  const folder = Notes.Folder({ name: name });
  Notes.folders.push(folder);
  return folder;
}

function run(argv) {
  const payload = readJSON(argv[0]);
  const Notes = Application('Notes');
  Notes.includeStandardAdditions = true;

  const folder = findOrCreateFolder(Notes, payload.folder);
  const result = { folder: payload.folder, created: 0, attachments: [], errors: [] };

  payload.notes.forEach(function (spec) {
    try {
      const note = Notes.Note({ name: spec.name, body: spec.html });
      folder.notes.push(note);
      result.created += 1;
      // Notes converts embedded data: images into attachments asynchronously,
      // so give it a beat before counting — a zero count is how the caller
      // detects that this macOS version stripped the images.
      delay(0.6);
      try {
        result.attachments.push(note.attachments().length);
      } catch (e) {
        result.attachments.push(-1);
      }
    } catch (e) {
      result.errors.push(spec.name + ': ' + e.message);
    }
  });

  return JSON.stringify(result);
}

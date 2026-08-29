import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

/**
 * Reads fund documents out of a Gmail label.
 *
 * Fund material arrives as email — monthly reports, quarterly letters, decks —
 * filed under a Gmail label rather than sitting in a Drive folder. The label is
 * the library.
 *
 * This connects over IMAP with an app password rather than through the Gmail
 * API, and that is a deliberate choice forced by the account type:
 *
 *  - A service account cannot read a personal mailbox. Impersonation needs
 *    domain-wide delegation, which requires a Google Workspace admin console;
 *    a personal account has none.
 *  - The OAuth route needs `gmail.readonly`, which Google classes as
 *    restricted. An app left in Testing has its refresh token revoked every
 *    seven days, and moving to production requires verification including a
 *    third-party security audit — disproportionate for one person reading
 *    their own mail.
 *  - An app password needs two-step verification and nothing else. It does not
 *    expire, and it can be revoked from the Google account page at any time.
 *
 * Gmail exposes each label as an IMAP folder, so the label name is the mailbox
 * name. Access is read-only: the connection never sets flags, moves, or
 * deletes, so opening a document here does not mark the email as read.
 */

export const DEFAULT_LABEL = "Investment Library";
const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;

/** Document types worth pulling in. Everything else in the mailbox is ignored. */
export const DOCUMENT_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".docx", ".doc", ".csv"];

export interface LibraryConfig {
  user: string;
  appPassword: string;
  label: string;
}

export function requireLibraryConfig(): LibraryConfig {
  const user = process.env.GMAIL_USER;
  const appPassword = process.env.GMAIL_APP_PASSWORD;

  const missing = [!user && "GMAIL_USER", !appPassword && "GMAIL_APP_PASSWORD"].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Investment Library is not configured. Missing ${missing.join(", ")}. Turn on 2-Step Verification for the Google account, create an app password at myaccount.google.com/apppasswords, and set these variables.`,
    );
  }

  return {
    user: user!,
    // Google displays app passwords in four groups of four for readability;
    // the spaces are presentation, not part of the credential, and pasting
    // them verbatim is the most common reason a correct password is rejected.
    appPassword: appPassword!.replace(/\s+/g, ""),
    label: process.env.GMAIL_LIBRARY_LABEL || DEFAULT_LABEL,
  };
}

/** True when a filename looks like a document rather than a signature image. */
export function isDocumentAttachment(filename: string | undefined | null): boolean {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export interface LibraryAttachment {
  filename: string;
  mimeType: string;
  size: number;
}

export interface LibraryMessage {
  /** IMAP UID, stable within the mailbox, used to fetch the attachment later. */
  uid: number;
  subject: string;
  /** Display name where the sender gave one, otherwise the bare address. */
  from: string;
  fromAddress: string;
  date: string;
  attachments: LibraryAttachment[];
  /** DocSend links found in the body; these carry material no attachment does. */
  docSendLinks: string[];
}

/**
 * Pulls DocSend links out of a message body.
 *
 * Managers increasingly send a view-only DocSend room instead of attaching a
 * deck, so a library built only from attachments would silently miss them.
 * The repo already has a skill that captures those rooms, and surfacing the
 * link is what lets the two meet.
 */
export function extractDocSendLinks(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/(?:www\.)?docsend\.com\/[^\s"'<>)\]]+/gi) ?? [];
  const cleaned = matches.map((m) => m.replace(/[.,;:]+$/, ""));
  return Array.from(new Set(cleaned));
}

async function connect(config: LibraryConfig): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
    logger: false,
  });

  try {
    await client.connect();
  } catch (error: any) {
    // Gmail's IMAP rejection is terse and names neither cause.
    if (/AUTHENTICATIONFAILED|Invalid credentials/i.test(error?.message ?? "")) {
      throw new Error(
        "Investment Library sign-in was rejected. Check that GMAIL_APP_PASSWORD is an app password rather than the account password, that 2-Step Verification is on, and that GMAIL_USER is the address the label belongs to.",
      );
    }
    throw error;
  }
  return client;
}

/**
 * Lists messages in the label that carry something worth reading — an
 * attachment or a DocSend link.
 *
 * `limit` counts back from the most recent, since a library of several hundred
 * threads is browsed from the top.
 */
export async function listLibraryMessages(limit = 50): Promise<LibraryMessage[]> {
  const config = requireLibraryConfig();
  const client = await connect(config);

  try {
    // Read-only: opening a document must not mark the email as read.
    const lock = await client.getMailboxLock(config.label, { readOnly: true });
    try {
      const status = client.mailbox;
      if (!status || typeof status === "boolean") return [];

      const total = status.exists;
      if (total === 0) return [];

      const start = Math.max(1, total - limit + 1);
      const messages: LibraryMessage[] = [];

      for await (const message of client.fetch(`${start}:*`, {
        uid: true,
        envelope: true,
        source: true,
      })) {
        const parsed = await simpleParser(message.source as Buffer);

        const attachments = (parsed.attachments ?? [])
          .filter((a) => isDocumentAttachment(a.filename))
          .map((a) => ({
            filename: a.filename!,
            mimeType: a.contentType,
            size: a.size,
          }));

        const docSendLinks = extractDocSendLinks(
          `${parsed.text ?? ""}\n${parsed.html || ""}`,
        );

        if (attachments.length === 0 && docSendLinks.length === 0) continue;

        const sender = parsed.from?.value?.[0];
        messages.push({
          uid: message.uid,
          subject: parsed.subject ?? "(no subject)",
          from: sender?.name || sender?.address || "Unknown",
          fromAddress: sender?.address ?? "",
          date: (parsed.date ?? new Date()).toISOString(),
          attachments,
          docSendLinks,
        });
      }

      return messages.reverse();
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/** Fetches one attachment by the message UID and filename shown in the list. */
export async function downloadLibraryAttachment(
  uid: number,
  filename: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const config = requireLibraryConfig();
  const client = await connect(config);

  try {
    const lock = await client.getMailboxLock(config.label, { readOnly: true });
    try {
      const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!message || !message.source) {
        throw new Error("That message is no longer in the Investment Library label.");
      }

      const parsed = await simpleParser(message.source as Buffer);
      const found = (parsed.attachments ?? []).find((a) => a.filename === filename);
      if (!found) {
        throw new Error(`No attachment named "${filename}" on that message.`);
      }

      // Refuse anything outside the document types the list would have shown,
      // so a crafted filename cannot pull an executable out of the mailbox.
      if (!isDocumentAttachment(found.filename)) {
        throw new Error(`"${filename}" is not a document type this library handles.`);
      }

      return {
        buffer: found.content as Buffer,
        mimeType: found.contentType,
        filename: found.filename!,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

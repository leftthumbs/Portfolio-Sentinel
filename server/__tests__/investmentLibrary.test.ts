import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL,
  DOCUMENT_EXTENSIONS,
  extractDocSendLinks,
  isDocumentAttachment,
  requireLibraryConfig,
} from "../investmentLibrary";

describe("configuration", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["GMAIL_USER", "GMAIL_APP_PASSWORD", "GMAIL_LIBRARY_LABEL"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const configure = () => {
    process.env.GMAIL_USER = "someone@gmail.com";
    process.env.GMAIL_APP_PASSWORD = "abcdefghijklmnop";
    delete process.env.GMAIL_LIBRARY_LABEL;
  };

  it("returns the configuration once both variables are set", () => {
    configure();
    expect(requireLibraryConfig()).toEqual({
      user: "someone@gmail.com",
      appPassword: "abcdefghijklmnop",
      label: DEFAULT_LABEL,
    });
  });

  // Google shows app passwords as four groups of four. The spaces are there to
  // make them readable, and pasting them verbatim is the most common reason a
  // correct password is rejected.
  it("strips the spaces Google displays in an app password", () => {
    configure();
    process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
    expect(requireLibraryConfig().appPassword).toBe("abcdefghijklmnop");
  });

  it("tolerates a trailing newline from a copy and paste", () => {
    configure();
    process.env.GMAIL_APP_PASSWORD = " abcd efgh ijkl mnop\n";
    expect(requireLibraryConfig().appPassword).toBe("abcdefghijklmnop");
  });

  it("defaults to the Investment Library label", () => {
    configure();
    expect(requireLibraryConfig().label).toBe("Investment Library");
  });

  it("allows a different label to be named", () => {
    configure();
    process.env.GMAIL_LIBRARY_LABEL = "Fund Reports";
    expect(requireLibraryConfig().label).toBe("Fund Reports");
  });

  it.each(["GMAIL_USER", "GMAIL_APP_PASSWORD"])("names %s when it is missing", (missing) => {
    configure();
    delete process.env[missing];
    expect(() => requireLibraryConfig()).toThrow(new RegExp(missing));
  });

  it("explains where an app password comes from", () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    expect(() => requireLibraryConfig()).toThrow(/2-Step Verification/);
    expect(() => requireLibraryConfig()).toThrow(/apppasswords/);
  });
});

describe("attachment filtering", () => {
  it.each([
    "Arini Credit Master Fund - Monthly Report.pdf",
    "Q2 Performance.XLSX",
    "tearsheet.docx",
    "returns.csv",
    "legacy.xls",
    "memo.doc",
  ])("accepts %s", (name) => {
    expect(isDocumentAttachment(name)).toBe(true);
  });

  // A mailbox is full of signature logos and tracking pixels, and a library
  // that ingested them would bury the documents.
  it.each([
    "signature-logo.png",
    "spacer.gif",
    "headshot.jpeg",
    "calendar-invite.ics",
    "winmail.dat",
    "deck.pdf.exe",
  ])("rejects %s", (name) => {
    expect(isDocumentAttachment(name)).toBe(false);
  });

  it.each([undefined, null, ""])("rejects a missing filename (%s)", (name) => {
    expect(isDocumentAttachment(name as string)).toBe(false);
  });

  it("is case-insensitive about the extension", () => {
    expect(isDocumentAttachment("REPORT.PDF")).toBe(true);
  });

  it("matches only at the end of the name", () => {
    expect(isDocumentAttachment("pdf-summary-notes.txt")).toBe(false);
  });

  it("covers the document types fund managers actually send", () => {
    expect(DOCUMENT_EXTENSIONS).toContain(".pdf");
    expect(DOCUMENT_EXTENSIONS).toContain(".xlsx");
  });
});

describe("DocSend links", () => {
  // Managers increasingly send a view-only room rather than an attachment, so
  // a library built from attachments alone would silently miss them. This repo
  // already has a skill that captures those rooms.
  it("finds a link in a plain-text body", () => {
    expect(extractDocSendLinks(
      "Hey Bong, Here's the fund deck: https://docsend.com/view/6itcycwu55cmzh8x (attached as a PDF as well)",
    )).toEqual(["https://docsend.com/view/6itcycwu55cmzh8x"]);
  });

  it("finds a link inside HTML markup", () => {
    expect(extractDocSendLinks(
      '<p>Deck: <a href="https://docsend.com/view/s/abc123def">here</a></p>',
    )).toEqual(["https://docsend.com/view/s/abc123def"]);
  });

  it("does not repeat a link that appears twice", () => {
    const body = "See https://docsend.com/view/abc and again https://docsend.com/view/abc";
    expect(extractDocSendLinks(body)).toHaveLength(1);
  });

  it("returns several distinct links", () => {
    const links = extractDocSendLinks(
      "Fund deck https://docsend.com/view/aaa and the summary https://docsend.com/view/bbb",
    );
    expect(links).toHaveLength(2);
  });

  it("drops sentence punctuation that follows a link", () => {
    expect(extractDocSendLinks("The deck is at https://docsend.com/view/abc123."))
      .toEqual(["https://docsend.com/view/abc123"]);
  });

  it("accepts the www form and http", () => {
    expect(extractDocSendLinks("http://www.docsend.com/view/xyz"))
      .toEqual(["http://www.docsend.com/view/xyz"]);
  });

  it("ignores other links in the same message", () => {
    expect(extractDocSendLinks(
      "Our site https://arini.com and the deck https://docsend.com/view/abc",
    )).toEqual(["https://docsend.com/view/abc"]);
  });

  it("is not fooled by a lookalike domain", () => {
    expect(extractDocSendLinks("https://notdocsend.com.evil.example/view/abc")).toEqual([]);
  });

  it.each(["", "No links here at all."])("returns nothing for %s", (body) => {
    expect(extractDocSendLinks(body)).toEqual([]);
  });
});

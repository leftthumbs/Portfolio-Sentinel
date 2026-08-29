/**
 * `npm run check-setup` — tells you what is configured, what is not, and what
 * to do about each thing.
 *
 * The failure mode this exists to kill: a missing or mistyped setting produces
 * a blank page or an empty list, with the reason buried in a server log nobody
 * reads. Every check here either passes or says exactly which value is wrong
 * and where to get a correct one.
 *
 * Safe to run repeatedly. It reads and connects; it never writes to the
 * database or sends anything.
 */
import "dotenv/config";
import { existsSync, copyFileSync } from "fs";
import { Pool } from "pg";
import { randomBytes } from "crypto";

type Status = "ok" | "warn" | "fail";

interface Result {
  label: string;
  status: Status;
  detail: string;
  fix?: string;
  /** Required settings stop the app booting; optional ones only switch a feature off. */
  required: boolean;
}

const results: Result[] = [];
const add = (label: string, status: Status, detail: string, fix?: string, required = true) =>
  results.push({ label, status, detail, fix, required });
const addOptional = (label: string, status: Status, detail: string, fix?: string) =>
  add(label, status, detail, fix, false);

const GREEN = "\x1b[32m", AMBER = "\x1b[33m", RED = "\x1b[31m";
const DIM = "\x1b[2m", BOLD = "\x1b[1m", RESET = "\x1b[0m";
const mark = (s: Status) =>
  s === "ok" ? `${GREEN}✓${RESET}` : s === "warn" ? `${AMBER}○${RESET}` : `${RED}✗${RESET}`;

async function checkEnvFile() {
  if (existsSync(".env")) {
    add("Settings file", "ok", ".env found");
    return;
  }
  if (existsSync(".env.example")) {
    copyFileSync(".env.example", ".env");
    add("Settings file", "fail", ".env did not exist, so a blank one was created from the template",
        "Open .env and fill in DATABASE_URL, SESSION_SECRET and OPENAI_API_KEY, then run this again.");
    return;
  }
  add("Settings file", "fail", "Neither .env nor .env.example is present",
      "You may be running this from the wrong folder. Change to the project folder first.");
}

async function checkDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    add("Database", "fail", "DATABASE_URL is not set",
        "Put your database connection string in .env. A free hosted Postgres from neon.tech takes about two minutes to create and gives you a string starting postgresql://");
    return;
  }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    add("Database", "fail", "DATABASE_URL does not look like a Postgres connection string",
        "It should start with postgresql:// — check you pasted the whole thing.");
    return;
  }

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const tables = rows[0].n as number;
    if (tables === 0) {
      add("Database", "warn", "Connected, but it is empty",
          "Run: npm run db:push — this creates the tables. It is safe and takes a few seconds.");
    } else {
      add("Database", "ok", `Connected, ${tables} tables present`);
    }
  } catch (e: any) {
    add("Database", "fail", `Could not connect — ${e.message}`,
        "Check the connection string is complete and that the database is running. Hosted databases sometimes need ?sslmode=require on the end.");
  } finally {
    await pool.end().catch(() => {});
  }
}

function checkSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  // Suggesting `openssl rand` sent Windows users looking for a command they do
  // not have. Node is by definition present -- this script is running on it --
  // so generate the value here and let them paste it.
  const suggestion = `Use this one: ${randomBytes(32).toString("base64")}`;
  if (!secret) {
    add("Login security", "fail", "SESSION_SECRET is not set", suggestion);
  } else if (secret.length < 16) {
    add("Login security", "warn", "SESSION_SECRET is short enough to be guessable",
        `Replace it with something longer. ${suggestion}`);
  } else {
    add("Login security", "ok", "SESSION_SECRET is set");
  }
}

function checkOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    add("AI memo drafting", "fail", "OPENAI_API_KEY is not set — the app will not start at all without it",
        "Get a key from platform.openai.com. It is needed even for pages that never use AI, because the client is built when the app starts.");
  } else if (!key.startsWith("sk-")) {
    add("AI memo drafting", "warn", "OPENAI_API_KEY does not start with sk-, which is unusual",
        "Check you copied the API key rather than an organisation or project id.");
  } else {
    add("AI memo drafting", "ok", "OPENAI_API_KEY is set");
  }
}

async function checkInvestmentLibrary() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const label = process.env.GMAIL_LIBRARY_LABEL || "Investment Library";

  if (!user && !pass) {
    addOptional("Investment Library (Gmail)", "warn", "Not configured — this feature is switched off",
        "Optional. To switch it on: turn on 2-Step Verification, create an app password at myaccount.google.com/apppasswords, and set GMAIL_USER and GMAIL_APP_PASSWORD.");
    return;
  }
  if (!user || !pass) {
    addOptional("Investment Library (Gmail)", "fail", `Half configured — ${user ? "GMAIL_APP_PASSWORD" : "GMAIL_USER"} is missing`,
        "Both values are needed together.");
    return;
  }

  const cleaned = pass.replace(/\s+/g, "");
  const lengthHint = cleaned.length !== 16
    ? ` GMAIL_APP_PASSWORD is ${cleaned.length} characters, and Google app passwords are 16 — you may have pasted the account password.`
    : "";

  try {
    const { ImapFlow } = await import("imapflow");
    const client = new ImapFlow({
      host: "imap.gmail.com", port: 993, secure: true,
      auth: { user, pass: cleaned }, logger: false,
    });
    await client.connect();
    try {
      const box = await client.status(label, { messages: true });
      addOptional("Investment Library (Gmail)", "ok",
          `Signed in as ${user}; label "${label}" holds ${box.messages ?? 0} messages`);
    } catch {
      const names: string[] = [];
      for await (const b of client.list()) names.push(b.path);
      addOptional("Investment Library (Gmail)", "fail",
          `Signed in, but no label called "${label}"`,
          `Labels found: ${names.slice(0, 12).join(", ")}${names.length > 12 ? "…" : ""}. Set GMAIL_LIBRARY_LABEL to the exact name.`);
    }
    await client.logout().catch(() => {});
  } catch (e: any) {
    const auth = /AUTHENTICATIONFAILED|Invalid credentials/i.test(e?.message ?? "");
    addOptional("Investment Library (Gmail)", "fail",
        auth ? "Google rejected the sign-in" : `Could not reach Gmail — ${e.message}`,
        auth
          ? `Create one at myaccount.google.com/apppasswords with 2-Step Verification switched on.${lengthHint}`
          : `Check your internet connection. Some corporate networks block IMAP on port 993.${lengthHint}`);
  }
}

async function checkOneDrive() {
  const vars = {
    AZURE_TENANT_ID: process.env.AZURE_TENANT_ID,
    AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET,
    ONEDRIVE_USER: process.env.ONEDRIVE_USER,
  };
  const missing = Object.entries(vars).filter(([, v]) => !v).map(([k]) => k);

  if (missing.length === 4) {
    addOptional("OneDrive", "warn", "Not configured — this feature is switched off",
        "Optional. Needs an app registration in Microsoft Entra ID with the Files.Read.All application permission and admin consent.");
    return;
  }
  if (missing.length > 0) {
    addOptional("OneDrive", "fail", `Half configured — missing ${missing.join(", ")}`,
        "All four values are needed together.");
    return;
  }

  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(vars.AZURE_TENANT_ID!)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: vars.AZURE_CLIENT_ID!,
          client_secret: vars.AZURE_CLIENT_SECRET!,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      },
    );
    if (res.ok) {
      addOptional("OneDrive", "ok", `Microsoft accepted the credentials; reading ${vars.ONEDRIVE_USER}'s drive`);
    } else {
      const body = await res.text().catch(() => "");
      const consent = /consent|AADSTS65001/i.test(body);
      addOptional("OneDrive", "fail", `Microsoft rejected the credentials (${res.status})`,
          consent
            ? "Admin consent has not been granted. In Entra ID → your app → API permissions, click Grant admin consent."
            : "Check AZURE_CLIENT_SECRET is the secret Value rather than the Secret ID, and that it has not expired.");
    }
  } catch (e: any) {
    addOptional("OneDrive", "fail", `Could not reach Microsoft — ${e.message}`, "Check your internet connection.");
  }
}

function checkMarketData() {
  const optional: [string, string, string][] = [
    ["ALPHA_VANTAGE_API_KEY", "Market prices", "Free key from alphavantage.co. Without it, price and ETF lookups are unavailable."],
    ["FRED_API_KEY", "Risk-free rate", "Free key from fred.stlouisfed.org. Without it, the app falls back to a default rate."],
    ["OPENFIGI_API_KEY", "Ticker lookup", "Free key from openfigi.com. Without it, ticker search is unavailable."],
  ];
  for (const [name, label, fix] of optional) {
    if (process.env[name]) addOptional(label, "ok", `${name} is set`);
    else addOptional(label, "warn", `${name} is not set`, `Optional. ${fix}`);
  }
}

async function main() {
  console.log(`\n${BOLD}InvestIQ setup check${RESET}\n`);

  await checkEnvFile();
  await checkDatabase();
  checkSessionSecret();
  checkOpenAI();
  await checkInvestmentLibrary();
  await checkOneDrive();
  checkMarketData();

  const width = Math.max(...results.map((r) => r.label.length));
  for (const r of results) {
    console.log(`  ${mark(r.status)} ${r.label.padEnd(width)}  ${r.detail}`);
    if (r.fix && r.status !== "ok") console.log(`    ${DIM}→ ${r.fix}${RESET}`);
  }

  const blocking = results.filter((r) => r.status === "fail" && r.required).length;
  const brokenOptional = results.filter((r) => r.status === "fail" && !r.required).length;
  const off = results.filter((r) => r.status === "warn").length;

  console.log("");
  if (blocking > 0) {
    console.log(`${RED}${blocking} thing${blocking === 1 ? "" : "s"} must be fixed before the app will start.${RESET}`);
    console.log(`${DIM}Fix the ✗ items above, then run this again.${RESET}\n`);
    process.exit(1);
  }

  console.log(`${GREEN}The app will start.${RESET}`);
  if (brokenOptional > 0) {
    console.log(`${AMBER}${brokenOptional} optional feature${brokenOptional === 1 ? " is" : "s are"} configured but not working${RESET} — see the ✗ items. Everything else works without them.`);
  }
  if (off > 0) {
    console.log(`${DIM}${off} optional feature${off === 1 ? " is" : "s are"} switched off (○). That is fine.${RESET}`);
  }
  console.log(`${DIM}Start the app with:  npm run dev${RESET}\n`);
}

main().catch((e) => {
  console.error("\nThe setup check itself failed:", e);
  process.exit(1);
});

import { afterEach, describe, expect, it } from "vitest";
import { DRIVE_SCOPES, parseServiceAccountJson } from "../gmail";
import { driveRoot, requireGraphConfig } from "../onedrive";

const KEY = {
  type: "service_account",
  project_id: "investiq",
  client_email: "investiq-drive@investiq.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nLINE1\nLINE2\n-----END PRIVATE KEY-----\n",
};

describe("Google service account credentials", () => {
  it("parses a raw JSON key", () => {
    const c = parseServiceAccountJson(JSON.stringify(KEY));
    expect(c.client_email).toBe(KEY.client_email);
    expect(c.private_key).toContain("BEGIN PRIVATE KEY");
  });

  it("parses a base64-encoded key", () => {
    const encoded = Buffer.from(JSON.stringify(KEY)).toString("base64");
    expect(parseServiceAccountJson(encoded).client_email).toBe(KEY.client_email);
  });

  // The failure that costs an afternoon: a key pasted into an environment
  // variable arrives with its newlines escaped, and the JWT signer rejects it
  // with an error that names neither the variable nor the cause.
  it("restores newlines escaped into the private key", () => {
    const escaped = JSON.stringify(KEY).replace(/\\n/g, "\\\\n");
    const c = parseServiceAccountJson(escaped);
    expect(c.private_key).toContain("\n");
    expect(c.private_key).not.toContain("\\n");
    expect(c.private_key.split("\n").length).toBeGreaterThan(3);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseServiceAccountJson(`\n  ${JSON.stringify(KEY)}  \n`).client_email)
      .toBe(KEY.client_email);
  });

  it("says what is wrong when the value is not JSON", () => {
    expect(() => parseServiceAccountJson("clearly not json"))
      .toThrow(/not valid JSON/i);
  });

  // Downloading the wrong file from the Cloud console is an easy mistake, and
  // an OAuth client file parses fine while carrying neither field.
  it("rejects an OAuth client file rather than failing later", () => {
    const oauthClientFile = JSON.stringify({
      installed: { client_id: "x.apps.googleusercontent.com", client_secret: "y" },
    });
    expect(() => parseServiceAccountJson(oauthClientFile))
      .toThrow(/client_email or private_key/);
  });

  it("names the service account key file in that message", () => {
    expect(() => parseServiceAccountJson("{}"))
      .toThrow(/service account key file, not the OAuth client file/);
  });

  it("asks only for read access", () => {
    expect(DRIVE_SCOPES).toEqual(["https://www.googleapis.com/auth/drive.readonly"]);
  });
});

describe("Microsoft Graph configuration", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "ONEDRIVE_USER"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const configure = () => {
    process.env.AZURE_TENANT_ID = "tenant";
    process.env.AZURE_CLIENT_ID = "client";
    process.env.AZURE_CLIENT_SECRET = "secret";
    process.env.ONEDRIVE_USER = "library@example.com";
  };

  it("returns the configuration once every variable is set", () => {
    configure();
    expect(requireGraphConfig()).toEqual({
      tenantId: "tenant", clientId: "client", clientSecret: "secret",
      user: "library@example.com",
    });
  });

  it.each(["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "ONEDRIVE_USER"])(
    "names %s when it is the one missing",
    (missing) => {
      configure();
      delete process.env[missing];
      expect(() => requireGraphConfig()).toThrow(new RegExp(missing));
    },
  );

  it("lists every missing variable at once rather than one per attempt", () => {
    for (const k of ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "ONEDRIVE_USER"]) {
      delete process.env[k];
    }
    const message = (() => { try { requireGraphConfig(); return ""; } catch (e) { return (e as Error).message; } })();
    for (const k of ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "ONEDRIVE_USER"]) {
      expect(message).toContain(k);
    }
  });

  it("explains that admin consent is part of the setup", () => {
    for (const k of ["AZURE_TENANT_ID"]) delete process.env[k];
    expect(() => requireGraphConfig()).toThrow(/admin consent/i);
  });
});

describe("Graph drive addressing", () => {
  // Under application permissions there is no signed-in user, so /me does not
  // resolve and every request returns 400. Each call has to name the drive.
  it("addresses the drive by user rather than by /me", () => {
    expect(driveRoot("library@example.com")).toBe("/users/library%40example.com/drive");
    expect(driveRoot("library@example.com")).not.toContain("/me");
  });

  it("escapes a user principal name so it survives the URL", () => {
    expect(driveRoot("first.last+tag@example.com"))
      .toBe("/users/first.last%2Btag%40example.com/drive");
  });

  it("accepts an object id as readily as a UPN", () => {
    const oid = "8f4e2c1a-0000-4b6d-9f3e-1234567890ab";
    expect(driveRoot(oid)).toBe(`/users/${oid}/drive`);
  });
});

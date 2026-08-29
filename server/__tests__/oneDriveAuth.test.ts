import { afterEach, describe, expect, it } from "vitest";
import { driveRoot, requireGraphConfig } from "../onedrive";

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

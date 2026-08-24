import { describe, expect, it } from "vitest";
import { publicUser } from "../auth";

describe("publicUser", () => {
  const user = {
    id: "384d4c92-1313-4b0a-9aae-d66098e18bbd",
    username: "leftthumbs",
    password: "2366fab6…hash.b9f5ba547fecd0dd56ba2aa9da5f12fd",
  } as any;

  // Passport puts the whole row on req.user, so returning it directly hands
  // the scrypt hash and salt to the browser on every session check.
  it("removes the credential", () => {
    expect(publicUser(user)).not.toHaveProperty("password");
  });

  it("keeps the fields a client actually needs", () => {
    expect(publicUser(user)).toEqual({ id: user.id, username: "leftthumbs" });
  });

  it("does not mutate the row it was given", () => {
    publicUser(user);
    expect(user.password).toBeTruthy();
  });

  it("leaves no hash anywhere in the serialized payload", () => {
    expect(JSON.stringify(publicUser(user))).not.toMatch(/2366fab6|b9f5ba54/);
  });
});

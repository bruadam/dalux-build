import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBaseUrl } from "../src/lib/daluxUrl";
import { toUserEntry } from "../src/lib/users";

test("toUserEntry builds a name, falls back to email, and adds the company", () => {
  const companies = new Map([["c1", "Builder A/S"]]);
  assert.deepEqual(toUserEntry({ userId: "u1", email: "a@b.dk", firstName: "Ann", lastName: null, companyId: "c1" }, companies), {
    userId: "u1",
    name: "Ann",
    email: "a@b.dk",
    userType: undefined,
    companyId: "c1",
    companyName: "Builder A/S",
  });
  assert.equal(toUserEntry({ userId: "u2", email: "x@y.dk" }, companies).name, "x@y.dk");
});

test("validateBaseUrl only accepts https Dalux hosts and trims the trailing slash", () => {
  assert.deepEqual(validateBaseUrl(" https://node1.field.dalux.com/service/api/ "), {
    baseUrl: "https://node1.field.dalux.com/service/api",
  });
  assert.ok("error" in validateBaseUrl("http://node1.field.dalux.com"));
  assert.ok("error" in validateBaseUrl("https://dalux.com.evil.io"));
  assert.ok("error" in validateBaseUrl("not a url"));
});

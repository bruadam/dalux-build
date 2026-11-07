import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBaseUrl } from "../src/lib/daluxUrl";
import { toUserEntry } from "../src/lib/users";

test("toUserEntry builds a name, falls back to email, and adds the company", () => {
  const companies = new Map([
    ["c1", { companyId: "c1", name: "Builder A/S", vatNumber: "DK123", address: "Vej 1", postalCode: "8000", city: "Aarhus", country: null }],
  ]);
  assert.deepEqual(toUserEntry({ userId: "u1", email: "a@b.dk", firstName: "Ann", lastName: null, companyId: "c1" }, companies), {
    userId: "u1",
    name: "Ann",
    email: "a@b.dk",
    userType: undefined,
    companyId: "c1",
    companyName: "Builder A/S",
    companyVatNumber: "DK123",
    companyAddress: "Vej 1, 8000 Aarhus",
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

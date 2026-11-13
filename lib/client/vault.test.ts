import assert from "node:assert/strict";
import { test } from "node:test";
import { open, seal } from "./vault.ts";

test("a backup opens with its passphrase and with nothing else", async () => {
  const secret = { "finn.network.v1": JSON.stringify({ contacts: [{ name: "Rhea Kapadia" }] }) };
  const blob = await seal(secret, "correct horse battery staple");
  assert.ok(!blob.includes("Rhea") && !blob.includes("contacts"));
  assert.deepEqual(await open(blob, "correct horse battery staple"), secret);
  await assert.rejects(open(blob, "correct horse battery stapl"), /Wrong passphrase/);
  const f = JSON.parse(blob); f.ct = f.ct.slice(0, -4) + (f.ct.endsWith("AAAA") ? "BBBB" : "AAAA");
  await assert.rejects(open(JSON.stringify(f), "correct horse battery staple"), /altered/);
  assert.notEqual(await seal(secret, "p"), await seal(secret, "p"));   // fresh salt and IV every time
  await assert.rejects(open("hello", "p"), /not a FINN backup/);
});

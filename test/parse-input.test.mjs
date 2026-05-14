import test from "node:test";
import assert from "node:assert/strict";

import { parseInput } from "../skills/helius-top-volume/scripts/helius_top_volume.mjs";

test("parseInput supports top-volume aliases without network calls", () => {
  for (const input of ["helius top-volume", "helius top-volume-24h", "helius top", "helius top10", "helius list"]) {
    const parsed = parseInput(input);

    assert.equal(parsed.command, "top-volume", input);
    assert.equal(parsed.count, 10, input);
    assert.equal(parsed.minVolume, 0, input);
    assert.equal(parsed.format, "text", input);
  }
});

test("parseInput infers count from scan aliases", () => {
  assert.equal(parseInput("helius scan 10").count, 10);
  assert.equal(parseInput("/helius scan 7").count, 7);
  assert.equal(parseInput("helius list 3").count, 3);
});

test("parseInput handles JSON format and minimum volume", () => {
  const parsed = parseInput("helius top-volume --format json --min-volume 100000.50");

  assert.equal(parsed.command, "top-volume");
  assert.equal(parsed.format, "json");
  assert.equal(parsed.minVolume, 100000.5);
});

test("parseInput clamps count and minimum volume", () => {
  assert.equal(parseInput("helius top-volume --count 0").count, 1);
  assert.equal(parseInput("helius top-volume --count 250").count, 100);
  assert.equal(parseInput("helius top-volume --count 12.9").count, 12);
  assert.equal(parseInput("helius top-volume --min-volume -25").minVolume, 0);
});

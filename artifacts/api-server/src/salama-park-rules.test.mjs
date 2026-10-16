import assert from "node:assert/strict";
import test from "node:test";
import { calculatePetitionThresholds } from "./salama-park-rules.ts";

test("calculates the published example thresholds for 350 members", () => {
  assert.deepEqual(calculatePetitionThresholds(350, 100), {
    twoThirdsThreshold: 234,
    minimumQuorum: 88,
    signaturesRemaining: 134,
    thresholdReached: false,
    supportPercentage: (100 / 350) * 100,
  });
});

test("does not invent thresholds before a verified denominator exists", () => {
  assert.deepEqual(calculatePetitionThresholds(null, 4), {
    twoThirdsThreshold: null,
    minimumQuorum: null,
    signaturesRemaining: null,
    thresholdReached: null,
    supportPercentage: null,
  });
});

test("reports the threshold as reached without converting that count into an adoption decision", () => {
  assert.equal(calculatePetitionThresholds(350, 234).thresholdReached, true);
  assert.equal(calculatePetitionThresholds(350, 234).signaturesRemaining, 0);
});

test("rejects invalid register denominators and signature counts", () => {
  assert.throws(() => calculatePetitionThresholds(0, 0), RangeError);
  assert.throws(() => calculatePetitionThresholds(-1, 0), RangeError);
  assert.throws(() => calculatePetitionThresholds(350, -1), RangeError);
});

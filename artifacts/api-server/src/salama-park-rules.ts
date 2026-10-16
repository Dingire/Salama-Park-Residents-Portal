export type PetitionThresholds = {
  twoThirdsThreshold: number | null;
  minimumQuorum: number | null;
  signaturesRemaining: number | null;
  thresholdReached: boolean | null;
  supportPercentage: number | null;
};

export function calculatePetitionThresholds(
  denominator: number | null,
  acceptedSignatures: number,
): PetitionThresholds {
  if (!Number.isSafeInteger(acceptedSignatures) || acceptedSignatures < 0) {
    throw new RangeError("Accepted petition signatures must be a non-negative integer.");
  }
  if (denominator === null) {
    return {
      twoThirdsThreshold: null,
      minimumQuorum: null,
      signaturesRemaining: null,
      thresholdReached: null,
      supportPercentage: null,
    };
  }
  if (!Number.isSafeInteger(denominator) || denominator < 1) {
    throw new RangeError("The verified membership denominator must be a positive integer.");
  }

  const twoThirdsThreshold = Math.ceil((2 * denominator) / 3);
  return {
    twoThirdsThreshold,
    minimumQuorum: Math.ceil(denominator * 0.25),
    signaturesRemaining: Math.max(0, twoThirdsThreshold - acceptedSignatures),
    thresholdReached: acceptedSignatures >= twoThirdsThreshold,
    supportPercentage: (acceptedSignatures / denominator) * 100,
  };
}

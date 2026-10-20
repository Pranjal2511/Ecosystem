const FINGERPRINT_RE = /^[a-f0-9]{64}$/;

export function normalizeFingerprint(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

export function isFingerprintFormat(value: string | undefined | null): boolean {
  return FINGERPRINT_RE.test(normalizeFingerprint(value));
}

export function fingerprintsMatch(expected: string | undefined | null, actual: string | undefined | null): boolean {
  const left = normalizeFingerprint(expected);
  const right = normalizeFingerprint(actual);
  return isFingerprintFormat(left) && isFingerprintFormat(right) && left === right;
}

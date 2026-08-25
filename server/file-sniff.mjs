/**
 * Magic-byte content sniffing for uploaded document pages. The client only
 * gates uploads by the browser-reported `File.type` (attacker-controllable —
 * trivial to spoof), so the server must check the actual bytes before
 * accepting something as an image.
 */
const SIGNATURES = [
  { mime: "image/jpeg", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  { mime: "image/gif", test: (b) => b.length >= 4 && b.toString("ascii", 0, 4) === "GIF8" },
  {
    mime: "image/webp",
    test: (b) => b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  },
  { mime: "image/bmp", test: (b) => b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d },
  {
    // HEIC/HEIF (common on iPhone photos): an ISO base media file with an
    // `ftyp` box whose major brand names a HEIC/HEIF variant.
    mime: "image/heic",
    test: (b) =>
      b.length >= 12 &&
      b.toString("ascii", 4, 8) === "ftyp" &&
      /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/.test(b.toString("ascii", 8, 12)),
  },
];

/** Returns the detected image mime type, or null if `buffer` doesn't match
 *  any known image signature. */
export function sniffImageMime(buffer) {
  for (const { mime, test } of SIGNATURES) {
    if (test(buffer)) return mime;
  }
  return null;
}

/** True if `buffer`'s actual bytes are a recognized image format — the
 *  declared `Content-Type`/`mime_type` is not trusted on its own. */
export function isImageContent(buffer) {
  return sniffImageMime(buffer) !== null;
}

/**
 * SSRF guard for outbound scrape targets (server/steps/scrape.mjs, called
 * from research.mjs's objective-embedded URLs and extractTargetRules.mjs's
 * confirmed candidate URL). Neither call site's URL is fully caller-chosen in
 * the direct sense, but both trace back to free-text/search input, so the
 * Firecrawl proxy should never be pointed at loopback/private/link-local
 * infrastructure — including the 169.254.169.254 cloud metadata address,
 * which link-local covers.
 */
import dns from "node:dns/promises";
import net from "node:net";

const V4_PRIVATE_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT — also used by some internal overlays (e.g. Tailscale)
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];

function ipv4ToLong(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateV4(ip) {
  const long = ipv4ToLong(ip);
  return V4_PRIVATE_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (long & mask) === (ipv4ToLong(base) & mask);
  });
}

function isPrivateV6(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("::ffff:")) return isPrivateV4(lower.slice(7));
  const firstHextet = lower.split(":")[0];
  // fc00::/7 (unique local) and fe80::/10 (link-local).
  if (/^f[cd]/.test(firstHextet)) return true;
  if (/^fe[89ab]/.test(firstHextet)) return true;
  return false;
}

function isBlockedAddress(address, family) {
  return family === 6 ? isPrivateV6(address) : isPrivateV4(address);
}

/** Throws (status 400) if `rawUrl` is not http(s), or resolves to a
 *  loopback/private/link-local address. Resolves silently otherwise. */
export async function assertPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error(`Invalid URL: ${rawUrl}`), { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw Object.assign(new Error(`Unsupported URL scheme: ${url.protocol}`), { status: 400 });
  }
  const hostname = url.hostname;
  if (hostname === "localhost") {
    throw Object.assign(new Error(`Refusing to scrape a local address: ${hostname}`), { status: 400 });
  }

  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (isBlockedAddress(hostname, literalFamily)) {
      throw Object.assign(new Error(`Refusing to scrape a private address: ${hostname}`), { status: 400 });
    }
    return;
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    // Unresolvable host — let the downstream fetch fail with its own error.
    return;
  }
  for (const { address, family } of records) {
    if (isBlockedAddress(address, family)) {
      throw Object.assign(
        new Error(`Refusing to scrape ${hostname} — it resolves to a private address (${address}).`),
        { status: 400 },
      );
    }
  }
}

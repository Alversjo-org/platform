export type ParsedBoxHost = { host: string; boxId: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Lower-cases a `Host` header and strips an optional port and trailing dot. */
function normalizeHost(hostHeader: string): string {
  let host = hostHeader.toLowerCase();
  const portIdx = host.lastIndexOf(':');
  if (portIdx !== -1) host = host.slice(0, portIdx);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/**
 * Strictly parses a `Host` header into a box id + normalized host, or `null` if it
 * does not match `<12 hex chars>.<boxesDomain>` exactly (case-insensitive, one
 * optional trailing dot, optional port). Rejects multi-label prefixes and any
 * suffix that merely happens to end with `.<boxesDomain>` (e.g. an attacker domain
 * appended after it) — the match is anchored on both ends.
 */
export function parseBoxHost(hostHeader: string | undefined, boxesDomain: string): ParsedBoxHost | null {
  if (!hostHeader) return null;
  const host = normalizeHost(hostHeader);

  const re = new RegExp(`^([0-9a-f]{12})\\.${escapeRegExp(boxesDomain.toLowerCase())}$`);
  const match = host.match(re);
  if (!match) return null;
  return { host, boxId: match[1] };
}

/**
 * True when the host sits somewhere under `<boxesDomain>`, whether or not it names a
 * valid box. The proxy uses it to answer 404 for junk box hostnames rather than
 * handing them to Next.js, which would serve the platform UI on a box origin.
 */
export function isBoxesSubdomain(hostHeader: string | undefined, boxesDomain: string): boolean {
  if (!hostHeader) return false;
  return normalizeHost(hostHeader).endsWith(`.${boxesDomain.toLowerCase()}`);
}

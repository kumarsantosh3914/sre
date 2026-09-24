import { LookupAddress, lookup as dnsLookup } from 'dns';
import { BlockList, isIP } from 'net';
import { Agent, Dispatcher, fetch, RequestInit, Response } from 'undici';

// Tenant-supplied URLs (health checks, Prometheus/Loki/Grafana endpoints)
// are fetched from inside our network. Without a guard, a tenant could
// point a "health check" at 169.254.169.254 (cloud metadata) or an
// internal service. Every connection's resolved address is checked in the
// socket's DNS lookup, so DNS-rebinding and redirects to internal hosts
// are blocked too — not just the initial hostname.
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

export class BlockedAddressError extends Error {
  constructor(address: string) {
    super(`Refusing to connect to non-public address ${address}`);
  }
}

function privateTargetsAllowed(): boolean {
  // Local development only (docker-compose services on private IPs).
  return process.env.ALLOW_PRIVATE_NETWORK_TARGETS === 'true';
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return blocked.check(address, 'ipv4');
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function guardedLookup(hostname: string, options: object, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad && !privateTargetsAllowed()) {
      return callback(new BlockedAddressError(bad.address), []);
    }
    const wantsAll = (options as { all?: boolean }).all === true;
    if (wantsAll) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

let dispatcher: Dispatcher | null = null;
function safeDispatcher(): Dispatcher {
  dispatcher ??= new Agent({ connect: { lookup: guardedLookup }, maxRedirections: 3 });
  return dispatcher;
}

export interface SafeFetchOptions extends Omit<RequestInit, 'dispatcher' | 'signal'> {
  timeoutMs: number;
}

// fetch() for tenant-controlled URLs: http(s) only, no literal private
// IPs, every resolved address checked, and a hard timeout.
export async function safeFetch(url: string, options: SafeFetchOptions): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported URL scheme ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedAddress(host) && !privateTargetsAllowed()) {
    throw new BlockedAddressError(host);
  }
  const { timeoutMs, ...init } = options;
  return fetch(url, {
    ...init,
    dispatcher: safeDispatcher(),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

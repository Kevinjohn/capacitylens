import { BlockList, isIP } from 'node:net';

// The same peers the packaged nginx trusts for X-Forwarded-For, plus IPv6 loopback and unique-local.
const privatePeers = new BlockList();
privatePeers.addSubnet('127.0.0.0', 8, 'ipv4');
privatePeers.addSubnet('10.0.0.0', 8, 'ipv4');
privatePeers.addSubnet('172.16.0.0', 12, 'ipv4');
privatePeers.addSubnet('192.168.0.0', 16, 'ipv4');
privatePeers.addAddress('::1', 'ipv6');
privatePeers.addSubnet('fc00::', 7, 'ipv6');

/** Whether a peer address is loopback or on a private network, including IPv4-mapped IPv6. */
export function isPrivatePeer(address: string): boolean {
  const ip = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1] ?? address;
  const version = isIP(ip);
  if (version === 0) return false;
  return privatePeers.check(ip, version === 4 ? 'ipv4' : 'ipv6');
}

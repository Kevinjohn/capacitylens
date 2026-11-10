import { test } from '@japa/runner';
import { isPrivatePeer } from '#config/proxy_trust';

test('private proxy trust covers loopback and private networks only', ({ assert }) => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.9',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.20',
    '::1',
    'fd12:3456::1',
    '::ffff:172.18.0.3',
  ])
    assert.isTrue(isPrivatePeer(address), address);
  for (const address of [
    '203.0.113.5',
    '172.32.0.1',
    '172.15.255.255',
    '100.64.0.1',
    '169.254.1.1',
    '2001:db8::1',
    '::ffff:203.0.113.5',
    'fe80::1',
    'not-an-address',
    '',
  ])
    assert.isFalse(isPrivatePeer(address), address);
});

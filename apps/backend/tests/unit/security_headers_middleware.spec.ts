import { test } from '@japa/runner';
import { isTrustedUnsafeOrigin } from '#services/cors_policy';

test('trusts explicit CORS and same-origin proxy writes while rejecting sibling origins', ({
  assert,
}) => {
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'http://localhost:5173',
      fetchSite: 'cross-site',
    })
  );
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'https://capacity.example.com',
      host: 'capacity.example.com',
      protocol: 'https',
    })
  );
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'https://capacity.example.com',
      host: 'capacity.example.com',
      protocol: 'http',
    })
  );
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'http://capacity.example.com',
      host: 'capacity.example.com',
      protocol: 'http',
    })
  );
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'http://capacity.example.com',
      host: 'CAPACITY.EXAMPLE.COM:80',
      protocol: 'http',
    })
  );
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'https://capacity.example.com',
      fetchSite: 'same-origin',
    })
  );
  assert.isFalse(
    isTrustedUnsafeOrigin({
      origin: 'https://sibling.example.com',
      fetchSite: 'same-site',
    })
  );
  assert.isFalse(isTrustedUnsafeOrigin({ fetchSite: 'cross-site' }));
  for (const host of ['exa mple.com', '[', 'capacity.example.com:8443:9000'])
    assert.isFalse(
      isTrustedUnsafeOrigin({
        origin: 'https://capacity.example.com',
        host,
        protocol: 'http',
      })
    );
  assert.isFalse(
    isTrustedUnsafeOrigin({
      origin: 'http://capacity.example.com',
      host: 'capacity.example.com',
      protocol: 'https',
    })
  );
  assert.isFalse(
    isTrustedUnsafeOrigin({
      origin: 'https://other.example.com',
      host: 'capacity.example.com',
      protocol: 'http',
    })
  );
});

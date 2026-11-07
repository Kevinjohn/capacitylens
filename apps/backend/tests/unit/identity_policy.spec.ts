import { test } from '@japa/runner';
import type { Role } from '@capacitylens/shared/account/types';
import {
  canAdministerIdentity,
  canAdministerIdentityAcrossWorkspaces,
} from '#services/auth/identity_policy';

const roles = (entries: [string, Role][]) => new Map<string, Role>(entries);

test.group('identity policy', () => {
  test('an Owner may administer an Owner identity', ({ assert }) => {
    assert.isTrue(canAdministerIdentity('owner', 'owner'));
  });

  test('an Admin may not administer an Owner identity', ({ assert }) => {
    assert.isFalse(canAdministerIdentity('admin', 'owner'));
  });

  test('an Editor may administer no identity', ({ assert }) => {
    for (const target of ['owner', 'admin', 'editor', 'viewer'] as const) {
      assert.isFalse(canAdministerIdentity('editor', target), `editor -> ${target}`);
    }
  });

  test('a target with no workspace is never administrable', ({ assert }) => {
    assert.isFalse(
      canAdministerIdentityAcrossWorkspaces(roles([['wayne', 'owner']]), roles([]), false)
    );
  });

  test('self needs only one membership', ({ assert }) => {
    assert.isTrue(
      canAdministerIdentityAcrossWorkspaces(roles([]), roles([['wayne', 'viewer']]), true)
    );
  });

  test('an unknown target role fails closed', ({ assert }) => {
    assert.isFalse(canAdministerIdentity('owner', 'superuser' as Role));
  });

  test('self with no membership is refused', ({ assert }) => {
    assert.isFalse(canAdministerIdentityAcrossWorkspaces(roles([]), roles([]), true));
  });

  test('standing in every target workspace allows', ({ assert }) => {
    assert.isTrue(
      canAdministerIdentityAcrossWorkspaces(
        roles([
          ['wayne', 'admin'],
          ['stark', 'owner'],
        ]),
        roles([
          ['wayne', 'editor'],
          ['stark', 'admin'],
        ]),
        false
      )
    );
  });

  test('too little standing in one shared workspace refuses', ({ assert }) => {
    assert.isFalse(
      canAdministerIdentityAcrossWorkspaces(
        roles([
          ['wayne', 'admin'],
          ['stark', 'editor'],
        ]),
        roles([
          ['wayne', 'editor'],
          ['stark', 'editor'],
        ]),
        false
      )
    );
  });

  test('a target workspace the actor does not share refuses', ({ assert }) => {
    assert.isFalse(
      canAdministerIdentityAcrossWorkspaces(
        roles([['wayne', 'owner']]),
        roles([
          ['wayne', 'viewer'],
          ['stark', 'viewer'],
        ]),
        false
      )
    );
  });
});

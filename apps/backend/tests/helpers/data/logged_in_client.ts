import type { ApiClient } from '@japa/api-client';
import type User from '#models/user';
import { asLoggedInDataOwner } from '#tests/helpers/authenticated_data_fixture';

/** Keeps an API client's request methods while signing every request in as `user` with `loginAs`. */
export function loggedInDataClient(client: ApiClient, user: User): ApiClient {
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'visit']);
  return new Proxy(client, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof key !== 'string' || !methods.has(key) || typeof value !== 'function')
        return typeof value === 'function' ? value.bind(target) : value;
      return (...args: unknown[]) => asLoggedInDataOwner(value.apply(target, args), user);
    },
  });
}

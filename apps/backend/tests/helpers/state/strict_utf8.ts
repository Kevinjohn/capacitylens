import { request as httpRequest } from 'node:http';
import {
  asDataOwner,
  type resetAuthenticatedData,
} from '#tests/helpers/authenticated_data_fixture';

export function postRawJson(
  body: Buffer,
  cookieHeader: string,
  masqueradeToken: string
): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const port = Number(process.env.CAPACITYLENS_TEST_HTTP_PORT);
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/v1/companies/a-studio/planning/mutations',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': body.length,
          'cookie': cookieHeader,
          'sec-fetch-site': 'same-origin',
          'X-Masquerade-Context': masqueradeToken,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    request.on('error', reject);
    request.end(body);
  });
}

export async function readContextToken(
  client: Parameters<typeof resetAuthenticatedData>[0],
  cookie: string
) {
  const response = await asDataOwner(client.visit('api.masquerade.show'), cookie).send();
  response.assertStatus(200);
  const token = (response.body()!.data as { masqueradeToken?: unknown }).masqueradeToken;
  if (typeof token !== 'string' || !token)
    throw new Error('The authenticated fixture did not provide a masquerade context.');
  return token;
}

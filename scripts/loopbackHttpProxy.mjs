import { request } from 'node:http';

/** Forward origin-form requests to the trusted loopback server's reserved port. */
export function createLoopbackHttpProxyHandler(port) {
  return (incoming, outgoing) => {
    const path = incoming.url;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      outgoing.writeHead(400);
      outgoing.end('Invalid request target');
      return;
    }

    const upstream = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => {
      outgoing.writeHead(502);
      outgoing.end('Native acceptance upstream unavailable');
    });
    incoming.pipe(upstream);
  };
}

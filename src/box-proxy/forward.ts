import http, { type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

export type Target = { host: string; port: number };

// Hop-by-hop headers must never be forwarded verbatim on the plain HTTP path (node's
// own http.request manages these for its own connection to the target). Left out of
// this set: `upgrade`, which forwardUpgrade below needs to keep.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'proxy-authorization', 'proxy-authenticate']);

function forwardedRequestHeaders(req: IncomingMessage, target: Target, opts: { stripHopByHop: boolean }): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    // The platform's session cookie must never reach a box: boxes are root-controlled
    // by whoever has a shell there, and CloudCLI itself authenticates from a token in
    // localStorage (via /__enter), not from cookies.
    if (lower === 'cookie') continue;
    if (opts.stripHopByHop && HOP_BY_HOP.has(lower)) continue;
    headers[key] = value;
  }
  headers.host = `${target.host}:${target.port}`;
  return headers;
}

/** Streams one HTTP request to the target and its response back. */
export function forwardHttp(req: IncomingMessage, res: ServerResponse, target: Target, onUnreachable: (err: Error) => void): void {
  const upstream = http.request(
    { host: target.host, port: target.port, method: req.method, path: req.url, headers: forwardedRequestHeaders(req, target, { stripHopByHop: true }) },
    (r) => {
      const headers = { ...r.headers };
      // CloudCLI sets no cookie the browser needs, and a box must never be able to
      // plant/overwrite the platform's own session cookie in the client.
      delete headers['set-cookie'];
      res.writeHead(r.statusCode ?? 502, headers);
      r.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    // Once headers are already on the wire we can no longer send a clean error
    // response; just tear the connection down instead of calling writeHead again.
    if (res.headersSent) { res.destroy(); return; }
    onUnreachable(err);
  });
  // If the client's connection drops mid-request, stop the in-flight box request
  // instead of leaving it running. `req`'s own 'close' event fires once its body has
  // been fully read — including on an ordinary, successful request — so we watch the
  // underlying socket instead, and stop watching once this exchange is done (the
  // socket is shared across keep-alive requests, so leaving the listener attached
  // would leak one per request).
  const abortUpstreamOnDisconnect = () => upstream.destroy();
  req.socket.once('close', abortUpstreamOnDisconnect);
  res.once('finish', () => req.socket.off('close', abortUpstreamOnDisconnect));
  res.once('close', () => req.socket.off('close', abortUpstreamOnDisconnect));
  req.pipe(upstream);
}

/** Relays an HTTP Upgrade (WebSocket) to the target using only node:http. */
export function forwardUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, target: Target): void {
  const upstream = http.request({ host: target.host, port: target.port, method: req.method, path: req.url, headers: forwardedRequestHeaders(req, target, { stripHopByHop: false }) });
  upstream.on('upgrade', (r, upSocket, upHead) => {
    const lines = [`HTTP/1.1 ${r.statusCode} ${r.statusMessage}`];
    for (let i = 0; i < r.rawHeaders.length; i += 2) {
      // Browsers honour Set-Cookie on a WebSocket handshake response too — a box
      // must never be able to plant/overwrite the platform's session cookie this way.
      if (r.rawHeaders[i].toLowerCase() === 'set-cookie') continue;
      lines.push(`${r.rawHeaders[i]}: ${r.rawHeaders[i + 1]}`);
    }
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (upHead.length) socket.write(upHead);
    if (head.length) upSocket.write(head);
    upSocket.pipe(socket).pipe(upSocket);
    const close = () => { socket.destroy(); upSocket.destroy(); };
    socket.on('error', close); upSocket.on('error', close);
    socket.on('close', close); upSocket.on('close', close);
  });
  upstream.on('response', (r) => {
    socket.write(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
}

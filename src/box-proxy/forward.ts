import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

export type Target = { host: string; port: number };

/** Streams one HTTP request to the target and its response back. */
export function forwardHttp(req: IncomingMessage, res: ServerResponse, target: Target, onUnreachable: (err: Error) => void): void {
  const upstream = http.request(
    { host: target.host, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: `${target.host}:${target.port}` } },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  upstream.on('error', onUnreachable);
  req.pipe(upstream);
}

/** Relays an HTTP Upgrade (WebSocket) to the target using only node:http. */
export function forwardUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, target: Target): void {
  const upstream = http.request({ host: target.host, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: `${target.host}:${target.port}` } });
  upstream.on('upgrade', (r, upSocket, upHead) => {
    const lines = [`HTTP/1.1 ${r.statusCode} ${r.statusMessage}`];
    for (let i = 0; i < r.rawHeaders.length; i += 2) lines.push(`${r.rawHeaders[i]}: ${r.rawHeaders[i + 1]}`);
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

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forwardHttp, forwardUpgrade } from './forward';

let upstream: http.Server;
let proxy: http.Server;
let target: { host: string; port: number };

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'x-seen-path': req.url ?? '' });
    req.pipe(res); // echo body
  });
  upstream.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write(`echo:${d}`));
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  target = { host: '127.0.0.1', port: (upstream.address() as AddressInfo).port };

  proxy = http.createServer((req, res) => forwardHttp(req, res, target, () => { res.writeHead(503); res.end('down'); }));
  proxy.on('upgrade', (req, socket, head) => forwardUpgrade(req, socket, head, target));
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
});

afterAll(() => { proxy.close(); upstream.close(); });

const proxyPort = () => (proxy.address() as AddressInfo).port;

describe('forwardHttp', () => {
  it('streams request and response with headers', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort()}/api/x?y=1`, { method: 'POST', body: 'hello' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-seen-path')).toBe('/api/x?y=1');
    expect(await res.text()).toBe('hello');
  });

  it('calls onUnreachable when the target is down', async () => {
    const dead = http.createServer((req, res) => forwardHttp(req, res, { host: '127.0.0.1', port: 1 }, () => { res.writeHead(503); res.end('down'); }));
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const res = await fetch(`http://127.0.0.1:${(dead.address() as AddressInfo).port}/`);
    expect(res.status).toBe(503);
    dead.close();
  });
});

describe('forwardUpgrade', () => {
  it('relays an upgraded connection both ways', async () => {
    const reply = await new Promise<string>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxyPort(), path: '/ws', headers: { connection: 'Upgrade', upgrade: 'websocket' } });
      req.on('upgrade', (_res, socket) => {
        socket.once('data', (d) => { resolve(d.toString()); socket.destroy(); });
        socket.write('ping');
      });
      req.on('error', reject);
      req.end();
    });
    expect(reply).toBe('echo:ping');
  });
});

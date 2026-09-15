import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import next from 'next';
import { forwardHttp, forwardUpgrade, type Target } from './src/box-proxy/forward';
import { parseBoxHost } from './src/box-proxy/host';
import { forbiddenPageHtml, notFoundPageHtml, notReadyPageHtml, stoppedPageHtml, unavailablePageHtml } from './src/box-proxy/pages';
import { resolveBoxSession } from './src/box-proxy/session';
import { enterPageHtml } from './src/lib/boxes/cloudcli-token';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);
const boxesDomain = process.env.BOXES_DOMAIN ?? 'boxes.localhost';
const boxesApp = process.env.FLY_BOXES_APP ?? 'alversjo-boxes';
const platformUrl = process.env.PLATFORM_URL ?? `http://localhost:${port}`;
const internalUrl = `http://127.0.0.1:${port}`;
// Per-process secret shared with the internal route (same process, same env).
process.env.INTERNAL_SECRET ??= randomBytes(32).toString('hex');
const secret = process.env.INTERNAL_SECRET;

function targetFor(machineId: string): Target {
  const override = process.env.BOX_TARGET_OVERRIDE; // "host:port", local testing against a docker box
  if (override) { const [host, p] = override.split(':'); return { host, port: Number(p) }; }
  return { host: `${machineId}.vm.${boxesApp}.internal`, port: 8080 };
}

const html = (status: number, body: string) => ({ status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body });

/** Probes CloudCLI's auth-status endpoint before handing out a token: tells a dead box apart from one still finishing its first boot. */
async function probeBoxStatus(target: Target): Promise<{ reachable: boolean; needsSetup: boolean }> {
  try {
    const res = await fetch(`http://${target.host}:${target.port}/api/auth/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      await res.body?.cancel();
      return { reachable: true, needsSetup: false };
    }
    const body = (await res.json()) as { needsSetup?: boolean };
    return { reachable: true, needsSetup: body.needsSetup === true };
  } catch {
    return { reachable: false, needsSetup: false };
  }
}

const app = next({ dev, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsed = parseBoxHost(req.headers.host, boxesDomain);
      if (!parsed) return handle(req, res);
      const { host } = parsed;
      const s = await resolveBoxSession({ host, cookie: req.headers.cookie, internalUrl, secret });
      const reply = (r: { status: number; headers: Record<string, string>; body: string }) => { res.writeHead(r.status, r.headers); res.end(r.body); };
      switch (s.status) {
        case 'unauthenticated': res.writeHead(302, { location: `${platformUrl}/login` }); return res.end();
        case 'forbidden': return reply(html(403, forbiddenPageHtml()));
        case 'not_found': return reply(html(404, notFoundPageHtml()));
        case 'unavailable': return reply(html(502, unavailablePageHtml()));
        case 'ok': {
          const target = targetFor(s.machineId);
          if (req.url === '/__enter') {
            const probe = await probeBoxStatus(target);
            if (!probe.reachable) return reply(html(503, stoppedPageHtml(s.canStart, platformUrl, s.boxId)));
            if (probe.needsSetup) return reply(html(503, notReadyPageHtml()));
            return reply(html(200, enterPageHtml(s.token)));
          }
          return forwardHttp(req, res, target, () => reply(html(503, stoppedPageHtml(s.canStart, platformUrl, s.boxId))));
        }
        // Defensive: any future BoxSessionResult variant this server doesn't know
        // about yet gets a clean 502 instead of falling through unanswered.
        default: return reply(html(502, unavailablePageHtml()));
      }
    } catch (err) {
      console.error('box-proxy request handler error:', err);
      if (res.headersSent) { res.destroy(); return; }
      const r = html(502, unavailablePageHtml());
      res.writeHead(r.status, r.headers);
      res.end(r.body);
    }
  });

  // Next's own upgrade handler is also attached to this server (lazily, on the first
  // request routed through `handle()` above) and it runs alongside this listener on
  // every 'upgrade' event. It only acts on its own HMR path and otherwise leaves the
  // socket alone — but if a box's WebSocket path ever collided with a Next.js route
  // (e.g. `/_next/hmr`), Next's handler would end the socket first. CloudCLI's `/ws`
  // and `/shell` paths must never be changed to collide with a Next.js route.
  server.on('upgrade', async (req, socket, head) => {
    try {
      const parsed = parseBoxHost(req.headers.host, boxesDomain);
      if (!parsed) return; // Next.js attaches its own listener for HMR
      const s = await resolveBoxSession({ host: parsed.host, cookie: req.headers.cookie, internalUrl, secret });
      if (s.status !== 'ok') return socket.destroy();
      forwardUpgrade(req, socket, head, targetFor(s.machineId));
    } catch (err) {
      console.error('box-proxy upgrade handler error:', err);
      socket.destroy();
    }
  });

  server.listen(port, () => console.log(`platform on http://localhost:${port}, boxes on *.${boxesDomain}`));

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(); // stop accepting new connections; existing relays continue
    setTimeout(() => process.exit(0), 10_000).unref(); // hard stop if graceful close hangs
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
});

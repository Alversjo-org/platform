// POST /api/internal/box-session  header x-internal-secret: <INTERNAL_SECRET>
// body { host: string; cookie: string }
export type BoxSessionResult =
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'ok'; boxId: string; machineId: string; token: string; canStart: boolean }
  // Proxy-side only: the internal route call itself failed (network error, non-2xx,
  // or a non-JSON body). The route handler never produces this variant.
  | { status: 'unavailable' };

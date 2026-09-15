// POST /api/internal/box-session  header x-internal-secret: <INTERNAL_SECRET>
// body { host: string; cookie: string }
export type BoxSessionResult =
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  | { status: 'not_found' }
  | { status: 'ok'; boxId: string; machineId: string; token: string; canStart: boolean };

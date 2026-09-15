// Creates the protected admin box. Run on the platform machine, which has every secret:
//   fly ssh console -a alversjo-platform -C "sh -c 'cd /app && npx tsx /app/scripts/create-admin-box.ts owner@example.org'"
import { eq } from 'drizzle-orm';
import { schema } from '../src/db';
import { boxDeps } from '../src/lib/boxes/deps';
import { createBox } from '../src/lib/boxes/service';

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error('usage: create-admin-box.ts <owner-email>');

  const deps = await boxDeps();
  const [owner] = await deps.db.select().from(schema.user).where(eq(schema.user.email, email.toLowerCase()));
  if (!owner) throw new Error(`${email} has not logged in yet`);
  const existing = await deps.db.select().from(schema.boxes).where(eq(schema.boxes.protected, true));
  if (existing.length) throw new Error(`protected box already exists: ${existing[0].id}`);

  const box = await createBox(deps, { name: 'admin', profile: 'admin', ownerUserId: owner.id, protected: true });
  console.log(`admin box ${box.id} on machine ${box.flyMachineId}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { createDb } from './index';
import { seedMapAreas } from '@/lib/map/seed';

createDb()
  .then(async (db) => { await seedMapAreas(db); console.log('map areas seeded'); process.exit(0); })
  .catch((err) => { console.error(err); process.exit(1); });

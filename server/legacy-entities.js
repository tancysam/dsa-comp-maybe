import { isDeepStrictEqual } from 'node:util';
import { seedData } from './seed.js';

// Compatibility for snapshots created before demo entities were introduced.
// This is fixture metadata, NOT an inference of real customer ownership.
const known = new Map(seedData().customers.map(({ entity, ...identity }) =>
  [identity.id, { identity, entity }]));

export function legacyCustomerEntities(customers) {
  return customers.map(customer => {
    // Preserve even blank/unknown explicit values; only an absent field qualifies.
    if (Object.hasOwn(customer, 'entity')) return customer;
    const fixture = known.get(customer.id);
    // Check the entire original record, not merely an ID/name shared with a demo.
    if (!fixture || !isDeepStrictEqual(customer, fixture.identity)) return customer;
    return { ...customer, entity: fixture.entity };
  });
}

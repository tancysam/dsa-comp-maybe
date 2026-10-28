import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.js';
import { createStore } from '../server/db.js';
import { graphEntities, groupGraphCustomers } from '../src/lib/graph-groups.ts';

test('ticket workspace and legacy graph share the API without losing legacy records or workflow', async t => {
 const store = createStore(':memory:');
 for (const { entity, ...customer } of store.all().customers) store.put('customers', customer);
 const before = store.all();
 const server = createApp(store).listen(0);
 t.after(() => { server.close(); store.close(); });
 const base = `http://127.0.0.1:${server.address().port}/api`;
 const get = async path => {
  const response = await fetch(base + path, { headers: { 'X-User-Id': 'management' } });
  assert.equal(response.status, 200, path);
  return response.json();
 };
 assert.ok((await get('/users')).length > 0);
 assert.equal((await get('/tickets/T-1042')).ticket.code, 'T-1042');
 const workflow = store.all().workflow;
 const bootstrap = await get('/bootstrap');
 assert.equal(bootstrap.workflow, undefined, 'legacy response must not leak workflow');
 assert.deepEqual(bootstrap.customers.map(({entity,...c})=>c), before.customers);
 assert.deepEqual(['SPD','QTS','QTG'].map(e=>bootstrap.customers.filter(c=>c.entity===e).length),[6,6,6]);
 const plotted = graphEntities.flatMap(entity => groupGraphCustomers(bootstrap.customers, entity));
 assert.equal(plotted.length, 18);
 const simulation = await fetch(base + '/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: 'c1', targetId: 'c2' }) });
 assert.equal(simulation.status, 200);
 const result = await simulation.json();
 assert.equal(result.after.targetQuantity, result.before.sourceQuantity + result.before.targetQuantity);
 assert.deepEqual(store.all().workflow, workflow);
 for (const key of ['customers','products','orders','requests','audit']) assert.deepEqual(store.all()[key], before[key]);
});

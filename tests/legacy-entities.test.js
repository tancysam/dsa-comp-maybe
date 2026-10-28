import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/db.js';
import { createApp } from '../server/index.js';

test('read compatibility restores only exact known legacy fixture entities without writes', async t => {
 const store = createStore(':memory:');
 for (const {entity,...c} of store.all().customers) store.put('customers',c);
 const original=store.all();
 const server=createApp(store).listen(0);t.after(()=>{server.close();store.close();});
 const read=async path=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`);assert.equal(r.status,200);return r.json();};
 const data=await read('/bootstrap');
 assert.deepEqual(['SPD','QTS','QTG'].map(e=>data.customers.filter(c=>c.entity===e).length),[6,6,6]);
 assert.equal(data.customers.length,18);
 const graph=await read('/graph');
 assert.deepEqual(graph.nodes.filter(n=>n.type==='customer').map(n=>n.data),data.customers);
 assert.deepEqual(store.all(),original,'read mapping must not persist or touch any collection');
 // A custom ID, edited identity, added field, or explicit assignment must never be inferred.
 const base=original.customers[0];
 const cases=[{...base,id:'custom'},{...base,name:'Edited hospital'},{...base,country:'Edited country'},{...base,email:'other@example.test'},{...base,identifier:'OTHER'},{...base,aliases:[]},{...base,custom:true},{...base,entity:'QTG'},{...base,entity:'new-owner'},{...base,entity:''},{...base,entity:null}];
 for(const item of cases){store.put('customers',item);const view=(await read('/bootstrap')).customers.find(c=>c.id===item.id);assert.deepEqual(view,item);}
});

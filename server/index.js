import express from 'express';
import { legacyCustomerEntities } from './legacy-entities.js';
import { ticketRouter } from './ticket-routes.js';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStore } from './db.js';
import { triage } from './triage.js';
import { ApiError, act, audit, configOf, createRequest, duplicates, escalations, redact, sapPayload, validateConfig } from './domain.js';

export function createApp(store) {
  const app=express(); app.use(express.json({limit:'100kb'}));
  const role=req=>req.get('X-Role') || 'Sales';
  app.use('/api', ticketRouter(store));
  app.get('/api/bootstrap',(req,res)=>{const {workflow,...legacy}=store.all(); res.json(redact({...legacy,customers:legacyCustomerEntities(legacy.customers)},role(req)));});
  app.get('/api/analytics',async(req,res,next)=>{try { const {buildAnalytics}=await import('./analytics.js'); res.json(await buildAnalytics(redact(store.all(),role(req)))); } catch(e){next(e);} });
  app.get('/api/graph',(req,res)=>{const data=store.all(); const {customers,products,orders}=redact({...data,customers:legacyCustomerEntities(data.customers)},role(req)); res.json({nodes:[...customers.map(c=>({id:c.id,type:'customer',data:c})),...products.map(p=>({id:p.id,type:'product',data:p}))],edges:orders.map(o=>({id:o.id,source:o.customerId,target:o.productId,data:o}))});});
  app.post('/api/duplicates',(req,res)=>{const data=store.all(); const matches=duplicates(req.body ?? {},data.customers,data.requests); const safe=redact(data,role(req)); const byId=new Map([...safe.customers,...safe.requests.map(r=>({id:r.id,name:r.name,country:r.country,entity:r.entity,identifier:r.identifier,email:r.email,aliases:[]}))].map(c=>[c.id,c])); res.json({matches:matches.map(m=>({...m,customer:byId.get(m.customer.id)}))});});
  app.post('/api/requests',(req,res)=>{const data=store.all(); const item=createRequest(req.body,data.customers,data.requests,configOf(data)); store.transaction(()=>{store.put('requests',item);store.put('audit',audit(item.id,'created',role(req),'Request created'));}); res.status(201).json(redact({...store.all(),requests:[item]},role(req)).requests[0]);});
  app.post('/api/requests/:id/action',(req,res)=>{const item=store.all().requests.find(r=>r.id===req.params.id); if(!item) throw new ApiError(404,'Request not found'); const updated=act(item,req.body?.action,req.body?.note,role(req)); store.transaction(()=>{store.put('requests',updated);store.put('audit',audit(item.id,req.body.action,role(req),typeof req.body.note==='string'?req.body.note.trim():''));}); res.json(redact({...store.all(),requests:[updated]},role(req)).requests[0]);});
  app.get('/api/requests/:id/sap',(req,res)=>{const item=store.all().requests.find(r=>r.id===req.params.id); if(!item) throw new ApiError(404,'Request not found'); if(item.status!=='Approved') throw new ApiError(409,'Only approved requests can be exported'); if(!['Finance','Admin'].includes(role(req))) throw new ApiError(403,'Finance or Admin role required for SAP export'); res.json(sapPayload(item));});
  app.post('/api/simulate',(req,res)=>{const {sourceId,targetId}=req.body || {}; const data=store.all(); if(!sourceId||!targetId||sourceId===targetId) throw new ApiError(400,'Two distinct customer IDs are required'); if(!data.customers.some(c=>c.id===sourceId)||!data.customers.some(c=>c.id===targetId)) throw new ApiError(404,'Customer not found'); const source=data.orders.filter(o=>o.customerId===sourceId),target=data.orders.filter(o=>o.customerId===targetId); const sum=xs=>xs.reduce((n,o)=>n+o.quantity,0); const sourceQuantity=sum(source),targetQuantity=sum(target); res.json({before:{customerCount:data.customers.length,sourceQuantity,targetQuantity},after:{customerCount:data.customers.length-1,targetQuantity:sourceQuantity+targetQuantity},affectedOrders:source.length,totalQuantity:sourceQuantity+targetQuantity,explanation:'Simulated merge only; no records are changed. Source order quantities move to the target.'});});
  app.post('/api/triage',(req,res)=>{const text=req.body?.text; if(typeof text!=='string') throw new ApiError(400,'text is required'); res.json(triage(text));});
  app.get('/api/config',(req,res)=>res.json(configOf(store.all())));
  app.put('/api/config',(req,res)=>{if(!['Admin'].includes(role(req))) throw new ApiError(403,'Only the MDM team can change workflow rules'); const config=validateConfig(req.body); store.transaction(()=>store.put('config',config)); res.json(config);});
  app.post('/api/escalations/run',(req,res)=>{const data=store.all(); const found=escalations(data.requests,data.audit,configOf(data)); store.transaction(()=>found.forEach(({request,entry})=>{store.put('requests',request);store.put('audit',entry);})); res.json({escalated:found.map(f=>f.request.id)});});
  app.post('/api/reset',(req,res)=>{if(role(req)!=='Admin') throw new ApiError(403,'Admin role required to reset data'); store.reset();res.json({ok:true});});
  app.use('/api',(req,res)=>res.status(404).json({error:'API endpoint not found'}));
  app.use(express.static(resolve('dist'))); app.get('/{*path}',(req,res,next)=>res.sendFile(resolve('dist/index.html'),err=>err && next(err)));
  app.use((err,req,res,next)=>{const status=err.status || (err.type==='entity.parse.failed'?400:500); const payload={error:status===500?'Internal server error':err.message}; if(err.matches){const safe=redact(store.all(),role(req)); const map=new Map([...safe.customers,...safe.requests.map(r=>({id:r.id,name:r.name,country:r.country,entity:r.entity,identifier:r.identifier,email:r.email,aliases:[]}))].map(c=>[c.id,c])); payload.matches=err.matches.map(m=>({...m,customer:map.get(m.customer.id)}));} res.status(status).json(payload);});
  return app;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {const path=process.env.DB_PATH || 'data/mastergraph.sqlite'; if(path!==':memory:') mkdirSync(dirname(resolve(path)),{recursive:true}); const store=createStore(path); createApp(store).listen(Number(process.env.PORT)||3001,()=>console.log('API listening on port '+(process.env.PORT||3001)));}

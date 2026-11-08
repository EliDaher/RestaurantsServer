import assert from "node:assert/strict";
import {test,mock,after} from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import {randomUUID} from "node:crypto";
class TestFirestore {
  records = new Map();
  versions = new Map();
  epochs = new Map();
  queryReads = [];
  collection(path) { return new Collection(this, path); }
  seed(path, data) {
    this.records.set(path, structuredClone(data));
    this.versions.set(path, (this.versions.get(path) ?? 0) + 1);
    const parent = path.substring(0, path.lastIndexOf("/"));
    this.epochs.set(parent, (this.epochs.get(parent) ?? 0) + 1);
  }
  async runTransaction(action) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const tx = new TestTransaction(this);
      const result = await action(tx);
      if ([...tx.reads].some(([path, version]) => (this.versions.get(path) ?? 0) !== version) ||
          [...tx.queries].some(([path, epoch]) => (this.epochs.get(path) ?? 0) !== epoch)) continue;
      // Validate all preconditions BEFORE writing any reservation or table.
      for (const [kind, ref] of tx.writes) {
        if (kind === "create" && this.records.has(ref.path)) throw new Error("already exists");
        if (kind === "update" && !this.records.has(ref.path)) throw new Error("missing update");
      }
      for (const [kind, ref, data] of tx.writes) {
        if (kind === "delete") {
          this.records.delete(ref.path);
          this.versions.set(ref.path, (this.versions.get(ref.path) ?? 0) + 1);
          this.epochs.set(ref.parent.path, (this.epochs.get(ref.parent.path) ?? 0) + 1);
        } else this.seed(ref.path, kind === "update" ? { ...this.records.get(ref.path), ...data } : data);
      }
      return result;
    }
    throw new Error("transaction retry exhaustion");
  }
}
class Collection {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new Doc(this.db, `${this.path}/${id}`); }
  where(key, op, value) { const query = new Collection(this.db,this.path); query.filters = [...(this.filters??[]), [key,op,value]]; return query; }
  async get() {
    const docs = [...this.db.records].filter(([path,data])=>path.substring(0,path.lastIndexOf("/"))===this.path && (this.filters??[]).every(([key,op,value])=>op === "in" ? value.includes(data[key]) : data[key]===value)).map(([path,data])=>({id:path.split("/").at(-1),exists:true,data:()=>structuredClone(data)}));
    this.db.queryReads.push({path:this.path,filters:this.filters??[],returned:docs.length});
    return {docs};
  }
  get parent() { return new Doc(this.db, this.path.substring(0, this.path.lastIndexOf("/"))); }
}
class Doc {
  async get() { const data=this.db.records.get(this.path); return {id:this.id,exists:data!==undefined,data:()=>structuredClone(data)}; }
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new Collection(this.db, `${this.path}/${name}`); }
  get parent() { return new Collection(this.db, this.path.substring(0, this.path.lastIndexOf("/"))); }
}
class TestTransaction {
  reads = new Map(); queries = new Map(); writes = [];
  constructor(db) { this.db = db; }
  async get(ref) {
    assert.equal(this.writes.length, 0, "Firestore reads must precede all writes");
    if (ref instanceof Collection) {
      this.queries.set(ref.path, this.db.epochs.get(ref.path) ?? 0);
      return ref.get();
    }
    this.reads.set(ref.path, this.db.versions.get(ref.path) ?? 0);
    const data = this.db.records.get(ref.path);
    return { id: ref.id, exists: data !== undefined, data: () => data === undefined ? undefined : structuredClone(data) };
  }
  set(ref, data) { this.writes.push(["set", ref, data]); }
  create(ref, data) { this.writes.push(["create", ref, data]); }
  update(ref, data) { this.writes.push(["update", ref, data]); }
  delete(ref) { this.writes.push(["delete", ref]); }
}

const db=new TestFirestore();
const store=db.records;
mock.module("../dist/config/firebase.js",{namedExports:{db,FieldValue:{serverTimestamp:()=>new Date().toISOString()}}});
mock.module("../dist/config/env.js",{namedExports:{env:{JWT_SECRET:"test-secret"}}});
mock.module("../dist/services/restaurants.js",{namedExports:{findRestaurantBySlug:async slug=>slug==="cafe"?{id:"r",name:"Cafe",plan:"standard"}:null,getRestaurantById:async id=>({id,name:"Cafe",plan:"standard"})}});
const {waiterRouter,ownerWaitersRouter}=await import("../dist/routes/waiter.js");
const {errorHandler}=await import("../dist/middleware/error.js");
const app=express();app.use(express.json());app.use("/api/waiter",waiterRouter);app.use("/api/owner/waiters",ownerWaitersRouter);app.use(errorHandler);
const server=app.listen(0);await new Promise(r=>server.once("listening",r));after(()=>server.close());
const base=`http://localhost:${server.address().port}`;
const token=(id="w1",role="WAITER",restaurantId="r")=>jwt.sign({id,role,restaurantId,email:""},"test-secret");
async function request(path,body,auth=token(),method=body?"POST":"GET"){const response=await fetch(base+path,{method,headers:{"Content-Type":"application/json",Authorization:`Bearer ${auth}`},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
function seed(){store.clear();db.queryReads=[];for(const id of ["w1","w2"])store.set("users/"+id,{name:id,role:"WAITER",restaurantId:"r",isActive:true});store.set("restaurants/r/tables/t",{name:"1",area:"Main",status:"AVAILABLE",currentOrderId:"",restaurantId:"r"});store.set("restaurants/r/items/i",{name:"Tea",price:20,isAvailable:true,categoryId:"c",order:0});store.set("restaurants/r/categories/c",{name:"Drinks",isActive:true,order:0});}
const batch=(orderId="")=>({operationId:randomUUID(),tableId:"t",orderId,createdAt:new Date().toISOString(),items:[{menuItemId:"i",quantity:2,notes:"hot"}]});
test("additions from two waiters, retry after lost response, attribution and sync log",async()=>{seed();const a=batch(),b=batch();const results=await Promise.all([request("/api/waiter/batches",a),request("/api/waiter/batches",b,token("w2"))]);assert.deepEqual(results.map(r=>r.status),[200,200]);const id=results[0].body.data.orderId;assert.equal(results[1].body.data.orderId,id);assert.equal(store.get(`restaurants/r/orders/${id}`).total,80);assert.equal((await request("/api/waiter/batches",a)).status,200);assert.equal(store.get(`restaurants/r/orders/${id}`).total,80);assert.equal(store.get(`restaurants/r/waiterBatches/${b.operationId}`).waiterName,"w2");assert.equal(store.get("restaurants/r/syncMeta/main").cursor,4);assert.equal((await request("/api/waiter/batches",a,token("w2"))).status,409);});
test("fake prices and actors rejected; closed orders and unavailable items are atomic",async()=>{seed();assert.equal((await request("/api/waiter/batches",{...batch(),waiterId:"w2"})).status,400);const bad=batch();bad.items[0].unitPrice=0;assert.equal((await request("/api/waiter/batches",bad)).status,400);const r=await request("/api/waiter/batches",batch());const id=r.body.data.orderId;store.get(`restaurants/r/orders/${id}`).status="COMPLETED";assert.equal((await request("/api/waiter/batches",batch(id))).status,409);assert.equal(store.get(`restaurants/r/orders/${id}`).total,40);seed();store.get("restaurants/r/items/i").isAvailable=false;assert.equal((await request("/api/waiter/batches",batch())).status,409);assert.equal(store.get("restaurants/r/tables/t").currentOrderId,"");});
test("disabled users, tenant isolation, owner access and price-free bootstrap",async()=>{seed();const r=await request("/api/waiter/bootstrap");assert.equal(r.status,200);assert.doesNotMatch(JSON.stringify(r.body),/price|total|paidAmount|discount/i);assert.equal((await request("/api/owner/waiters")).status,403);assert.equal((await request("/api/waiter/bootstrap",undefined,token("w1","WAITER","other"))).status,401);store.get("users/w1").isActive=false;assert.equal((await request("/api/waiter/batches",batch())).status,401);});
test("account uniqueness, login, password reset and disable",async()=>{seed();const owner=token("owner","restaurantOwner");const input={name:"Ali",username:"ali",password:"password123"};let r=await request("/api/owner/waiters",input,owner);assert.equal(r.status,201);const id=r.body.data.id;assert.equal((await request("/api/owner/waiters",input,owner)).status,409);assert.equal((await request("/api/waiter/login",{slug:"cafe",username:"ali",password:input.password})).status,200);assert.equal((await request(`/api/owner/waiters/${id}`,{password:"newpassword"},owner,"PATCH")).status,200);assert.equal((await request("/api/waiter/login",{slug:"cafe",username:"ali",password:input.password})).status,401);assert.equal((await request("/api/waiter/login",{slug:"cafe",username:"ali",password:"newpassword"})).status,200);assert.equal((await request(`/api/owner/waiters/${id}`,{isActive:false},owner,"PATCH")).status,200);assert.equal((await request("/api/waiter/login",{slug:"cafe",username:"ali",password:"newpassword"})).status,401);});

test("history is tenant-scoped and preserves each waiter's name snapshot",async()=>{seed();const first=batch();const response=await request("/api/waiter/batches",first);const id=response.body.data.orderId;store.get("users/w1").name="Renamed";const history=await request(`/api/owner/waiters/orders/${id}/batches`,undefined,token("owner","restaurantOwner"));assert.equal(history.status,200);assert.equal(history.body.data[0].waiterName,"w1");assert.equal(history.body.data[0].items[0].quantity,2);const other=await request(`/api/owner/waiters/orders/${id}/batches`,undefined,token("owner2","restaurantOwner","other"));assert.deepEqual(other.body.data,[]);assert.equal((await request(`/api/owner/waiters/w1`,{name:"spoof"},token("owner2","restaurantOwner","other"),"PATCH")).status,404);});
test("an old queued order never attaches to the next table order",async()=>{seed();const original=await request("/api/waiter/batches",batch());const oldId=original.body.data.orderId;store.get(`restaurants/r/orders/${oldId}`).status="COMPLETED";store.get("restaurants/r/tables/t").currentOrderId="";const next=await request("/api/waiter/batches",batch());const nextId=next.body.data.orderId;assert.notEqual(oldId,nextId);assert.equal((await request("/api/waiter/batches",batch(oldId))).status,409);assert.equal(store.get(`restaurants/r/orders/${nextId}`).total,40);});

test("general notes append atomically, retain attribution and never duplicate on retries",async()=>{
 seed();
 const initial=batch();const original=await request("/api/waiter/batches",initial);assert.equal(original.status,200);
 const id=original.body.data.orderId;store.get(`restaurants/r/orders/${id}`).notes="تعليمات سابقة";
 const a={...batch(id),orderNote:"قدّم المشروبات أولاً"},b={...batch(id),orderNote:"الطعام معاً"};
 const results=await Promise.all([request("/api/waiter/batches",a),request("/api/waiter/batches",b,token("w2"))]);
 assert.deepEqual(results.map(r=>r.status),[200,200]);
 const notes=store.get(`restaurants/r/orders/${id}`).notes;
 assert.ok(notes.startsWith("تعليمات سابقة"));assert.ok(notes.includes("w1: قدّم المشروبات أولاً"));assert.ok(notes.includes("w2: الطعام معاً"));
 assert.equal((await request("/api/waiter/batches",a)).status,200);
 assert.equal((await request("/api/waiter/batches",b,token("w2"))).status,200);
 assert.equal(store.get(`restaurants/r/orders/${id}`).notes,notes);
 assert.equal(store.get(`restaurants/r/waiterBatches/${a.operationId}`).orderNote,a.orderNote);
 const history=await request(`/api/owner/waiters/orders/${id}/batches`,undefined,token("owner","restaurantOwner"));
 assert.ok(history.body.data.some(row=>row.orderNote===a.orderNote));
 // A pre-feature request still matches its persisted, note-free fingerprint.
 assert.equal((await request("/api/waiter/batches",initial)).status,200);
 assert.equal(store.get(`restaurants/r/orders/${id}`).notes,notes);
});
test("general note validation and rejected batches leave all order instructions unchanged",async()=>{
 seed();const original=await request("/api/waiter/batches",batch());const id=original.body.data.orderId;
 store.get(`restaurants/r/orders/${id}`).notes="تعليمات محفوظة";
 assert.equal((await request("/api/waiter/batches",{...batch(id),orderNote:"x".repeat(1001)})).status,400);
 assert.equal((await request("/api/waiter/batches",{...batch(id),orderNote:17})).status,400);
 const rejected={...batch(id),orderNote:"لا تحفظ هذه الملاحظة"};
 store.get("restaurants/r/items/i").isAvailable=false;
 assert.equal((await request("/api/waiter/batches",rejected)).status,409);
 assert.equal(store.get(`restaurants/r/orders/${id}`).notes,"تعليمات محفوظة");
 assert.equal(store.has(`restaurants/r/waiterBatches/${rejected.operationId}`),false);
});


test("waiter state reads every non-terminal status with a scoped query and never reads history or menu",async()=>{
 seed();
 const statuses=["DRAFT","PENDING","CONFIRMED","PREPARING","READY","SERVED"];
 for(const status of statuses) store.set(`restaurants/r/orders/${status}`,{tableId:"t",status,items:[]});
 for(let n=0;n<1000;n++) store.set(`restaurants/r/orders/old-${n}`,{tableId:"t",status:n%2?"COMPLETED":"CANCELLED",items:[],total:123});
 store.set("restaurants/other/orders/foreign",{status:"PENDING",items:[]});
 store.set("restaurants/r/tables/deleted",{name:"2",deletedAt:"today",status:"AVAILABLE"});
 store.set("restaurants/r/tables/disabled",{name:"3",status:"DISABLED"});
 const result=await request("/api/waiter/state");assert.equal(result.status,200);
 assert.deepEqual(result.body.data.orders.map(o=>o.status).sort(),statuses.sort());
 assert.deepEqual(result.body.data.tables.map(t=>t.id),["t"]);
 const query=db.queryReads.find(q=>q.path==="restaurants/r/orders");
 assert.deepEqual(query.filters,[["status","in",["DRAFT","PENDING","CONFIRMED","PREPARING","READY","SERVED"]]]);
 assert.equal(query.returned,6);
 assert.ok(db.queryReads.every(q=>!q.path.endsWith("/items")&&!q.path.endsWith("/categories")));
 assert.doesNotMatch(JSON.stringify(result.body),/price|total|paidAmount|discount/i);
 db.queryReads=[];
 const menu=await request("/api/waiter/menu");assert.equal(menu.status,200);
 assert.equal(menu.body.data.items[0].name,"Tea");
 assert.ok(db.queryReads.every(q=>!q.path.endsWith("/orders")&&!q.path.endsWith("/tables")));
 assert.doesNotMatch(JSON.stringify(menu.body),/price|total|paidAmount|discount/i);
 assert.equal((await request("/api/waiter/state",undefined,token("w1","WAITER","other"))).status,401);
 store.get("users/w1").isActive=false;
 assert.equal((await request("/api/waiter/menu")).status,401);
});

test("batch confirmation and lost-response retry return current price-free table/order without repeating additions",async()=>{
 seed();const a=batch();const accepted=await request("/api/waiter/batches",a);
 const id=accepted.body.data.orderId;
 assert.equal(accepted.body.data.table.currentOrderId,id);
 assert.equal(accepted.body.data.order.items[0].quantity,2);
 assert.doesNotMatch(JSON.stringify(accepted.body),/price|total|paidAmount|discount/i);
 await request("/api/waiter/batches",batch(id),token("w2"));
 const replay=await request("/api/waiter/batches",a);
 assert.equal(replay.body.data.order.items.length,2);
 assert.equal(store.get(`restaurants/r/orders/${id}`).items.length,2);
 store.get(`restaurants/r/orders/${id}`).status="COMPLETED";
 store.get("restaurants/r/tables/t").currentOrderId="";
 const closedReplay=await request("/api/waiter/batches",a);
 assert.equal(closedReplay.status,200);assert.equal(closedReplay.body.data.order,null);
 assert.equal(closedReplay.body.data.table.currentOrderId,"");
});

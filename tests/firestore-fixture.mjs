import assert from "node:assert/strict";
export const store = new Map();
export const readCalls = [];
export let readFailure;
export function failReads(error) { readFailure = error; }
const clone = value => structuredClone(value);
const snapshot = ref => ({ id: ref.id, ref, exists: store.has(ref.path), data: () => clone(store.get(ref.path)) });
class Doc {
  constructor(path) { this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new Query(`${this.path}/${name}`); }
  get() { if (readFailure) return Promise.reject(readFailure); readCalls.push(this.path); return Promise.resolve(snapshot(this)); }
  set(data) { store.set(this.path, clone(data)); return Promise.resolve(); }
}
class Query {
  constructor(path, filters = [], ordering = "__name__", maximum = Infinity, after) { Object.assign(this, {path, filters, ordering, maximum, after}); }
  doc(id = `generated_${store.size}`) { return new Doc(`${this.path}/${id}`); }
  where(key, comparator, value) { return new Query(this.path, [...this.filters, [key, comparator, value]], this.ordering, this.maximum, this.after); }
  orderBy(ordering) { return new Query(this.path, this.filters, ordering, this.maximum, this.after); }
  limit(maximum) { return new Query(this.path, this.filters, this.ordering, maximum, this.after); }
  startAfter(after) { return new Query(this.path, this.filters, this.ordering, this.maximum, after); }
  get() {
    if (readFailure) return Promise.reject(readFailure);
    readCalls.push(this.path);
    const key = doc => this.ordering === "__name__" ? doc.id : doc.data()[this.ordering];
    const docs = [...store.keys()].filter(path => path.startsWith(this.path + "/") && path.split("/").length === this.path.split("/").length + 1).map(path => snapshot(new Doc(path))).filter(doc => this.filters.every(([field, op, value]) => {
      const current = doc.data()[field];
      return op === "==" ? current === value : op === "in" ? value.includes(current) : op === "<=" ? current <= value : current > value;
    })).sort((a,b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0).filter(doc => this.after === undefined || key(doc) > this.after).slice(0, this.maximum);
    return Promise.resolve({ docs, empty: !docs.length, size: docs.length });
  }
}

function resolve(data, current = {}) { return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value?.increment !== undefined ? (current[key] ?? 0) + value.increment : value])); }
export const db = { getAll: (...refs) => Promise.all(refs.map(ref => ref.get())), collection: name => new Query(name), runTransaction: async fn => {
  const writes = []; let wrote = false;
  const tx = {
    get: ref => { assert.equal(wrote, false, "all reads must happen before writes"); return ref.get(); },
    set: (ref, data, options) => { wrote = true; writes.push(() => store.set(ref.path, resolve(clone(data), options?.merge ? store.get(ref.path) : {}))); },
    update: (ref, data) => { wrote = true; writes.push(() => store.set(ref.path, { ...store.get(ref.path), ...resolve(clone(data), store.get(ref.path)) })); },
    create: (ref, data) => { wrote = true; assert.equal(store.has(ref.path), false); writes.push(() => store.set(ref.path, resolve(clone(data)))); },
    delete: ref => { wrote = true; writes.push(() => store.delete(ref.path)); }
  };
  const result = await fn(tx); writes.forEach(write => write()); return result;
} };

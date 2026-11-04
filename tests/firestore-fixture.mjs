import assert from "node:assert/strict";
export const store = new Map();
const clone = value => structuredClone(value);
const snapshot = ref => ({ id: ref.id, ref, exists: store.has(ref.path), data: () => clone(store.get(ref.path)) });
class Doc {
  constructor(path) { this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new Query(`${this.path}/${name}`); }
  get() { return Promise.resolve(snapshot(this)); }
  set(data) { store.set(this.path, clone(data)); return Promise.resolve(); }
}
class Query {
  constructor(path, filters = []) { this.path = path; this.filters = filters; }
  doc(id = `generated_${store.size}`) { return new Doc(`${this.path}/${id}`); }
  where(key, comparator, value) { return new Query(this.path, [...this.filters, [key, comparator, value]]); }
  orderBy() { return this; }
  limit() { return this; }
  get() {
    const docs = [...store.keys()].filter(path => path.startsWith(this.path + "/") && path.split("/").length === this.path.split("/").length + 1).sort().map(path => snapshot(new Doc(path))).filter(doc => this.filters.every(([key, comparator, value]) => comparator === "==" ? doc.data()[key] === value : doc.data()[key] > value));
    return Promise.resolve({ docs, empty: !docs.length });
  }
}
function resolve(data, current = {}) { return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value?.increment !== undefined ? (current[key] ?? 0) + value.increment : value])); }
export const db = { collection: name => new Query(name), runTransaction: async fn => {
  const writes = []; let wrote = false;
  const tx = {
    get: ref => { assert.equal(wrote, false, "all reads must happen before writes"); return ref.get(); },
    set: (ref, data, options) => { wrote = true; writes.push(() => store.set(ref.path, resolve(clone(data), options?.merge ? store.get(ref.path) : {}))); },
    update: (ref, data) => { wrote = true; writes.push(() => store.set(ref.path, { ...store.get(ref.path), ...resolve(clone(data), store.get(ref.path)) })); },
    delete: ref => { wrote = true; writes.push(() => store.delete(ref.path)); }
  };
  const result = await fn(tx); writes.forEach(write => write()); return result;
} };

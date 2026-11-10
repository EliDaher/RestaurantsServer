import { AsyncLocalStorage } from "node:async_hooks";
const context = new AsyncLocalStorage();
export const requestContext = (_req, _res, next) => context.run(new Map(), next);
export function oncePerRequest(key, load) {
    const scope = context.getStore();
    if (!scope)
        return load();
    const existing = scope.get(key);
    if (existing)
        return existing;
    const result = load();
    scope.set(key, result);
    return result;
}

import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

const context = new AsyncLocalStorage<Map<string, Promise<unknown>>>();
export const requestContext: RequestHandler = (_req, _res, next) => context.run(new Map(), next);
export function oncePerRequest<T>(key: string, load: () => Promise<T>): Promise<T> {
  const scope = context.getStore();
  if (!scope) return load();
  const existing = scope.get(key);
  if (existing) return existing as Promise<T>;
  const result = load();
  scope.set(key, result);
  return result;
}

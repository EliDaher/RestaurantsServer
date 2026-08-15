import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db, FieldValue } from "../config/firebase.js";
import type { AppUser, AuthUser } from "../types.js";
import { withId } from "../utils/firestore.js";
import { HttpError } from "../utils/http.js";

const scrypt = promisify(scryptCallback);
const users = db.collection("users");

export type UserCreateInput = Omit<AppUser, "id" | "passwordHash" | "createdAt" | "updatedAt"> & {
  password: string;
};

export type UserPatchInput = Partial<Omit<AppUser, "id" | "passwordHash" | "createdAt" | "updatedAt">> & {
  password?: string;
};

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [algorithm, salt, key] = passwordHash.split(":");
  if (algorithm !== "scrypt" || !salt || !key) {
    return false;
  }

  const storedKey = Buffer.from(key, "hex");
  const derivedKey = (await scrypt(password, salt, storedKey.length)) as Buffer;
  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}

export async function findUserByEmail(email: string) {
  const snapshot = await users.where("email", "==", email.toLowerCase()).limit(1).get();
  const doc = snapshot.docs[0];
  return doc ? withId<AppUser>(doc) : null;
}

export async function getUserById(userId: string) {
  const doc = await users.doc(userId).get();
  if (!doc.exists) {
    return null;
  }

  return withId<AppUser>(doc);
}

export async function assertUserExists(userId: string) {
  const user = await getUserById(userId);
  if (!user) {
    throw new HttpError(404, "User not found");
  }
  return user;
}

export async function listUsers() {
  const snapshot = await users.orderBy("createdAt", "desc").get();
  return snapshot.docs.map((doc) => sanitizeUser(withId<AppUser>(doc)));
}

export async function createUser(input: UserCreateInput) {
  const existing = await findUserByEmail(input.email);
  if (existing) {
    throw new HttpError(409, "User email already exists");
  }

  const ref = await users.add({
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash: await hashPassword(input.password),
    role: input.role,
    restaurantId: input.restaurantId ?? "",
    permissions: input.permissions ?? [],
    isActive: input.isActive,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  return { id: ref.id };
}

export async function updateUser(userId: string, input: UserPatchInput) {
  await assertUserExists(userId);

  if (input.email) {
    const existing = await findUserByEmail(input.email);
    if (existing && existing.id !== userId) {
      throw new HttpError(409, "User email already exists");
    }
  }

  const patch: Record<string, unknown> = {
    ...input,
    updatedAt: FieldValue.serverTimestamp()
  };

  if (input.email) {
    patch.email = input.email.toLowerCase();
  }

  if (input.password) {
    patch.passwordHash = await hashPassword(input.password);
    delete patch.password;
  }

  await users.doc(userId).update(patch);
}

export async function authenticateUser(email: string, password: string) {
  const user = await findUserByEmail(email);
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    throw new HttpError(401, "Invalid email or password");
  }

  return user;
}

export function sanitizeUser(user: AppUser): Omit<AppUser, "passwordHash"> {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export function toAuthUser(user: AppUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    restaurantId: user.restaurantId || undefined,
    permissions: user.permissions ?? []
  };
}

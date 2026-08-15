import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db, FieldValue } from "../config/firebase.js";
import { withId } from "../utils/firestore.js";
import { HttpError } from "../utils/http.js";
const scrypt = promisify(scryptCallback);
const users = db.collection("users");
export async function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const derivedKey = (await scrypt(password, salt, 64));
    return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}
export async function verifyPassword(password, passwordHash) {
    const [algorithm, salt, key] = passwordHash.split(":");
    if (algorithm !== "scrypt" || !salt || !key) {
        return false;
    }
    const storedKey = Buffer.from(key, "hex");
    const derivedKey = (await scrypt(password, salt, storedKey.length));
    return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}
export async function findUserByEmail(email) {
    const snapshot = await users.where("email", "==", email.toLowerCase()).limit(1).get();
    const doc = snapshot.docs[0];
    return doc ? withId(doc) : null;
}
export async function getUserById(userId) {
    const doc = await users.doc(userId).get();
    if (!doc.exists) {
        return null;
    }
    return withId(doc);
}
export async function assertUserExists(userId) {
    const user = await getUserById(userId);
    if (!user) {
        throw new HttpError(404, "User not found");
    }
    return user;
}
export async function listUsers() {
    const snapshot = await users.orderBy("createdAt", "desc").get();
    return snapshot.docs.map((doc) => sanitizeUser(withId(doc)));
}
export async function createUser(input) {
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
export async function updateUser(userId, input) {
    await assertUserExists(userId);
    if (input.email) {
        const existing = await findUserByEmail(input.email);
        if (existing && existing.id !== userId) {
            throw new HttpError(409, "User email already exists");
        }
    }
    const patch = {
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
export async function authenticateUser(email, password) {
    const user = await findUserByEmail(email);
    if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
        throw new HttpError(401, "Invalid email or password");
    }
    return user;
}
export function sanitizeUser(user) {
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
}
export function toAuthUser(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        restaurantId: user.restaurantId || undefined,
        permissions: user.permissions ?? []
    };
}

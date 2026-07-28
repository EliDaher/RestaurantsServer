function toIso(value) {
    if (value && typeof value === "object" && "toDate" in value) {
        return value.toDate().toISOString();
    }
    return value;
}
export function withId(doc) {
    const data = doc.data();
    return Object.fromEntries(Object.entries({ id: doc.id, ...data }).map(([key, value]) => [key, toIso(value)]));
}

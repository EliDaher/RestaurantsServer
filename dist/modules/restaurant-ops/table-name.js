export const duplicateTableNameMessage = "رقم الطاولة مستخدم بالفعل، اختر رقمًا آخر";
// Keep named-table semantics: do not fold case, punctuation or internal spaces.
export function normalizeTableName(name) {
    const value = name.trim();
    if (!/^[0-9٠-٩۰-۹]+$/.test(value))
        return value;
    const digits = value.replace(/[٠-٩۰-۹]/g, (digit) => {
        const code = digit.charCodeAt(0);
        return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });
    return digits.replace(/^0+(?=[0-9])/, "");
}
export function findTableNameDuplicates(tables) {
    const groups = new Map();
    for (const table of tables) {
        if (table.deletedAt)
            continue;
        const normalizedName = normalizeTableName(table.name);
        const group = groups.get(normalizedName) ?? [];
        group.push(table);
        groups.set(normalizedName, group);
    }
    return Array.from(groups, ([normalizedName, tables]) => ({ normalizedName, tables })).filter((group) => group.tables.length > 1);
}

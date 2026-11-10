export async function orderRecipes(tx, collection, lines) {
    const ids = [...new Set(lines.map(line => line.menuItemId))];
    const docs = [];
    for (let offset = 0; offset < ids.length; offset += 30) {
        const page = await tx.get(collection.where("menuItemId", "in", ids.slice(offset, offset + 30)));
        docs.push(...page.docs);
    }
    return { docs };
}

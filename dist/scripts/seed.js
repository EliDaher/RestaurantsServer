import { createCategory, createItem, createRestaurant, updateRestaurant } from "../services/restaurants.js";
import { createUser } from "../services/users.js";
const baseTheme = {
    primaryColor: "#b45309",
    secondaryColor: "#f59e0b",
    backgroundColor: "#fffaf0",
    textColor: "#1f2937",
    fontStyle: "cairo",
    cardStyle: "soft"
};
const restaurants = [
    {
        slug: "basic-demo",
        name: "مطعم سريع",
        logo: "",
        coverImage: "",
        description: "منيو خفيف وسريع للوجبات اليومية.",
        phone: "0990000001",
        address: "دمشق",
        currency: "SYP",
        isActive: true,
        plan: "basic",
        template: "minimal",
        theme: { ...baseTheme, primaryColor: "#0f766e", secondaryColor: "#14b8a6", backgroundColor: "#f8fafc" },
        ownerEmail: "owner.basic@example.com"
    },
    {
        slug: "standard-demo",
        name: "كافيه المدينة",
        logo: "",
        coverImage: "",
        description: "مشروبات وحلويات بتصميم دافئ ومريح.",
        phone: "0990000002",
        address: "دمشق - المزة",
        currency: "SYP",
        isActive: true,
        plan: "standard",
        template: "cafe",
        theme: { ...baseTheme, primaryColor: "#9a3412", secondaryColor: "#f97316", backgroundColor: "#fff7ed" },
        ownerEmail: "owner.standard@example.com"
    },
    {
        slug: "premium-demo",
        name: "مطعم ليالي",
        logo: "",
        coverImage: "",
        description: "تجربة فاخرة مع أطباق مختارة ومنتجات مميزة.",
        phone: "0990000003",
        address: "دمشق - أبو رمانة",
        currency: "SYP",
        isActive: true,
        plan: "premium",
        template: "premium",
        theme: { ...baseTheme, primaryColor: "#d4af37", secondaryColor: "#7c3aed", backgroundColor: "#09090b", textColor: "#ffffff", cardStyle: "glass" },
        ownerEmail: "owner.premium@example.com"
    }
];
async function seed() {
    const admin = await createUser({
        name: "Super Admin",
        email: "admin@example.com",
        password: "admin12345",
        role: "superAdmin",
        isActive: true
    });
    for (const restaurant of restaurants) {
        const { ownerEmail, ...restaurantInput } = restaurant;
        const createdRestaurant = await createRestaurant(restaurantInput);
        const owner = await createUser({
            name: `${restaurant.name} Owner`,
            email: ownerEmail,
            password: "owner12345",
            role: "restaurantOwner",
            restaurantId: createdRestaurant.id,
            isActive: true
        });
        await updateRestaurant(createdRestaurant.id, { ownerUserId: owner.id });
        const meals = await createCategory(createdRestaurant.id, { name: "الأطباق", order: 1, isActive: true });
        const drinks = await createCategory(createdRestaurant.id, { name: "المشروبات", order: 2, isActive: true });
        await createItem(createdRestaurant.id, {
            name: "طبق الشيف",
            description: "طبق يومي محضر بمكونات طازجة.",
            price: 45000,
            image: "",
            categoryId: meals.id,
            order: 1,
            isAvailable: true,
            isFeatured: restaurantInput.plan === "premium",
            badges: restaurantInput.plan === "basic" ? [] : ["popular"]
        });
        await createItem(createdRestaurant.id, {
            name: "مشروب خاص",
            description: "وصفة منعشة مناسبة لكل وقت.",
            price: 18000,
            image: "",
            categoryId: drinks.id,
            order: 1,
            isAvailable: true,
            isFeatured: false,
            badges: restaurantInput.plan === "basic" ? [] : ["new"]
        });
    }
    console.log("Seed completed");
    console.log("Super admin:", "admin@example.com", "admin12345", admin.id);
    console.log("Owner password for all demo owners:", "owner12345");
}
seed().catch((error) => {
    console.error(error);
    process.exit(1);
});

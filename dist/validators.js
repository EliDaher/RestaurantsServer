import { z } from "zod";
const templateSchema = z.enum(["minimal", "classic", "premium", "cafe", "pinza"]).default("classic");
const planSchema = z.enum(["basic", "standard", "premium"]).default("basic");
const roleSchema = z.enum(["superAdmin", "restaurantOwner"]);
const subscriptionStatusSchema = z.enum(["pendingApproval", "active", "pastDue", "suspended", "cancelled"]);
const billingCycleSchema = z.enum(["monthly", "yearly"]).default("monthly");
const customDomainStatusSchema = z.enum(["none", "pending", "verified", "rejected"]).default("none");
const themeSchema = z
    .object({
    primaryColor: z.string().default("#b45309"),
    secondaryColor: z.string().default("#f59e0b"),
    backgroundColor: z.string().default("#fffaf0"),
    textColor: z.string().default("#1f2937"),
    fontStyle: z.string().default("system"),
    cardStyle: z.string().default("soft")
})
    .default({});
export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
});
export const restaurantCreateSchema = z.object({
    slug: z.string().trim().min(2).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(2),
    logo: z.string().trim().default(""),
    coverImage: z.string().trim().default(""),
    description: z.string().trim().default(""),
    phone: z.string().trim().default(""),
    address: z.string().trim().default(""),
    currency: z.string().trim().default("SYP"),
    isActive: z.boolean().default(true),
    plan: planSchema,
    template: templateSchema,
    theme: themeSchema,
    ownerUserId: z.string().trim().optional(),
    subscriptionStatus: subscriptionStatusSchema.default("active"),
    billingCycle: billingCycleSchema.optional(),
    subscriptionStartsAt: z.string().trim().optional(),
    subscriptionEndsAt: z.string().trim().optional(),
    lastPaymentAt: z.string().trim().optional(),
    subscriptionNotes: z.string().trim().optional(),
    customDomain: z.string().trim().optional(),
    customDomainStatus: customDomainStatusSchema.optional(),
    customDomainVerifiedAt: z.string().trim().optional()
});
export const restaurantPatchSchema = restaurantCreateSchema.partial();
export const restaurantPlanPatchSchema = z.object({
    plan: planSchema,
    template: templateSchema.optional()
});
export const ownerRestaurantPatchSchema = restaurantCreateSchema
    .omit({ plan: true, ownerUserId: true })
    .partial();
export const ownerThemePatchSchema = z.object({
    template: templateSchema.optional(),
    theme: themeSchema.optional(),
    logo: z.string().trim().optional(),
    coverImage: z.string().trim().optional()
});
export const categoryCreateSchema = z.object({
    name: z.string().trim().min(1),
    order: z.coerce.number().int().min(0).default(0),
    isActive: z.boolean().default(true)
});
export const categoryPatchSchema = categoryCreateSchema.partial();
export const itemCreateSchema = z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().default(""),
    price: z.coerce.number().min(0),
    image: z.string().trim().default(""),
    categoryId: z.string().trim().min(1),
    order: z.coerce.number().int().min(0).default(0),
    isAvailable: z.boolean().default(true),
    isFeatured: z.boolean().default(false),
    badges: z.array(z.enum(["popular", "new", "spicy"])).default([])
});
export const itemPatchSchema = itemCreateSchema.partial();
export const userCreateSchema = z.object({
    name: z.string().trim().min(2),
    email: z.string().trim().email(),
    password: z.string().min(6),
    role: roleSchema,
    restaurantId: z.string().trim().optional(),
    isActive: z.boolean().default(true)
});
export const userPatchSchema = z
    .object({
    name: z.string().trim().min(2).optional(),
    email: z.string().trim().email().optional(),
    password: z.string().min(6).optional(),
    role: roleSchema.optional(),
    restaurantId: z.string().trim().optional(),
    isActive: z.boolean().optional()
})
    .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
});
export const signupSchema = z.object({
    ownerName: z.string().trim().min(2),
    email: z.string().trim().email(),
    password: z.string().min(6),
    restaurantName: z.string().trim().min(2),
    slug: z.string().trim().min(2).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    phone: z.string().trim().default(""),
    address: z.string().trim().default(""),
    plan: planSchema.default("basic"),
    billingCycle: billingCycleSchema
});
export const subscriptionPatchSchema = z.object({
    plan: planSchema.optional(),
    status: subscriptionStatusSchema,
    billingCycle: billingCycleSchema.optional(),
    startsAt: z.string().trim().optional(),
    endsAt: z.string().trim().optional(),
    notes: z.string().trim().default("")
});
export const paymentCreateSchema = z.object({
    amount: z.coerce.number().min(0),
    currency: z.string().trim().default("USD"),
    billingCycle: billingCycleSchema,
    paidAt: z.string().trim().optional(),
    extendMonths: z.coerce.number().int().min(0).max(36).default(1),
    notes: z.string().trim().default("")
});
export const domainPatchSchema = z.object({
    customDomain: z.string().trim().toLowerCase().optional(),
    customDomainStatus: customDomainStatusSchema
});
export const uploadImageSchema = z.object({
    fileName: z.string().trim().default("upload.jpg"),
    dataUrl: z.string().min(32)
});

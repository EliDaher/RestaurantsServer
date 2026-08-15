import { HttpError } from "../utils/http.js";
export const planTemplates = {
    basic: ["minimal", "classic"],
    standard: ["classic", "cafe"],
    premium: ["premium", "pinza", "cafe", "classic"]
};
export const planFallbackTemplate = {
    basic: "minimal",
    standard: "classic",
    premium: "premium"
};
export const planLimits = {
    basic: {
        maxCategories: 5,
        maxItems: 50,
        allowFeatured: false,
        allowBadges: false,
        allowCustomDomain: false
    },
    standard: {
        maxCategories: 15,
        maxItems: 150,
        allowFeatured: false,
        allowBadges: true,
        allowCustomDomain: false
    },
    premium: {
        maxCategories: 50,
        maxItems: 500,
        allowFeatured: true,
        allowBadges: true,
        allowCustomDomain: true
    }
};
export const defaultModules = {
    menu: true,
    orders: false,
    tables: false,
    pos: false,
    accounting: false,
    inventory: false,
    purchasing: false,
    kitchen: false,
    reports: false,
    expenses: false,
    payments: false,
    staff: false
};
export const planModules = {
    basic: {
        menu: true
    },
    standard: {
        menu: true,
        orders: true,
        tables: true,
        pos: true,
        payments: true,
        reports: true
    },
    premium: {
        menu: true,
        orders: true,
        tables: true,
        pos: true,
        accounting: true,
        inventory: true,
        purchasing: true,
        kitchen: true,
        reports: true,
        expenses: true,
        payments: true,
        staff: true
    }
};
export function normalizeTemplateForPlan(plan, template) {
    if (template && planTemplates[plan].includes(template)) {
        return template;
    }
    return planFallbackTemplate[plan];
}
export function normalizeRestaurantPlan(input) {
    const plan = input.plan ?? "basic";
    return {
        ...input,
        plan,
        template: normalizeTemplateForPlan(plan, input.template),
        modules: normalizeModules(plan, input.modules)
    };
}
export function normalizeModules(plan, modules) {
    return {
        ...defaultModules,
        ...planModules[plan],
        ...modules
    };
}
export function hasFeature(restaurant, feature) {
    const plan = restaurant.plan ?? "basic";
    return normalizeModules(plan, restaurant.modules)[feature];
}
export function assertFeature(restaurant, feature) {
    if (!hasFeature(restaurant, feature)) {
        throw new HttpError(403, `The ${feature} module is not enabled for this restaurant`);
    }
}
export function assertTemplateAllowed(plan, template) {
    if (template && !planTemplates[plan].includes(template)) {
        throw new HttpError(400, `Template "${template}" is not available for the ${plan} plan`, {
            allowedTemplates: planTemplates[plan],
            fallbackTemplate: planFallbackTemplate[plan]
        });
    }
}
export function enforceItemPlanRules(plan, input, strict = false) {
    const limits = planLimits[plan];
    if (!limits.allowFeatured && input.isFeatured) {
        if (strict) {
            throw new HttpError(400, "Featured items are available only for premium restaurants");
        }
        return {
            ...input,
            isFeatured: false
        };
    }
    if (!limits.allowBadges && input.badges?.length) {
        if (strict) {
            throw new HttpError(400, "Badges are available only for standard and premium restaurants");
        }
        return {
            ...input,
            badges: []
        };
    }
    return input;
}
export function assertCategoryLimit(plan, currentCount) {
    const limit = planLimits[plan].maxCategories;
    if (currentCount >= limit) {
        throw new HttpError(403, `This plan allows up to ${limit} categories`);
    }
}
export function assertItemLimit(plan, currentCount) {
    const limit = planLimits[plan].maxItems;
    if (currentCount >= limit) {
        throw new HttpError(403, `This plan allows up to ${limit} items`);
    }
}
export function assertCustomDomainAllowed(plan) {
    if (!planLimits[plan].allowCustomDomain) {
        throw new HttpError(403, "Custom domains are available only for premium restaurants");
    }
}

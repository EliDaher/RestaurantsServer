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
        template: normalizeTemplateForPlan(plan, input.template)
    };
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

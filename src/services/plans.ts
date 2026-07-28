import type { MenuItem, MenuTemplate, Restaurant, RestaurantPlan } from "../types.js";
import { HttpError } from "../utils/http.js";

export const planTemplates: Record<RestaurantPlan, MenuTemplate[]> = {
  basic: ["minimal", "classic"],
  standard: ["classic", "cafe"],
  premium: ["premium", "pinza", "cafe", "classic"]
};

export const planFallbackTemplate: Record<RestaurantPlan, MenuTemplate> = {
  basic: "minimal",
  standard: "classic",
  premium: "premium"
};

export const planLimits: Record<
  RestaurantPlan,
  {
    maxCategories: number;
    maxItems: number;
    allowFeatured: boolean;
    allowBadges: boolean;
    allowCustomDomain: boolean;
  }
> = {
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

export function normalizeTemplateForPlan(plan: RestaurantPlan, template?: MenuTemplate) {
  if (template && planTemplates[plan].includes(template)) {
    return template;
  }

  return planFallbackTemplate[plan];
}

export function normalizeRestaurantPlan(input: Partial<Restaurant>) {
  const plan = input.plan ?? "basic";
  return {
    ...input,
    plan,
    template: normalizeTemplateForPlan(plan, input.template)
  };
}

export function assertTemplateAllowed(plan: RestaurantPlan, template?: MenuTemplate) {
  if (template && !planTemplates[plan].includes(template)) {
    throw new HttpError(400, `Template "${template}" is not available for the ${plan} plan`, {
      allowedTemplates: planTemplates[plan],
      fallbackTemplate: planFallbackTemplate[plan]
    });
  }
}

export function enforceItemPlanRules(plan: RestaurantPlan, input: Partial<MenuItem>, strict = false) {
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

export function assertCategoryLimit(plan: RestaurantPlan, currentCount: number) {
  const limit = planLimits[plan].maxCategories;
  if (currentCount >= limit) {
    throw new HttpError(403, `This plan allows up to ${limit} categories`);
  }
}

export function assertItemLimit(plan: RestaurantPlan, currentCount: number) {
  const limit = planLimits[plan].maxItems;
  if (currentCount >= limit) {
    throw new HttpError(403, `This plan allows up to ${limit} items`);
  }
}

export function assertCustomDomainAllowed(plan: RestaurantPlan) {
  if (!planLimits[plan].allowCustomDomain) {
    throw new HttpError(403, "Custom domains are available only for premium restaurants");
  }
}

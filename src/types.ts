export type MenuTemplate = "minimal" | "classic" | "premium" | "cafe" | "pinza";
export type RestaurantPlan = "basic" | "standard" | "premium";
export type UserRole = "superAdmin" | "restaurantOwner";
export type SubscriptionStatus = "pendingApproval" | "active" | "pastDue" | "suspended" | "cancelled";
export type BillingCycle = "monthly" | "yearly";
export type CustomDomainStatus = "none" | "pending" | "verified" | "rejected";

export type Theme = {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  fontStyle: string;
  cardStyle: string;
};

export type Restaurant = {
  id: string;
  slug: string;
  name: string;
  logo: string;
  coverImage: string;
  description: string;
  phone: string;
  address: string;
  currency: string;
  isActive: boolean;
  plan: RestaurantPlan;
  template: MenuTemplate;
  theme: Theme;
  ownerUserId?: string;
  subscriptionStatus?: SubscriptionStatus;
  billingCycle?: BillingCycle;
  subscriptionStartsAt?: string;
  subscriptionEndsAt?: string;
  lastPaymentAt?: string;
  subscriptionNotes?: string;
  customDomain?: string;
  customDomainStatus?: CustomDomainStatus;
  customDomainVerifiedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Category = {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
};

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  categoryId: string;
  order: number;
  isAvailable: boolean;
  isFeatured: boolean;
  badges: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type AuthUser = {
  id?: string;
  email: string;
  name?: string;
  role: UserRole;
  restaurantId?: string;
};

export type AppUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  restaurantId?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type Payment = {
  id: string;
  restaurantId: string;
  amount: number;
  currency: string;
  billingCycle: BillingCycle;
  paidAt: string;
  notes: string;
  createdAt?: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

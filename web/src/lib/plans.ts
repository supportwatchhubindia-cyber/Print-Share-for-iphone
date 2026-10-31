import type { SubscriptionPlan } from "./constants";

export type PlanDefinition = {
  id: SubscriptionPlan;
  name: string;
  priceMonthly: number;
  currency: "INR";
  monthlyPageLimit: number;
  maxPrinters: number;
  tagline: string;
  features: string[];
  highlighted?: boolean;
};

export const PLANS: Record<SubscriptionPlan, PlanDefinition> = {
  FREE: {
    id: "FREE",
    name: "Personal",
    priceMonthly: 0,
    currency: "INR",
    monthlyPageLimit: 100,
    maxPrinters: 1,
    tagline: "For printing at home from your phone.",
    features: ["100 pages / month", "1 printer", "1 Windows bridge", "PDF, images, Office & text", "24-hour auto-delete"],
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    priceMonthly: 199,
    currency: "INR",
    monthlyPageLimit: 2000,
    maxPrinters: 5,
    tagline: "For freelancers and busy households.",
    features: ["2,000 pages / month", "Up to 5 printers", "Multiple bridges", "Priority conversion queue", "Job history export"],
    highlighted: true,
  },
  BUSINESS: {
    id: "BUSINESS",
    name: "Business",
    priceMonthly: 799,
    currency: "INR",
    monthlyPageLimit: 20000,
    maxPrinters: 50,
    tagline: "For shops, offices and print counters.",
    features: ["20,000 pages / month", "Up to 50 printers", "Admin dashboard", "Audit logs", "Email support"],
  },
};

export function formatPrice(plan: PlanDefinition): string {
  if (plan.priceMonthly === 0) return "Free";
  return `₹${plan.priceMonthly.toLocaleString("en-IN")}`;
}

export type PlanName = "free" | "pro" | "business";

export type UsageAllowance = {
  allowed: boolean;
  plan: PlanName;
  remainingCredits: number | null;
  reason?: string;
};

const PLAN_LIMITS: Record<PlanName, { monthlyCredits: number | null; maxFileSizeMb: number }> = {
  free: { monthlyCredits: Number(process.env.FREE_PLAN_MONTHLY_CREDITS ?? "50"), maxFileSizeMb: 20 },
  pro: { monthlyCredits: Number(process.env.PRO_PLAN_MONTHLY_CREDITS ?? "1000"), maxFileSizeMb: 100 },
  business: { monthlyCredits: null, maxFileSizeMb: 250 },
};

export function normalizePlan(plan: string | undefined): PlanName {
  if (plan === "pro" || plan === "business") {
    return plan;
  }

  return "free";
}

export function checkUsageAllowance(params: {
  plan?: string;
  estimatedCredits?: number;
  usedCredits?: number;
}): UsageAllowance {
  const plan = normalizePlan(params.plan);
  const limit = PLAN_LIMITS[plan].monthlyCredits;
  const usedCredits = Math.max(0, params.usedCredits ?? 0);
  const estimatedCredits = Math.max(1, params.estimatedCredits ?? 1);

  if (limit === null) {
    return { allowed: true, plan, remainingCredits: null };
  }

  const remainingCredits = Math.max(0, limit - usedCredits);
  if (remainingCredits < estimatedCredits) {
    return {
      allowed: false,
      plan,
      remainingCredits,
      reason: "Monthly usage credit limit reached.",
    };
  }

  return { allowed: true, plan, remainingCredits: remainingCredits - estimatedCredits };
}

export function planLimits(plan: string | undefined): { plan: PlanName; monthlyCredits: number | null; maxFileSizeMb: number } {
  const normalized = normalizePlan(plan);
  return { plan: normalized, ...PLAN_LIMITS[normalized] };
}

import { requireCurrentUser } from "../../_lib/auth";
import { getBillingCustomer } from "../../_lib/supabase";
import {
  stripeConfigured,
  stripePriceId,
  stripePublishableKey,
  subscriptionStatusIsActive,
} from "../../_lib/stripe";
import type { WorkerEnv } from "../../_lib/types";

export const onRequestGet: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  const row = await getBillingCustomer(env, user.id).catch(() => null);
  const status = String(row?.status || "free").toLowerCase();
  return Response.json({
    configured: stripeConfigured(env),
    publishableKeyConfigured: Boolean(stripePublishableKey(env)),
    priceConfigured: Boolean(stripePriceId(env)),
    plan: subscriptionStatusIsActive(status) ? "pro" : "free",
    status,
    currentPeriodEnd: row?.current_period_end || null,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    hasStripeCustomer: Boolean(row?.stripe_customer_id),
  });
};

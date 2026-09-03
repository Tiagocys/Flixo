import { requireCurrentUser } from "../../_lib/auth";
import { getBillingCustomer, upsertBillingCustomer } from "../../_lib/supabase";
import { createStripeCheckoutSession, stripeConfigured, stripePriceId } from "../../_lib/stripe";
import type { WorkerEnv } from "../../_lib/types";

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  if (!stripeConfigured(env)) {
    return Response.json(
      {
        error: "Stripe nao configurada.",
        message: stripePriceId(env)
          ? "Configure STRIPE_SECRET_KEY antes de iniciar assinaturas."
          : "Configure STRIPE_PRICE_ID com o Price ID do plano no Stripe.",
      },
      { status: 503 }
    );
  }
  const origin = new URL(request.url).origin;
  const billing = await getBillingCustomer(env, user.id).catch(() => null);
  const session = await createStripeCheckoutSession(env, {
    userId: user.id,
    email: user.email,
    origin,
    stripeCustomerId: billing?.stripe_customer_id || null,
  });
  await upsertBillingCustomer(env, {
    user_id: user.id,
    email: user.email,
    stripe_customer_id: billing?.stripe_customer_id || null,
    stripe_price_id: stripePriceId(env),
    status: billing?.status || "checkout_started",
    metadata: {
      ...(billing?.metadata || {}),
      latest_checkout_session_id: session.id,
    },
  }).catch(() => null);
  return Response.json({ url: session.url, id: session.id });
};

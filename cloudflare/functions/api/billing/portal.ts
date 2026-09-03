import { requireCurrentUser } from "../../_lib/auth";
import { getBillingCustomer } from "../../_lib/supabase";
import { createStripePortalSession, stripeSecretKey } from "../../_lib/stripe";
import type { WorkerEnv } from "../../_lib/types";

export const onRequestPost: PagesFunction<WorkerEnv> = async ({ request, env }) => {
  const user = await requireCurrentUser(request, env);
  if (user instanceof Response) return user;
  if (!stripeSecretKey(env)) {
    return Response.json(
      { error: "Stripe nao configurada.", message: "Configure STRIPE_SECRET_KEY." },
      { status: 503 }
    );
  }
  const billing = await getBillingCustomer(env, user.id).catch(() => null);
  if (!billing?.stripe_customer_id) {
    return Response.json(
      { error: "Assinatura nao encontrada.", message: "Crie uma assinatura antes de gerenciar o plano." },
      { status: 404 }
    );
  }
  const session = await createStripePortalSession(env, {
    stripeCustomerId: billing.stripe_customer_id,
    origin: new URL(request.url).origin,
  });
  return Response.json({ url: session.url });
};

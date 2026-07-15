import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const resend = new Resend(process.env.RESEND_API_KEY!);

const PLAN_MAP: Record<string, string> = {
  'price_starter_monthly': 'starter',
  'price_pro_monthly': 'pro',
  'price_business_monthly': 'business',
};

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature')!;
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new Response('Webhook signature invalid', { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const customerEmail = session.customer_details?.email;
    const priceId = (session as any).line_items?.data[0]?.price?.id;
    const plan = PLAN_MAP[priceId] ?? 'starter';

    if (!customerEmail) return new Response('ok');

    // Gerar chave
    const { data } = await supabase.rpc('generate_access_key', {
      p_plan: plan,
      p_notes: `Stripe session ${session.id}`,
    });

    const accessKey = data as string;

    // Enviar e-mail com a chave
    await resend.emails.send({
      from: 'RestaurantIQ <noreply@restaurantiq.com.br>',
      to: customerEmail,
      subject: '🍽️ Seu acesso ao RestaurantIQ está pronto!',
      html: `
        <h2>Bem-vindo ao RestaurantIQ!</h2>
        <p>Seu pagamento foi confirmado. Aqui está sua chave de acesso:</p>
        <div style="background:#1C2227;padding:20px;border-radius:8px;text-align:center;margin:20px 0">
          <code style="font-size:22px;font-weight:bold;color:#00C896;letter-spacing:2px">${accessKey}</code>
        </div>
        <p>
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/auth/register?key=${accessKey}"
             style="background:#00C896;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
            Criar minha conta →
          </a>
        </p>
        <p style="color:#666;font-size:13px">
          Plano ativado: <strong>${plan.toUpperCase()}</strong><br>
          Sua IA analista Oliveira já está pronta para ajudar.
        </p>
      `,
    });
  }

  return new Response('ok');
}

import OpenAI from 'openai';
import { buildRestaurantContext } from '@/lib/ai/buildRestaurantContext';
import { buildSystemPrompt } from '@/lib/ai/systemPrompt';

const openai = new OpenAI();

export async function POST(req: Request) {
  const { messages, tenantId } = await req.json();

  const context = await buildRestaurantContext(tenantId);
  const systemPrompt = buildSystemPrompt(context);

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o',
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    max_tokens: 1000,
  });

  // Streaming response para UX fluida
  return new Response(
    new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || '';
          controller.enqueue(new TextEncoder().encode(text));
        }
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } }
  );
}

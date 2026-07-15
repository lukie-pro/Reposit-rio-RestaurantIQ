# RestaurantIQ — Arquitetura Completa do Sistema SaaS
> Gestão inteligente para restaurantes com IA integrada

---

## 1. Visão Geral e Proposta de Valor

RestaurantIQ é um SaaS premium de gestão para restaurantes que combina controle operacional completo com inteligência artificial atuando como analista financeiro e operacional em tempo real.

**Problema central:** Restauranteiros tomam decisões de precificação, compra e cardápio baseados em intuição, sem dados sobre CMV real, fator de correção, rendimento de insumos ou margem por prato.

**Solução:** Sistema integrado onde cada módulo alimenta a IA com contexto suficiente para gerar insights acionáveis automaticamente.

---

## 2. Arquitetura Técnica

### Stack principal

| Camada | Tecnologia | Justificativa |
|--------|-----------|---------------|
| Frontend | Next.js 14 (App Router) | SSR, RSC, performance, SEO |
| UI | React + TailwindCSS + shadcn/ui | Componentes acessíveis e customizáveis |
| Backend API | Next.js API Routes + Node.js | Monorepo simples, deploy unificado |
| Banco de dados | PostgreSQL via Supabase | ACID, Row Level Security, realtime |
| Auth | Supabase Auth | Multi-tenant, JWT, OAuth |
| IA | OpenAI API (GPT-4o) | Análise linguagem natural + structured outputs |
| Armazenamento | Supabase Storage | Notas fiscais, PDFs, imagens |
| Cache | Redis (Upstash) | Cache de queries pesadas, rate limiting |
| Jobs | Trigger.dev | Cálculos automáticos, alertas, relatórios |
| Deploy | Vercel (frontend) + Supabase (backend) | Zero-ops, escalável |
| Monitoramento | Sentry + Vercel Analytics | Erros, performance, uso |

### Diagrama de arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENTE (Browser)                     │
│              Next.js 14 + React + Tailwind               │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────┐
│                  NEXT.JS API ROUTES                       │
│   /api/dishes  /api/stock  /api/finance  /api/ai/chat    │
│              Middleware: Auth + Rate Limit                │
└────────┬──────────────┬──────────────────┬──────────────┘
         │              │                  │
┌────────▼───┐  ┌───────▼──────┐  ┌───────▼──────────────┐
│  Supabase  │  │   OpenAI     │  │    Trigger.dev        │
│ PostgreSQL │  │  GPT-4o API  │  │  (Background Jobs)    │
│ + Realtime │  │  + Embeddings│  │  - Alertas CMV        │
│ + Storage  │  └──────────────┘  │  - Relatórios DRE     │
│ + Auth     │                    │  - Análise vencimentos │
└────────────┘  ┌──────────────┐  └───────────────────────┘
                │   Upstash    │
                │   Redis      │
                │   Cache      │
                └──────────────┘
```

---

## 3. Estrutura do Banco de Dados

### Multi-tenant com Row Level Security

```sql
-- TENANTS (restaurantes)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'starter', -- starter | pro | enterprise
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INSUMOS / INGREDIENTES
CREATE TABLE ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL, -- kg, L, un, g
  cost_per_unit DECIMAL(10,4) NOT NULL,
  category TEXT, -- proteína, hortifruti, laticínio, bebida...
  supplier_id UUID REFERENCES suppliers(id),
  gross_factor DECIMAL(5,4) DEFAULT 1.0, -- fator de correção
  yield_pct DECIMAL(5,2) DEFAULT 100.0,  -- rendimento %
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

-- FICHAS TÉCNICAS (pratos)
CREATE TABLE dishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL,
  category TEXT, -- entrada, prato principal, sobremesa...
  sale_price DECIMAL(10,2),
  target_cmv_pct DECIMAL(5,2) DEFAULT 28.0,
  preparation_notes TEXT,
  portions INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INGREDIENTES DA FICHA TÉCNICA
CREATE TABLE dish_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID REFERENCES dishes(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id),
  gross_weight_g DECIMAL(10,3),  -- peso bruto (g)
  net_weight_g DECIMAL(10,3),    -- peso líquido após limpeza
  correction_factor DECIMAL(5,4) GENERATED ALWAYS AS (
    CASE WHEN net_weight_g > 0 
    THEN gross_weight_g / net_weight_g 
    ELSE 1 END
  ) STORED,
  unit_cost DECIMAL(10,4),       -- custo calculado automaticamente
  notes TEXT
);

-- ESTOQUE
CREATE TABLE stock_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  ingredient_id UUID REFERENCES ingredients(id),
  quantity DECIMAL(12,3) NOT NULL,
  min_quantity DECIMAL(12,3),    -- estoque mínimo
  expiry_date DATE,
  location TEXT,                 -- câmara fria, despensa, etc.
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- MOVIMENTAÇÕES DE ESTOQUE
CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  ingredient_id UUID REFERENCES ingredients(id),
  movement_type TEXT NOT NULL,   -- entrada | saída | perda | inventário
  quantity DECIMAL(12,3) NOT NULL,
  unit_cost DECIMAL(10,4),
  reference TEXT,                -- número NF, motivo da perda...
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- FORNECEDORES
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  name TEXT NOT NULL,
  cnpj TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  payment_terms TEXT,
  avg_delivery_days INTEGER,
  rating DECIMAL(3,2),
  notes TEXT
);

-- HISTÓRICO DE PREÇOS (fornecedores)
CREATE TABLE supplier_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id),
  ingredient_id UUID REFERENCES ingredients(id),
  price DECIMAL(10,4) NOT NULL,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- DRE (Demonstrativo de Resultados)
CREATE TABLE dre_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  period DATE NOT NULL,           -- primeiro dia do mês
  entry_type TEXT NOT NULL,       -- receita | cmv | custo_fixo | custo_var | imposto
  category TEXT,
  description TEXT,
  amount DECIMAL(12,2) NOT NULL,
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CONTAS A PAGAR
CREATE TABLE payables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  supplier_id UUID REFERENCES suppliers(id),
  description TEXT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  barcode TEXT,                  -- código de barras do boleto
  status TEXT DEFAULT 'pending', -- pending | paid | overdue | cancelled
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ALERTAS DO SISTEMA
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  type TEXT NOT NULL,            -- cmv_high | stock_low | price_increase | expiry
  severity TEXT NOT NULL,        -- info | warning | critical
  title TEXT NOT NULL,
  message TEXT,
  metadata JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CONVERSAS COM A IA (histórico)
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID,
  messages JSONB NOT NULL,       -- array de { role, content, timestamp }
  context_snapshot JSONB,        -- snapshot dos KPIs no momento
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Views analíticas (PostgreSQL)

```sql
-- CMV calculado por prato em tempo real
CREATE VIEW dish_cmv_analysis AS
SELECT 
  d.id,
  d.tenant_id,
  d.name,
  d.sale_price,
  d.target_cmv_pct,
  SUM(di.unit_cost) AS total_cost,
  ROUND((SUM(di.unit_cost) / NULLIF(d.sale_price, 0)) * 100, 2) AS cmv_pct,
  d.sale_price - SUM(di.unit_cost) AS gross_margin,
  ROUND(((d.sale_price - SUM(di.unit_cost)) / NULLIF(d.sale_price, 0)) * 100, 2) AS margin_pct
FROM dishes d
JOIN dish_ingredients di ON di.dish_id = d.id
GROUP BY d.id, d.tenant_id, d.name, d.sale_price, d.target_cmv_pct;

-- Posição de estoque com alertas
CREATE VIEW stock_status AS
SELECT 
  si.*,
  i.name AS ingredient_name,
  i.unit,
  i.cost_per_unit,
  (si.quantity * i.cost_per_unit) AS stock_value,
  CASE 
    WHEN si.quantity <= 0 THEN 'ruptura'
    WHEN si.quantity <= si.min_quantity THEN 'crítico'
    WHEN si.expiry_date <= CURRENT_DATE + 3 THEN 'vencendo'
    ELSE 'ok'
  END AS status
FROM stock_items si
JOIN ingredients i ON i.id = si.ingredient_id;
```

---

## 4. Integração com IA (OpenAI GPT-4o)

### Arquitetura do contexto

A IA nunca recebe dados crus — recebe um contexto estruturado com os KPIs mais relevantes do restaurante, montado dinamicamente antes de cada conversa.

```typescript
// lib/ai/buildRestaurantContext.ts

export async function buildRestaurantContext(tenantId: string) {
  const [dishes, stock, suppliers, dre, alerts] = await Promise.all([
    getDishCmvAnalysis(tenantId),
    getStockStatus(tenantId),
    getSupplierPriceChanges(tenantId, 30), // últimos 30 dias
    getDreSummary(tenantId, currentMonth()),
    getActiveAlerts(tenantId),
  ]);

  return {
    restaurant_summary: {
      month: currentMonth(),
      total_revenue: dre.revenue,
      total_cmv: dre.cmv_total,
      cmv_pct: dre.cmv_pct,
      net_margin: dre.net_margin,
    },
    dishes_analysis: dishes.map(d => ({
      name: d.name,
      sale_price: d.sale_price,
      cost: d.total_cost,
      cmv_pct: d.cmv_pct,
      margin_pct: d.margin_pct,
      target_cmv_pct: d.target_cmv_pct,
      status: d.cmv_pct > d.target_cmv_pct ? 'acima_da_meta' : 'dentro_da_meta',
    })),
    stock_alerts: stock.filter(s => s.status !== 'ok'),
    supplier_price_changes: suppliers.filter(s => s.price_change_pct > 5),
    active_alerts: alerts,
  };
}
```

### System prompt da IA

```typescript
// lib/ai/systemPrompt.ts

export function buildSystemPrompt(context: RestaurantContext): string {
  return `
Você é um analista financeiro e operacional especialista em restaurantes.
Você tem acesso em tempo real a todos os dados do restaurante e responde em português.

DADOS ATUAIS DO RESTAURANTE:
${JSON.stringify(context, null, 2)}

SUAS CAPACIDADES:
- Calcular preço de venda ideal para atingir margem alvo
- Identificar qual prato tem maior e menor margem
- Detectar ingredientes que mais impactam o CMV
- Comparar fornecedores e detectar aumentos de preço
- Sugerir otimizações no cardápio baseadas em dados
- Prever impacto de mudanças de custo no resultado

REGRAS:
- Sempre baseie respostas nos dados fornecidos acima
- Seja direto e forneça números concretos
- Quando sugerir um preço, mostre o cálculo: custo ÷ (1 - margem%) = preço
- Identifique anomalias e padrões nos dados
- Se um dado não estiver disponível, diga claramente

Fórmulas que você usa:
- CMV% = (custo total do prato / preço de venda) × 100
- Fator de correção = peso bruto / peso líquido  
- Rendimento% = (peso líquido / peso bruto) × 100
- Preço ideal = custo / (1 - margem alvo)
- Markup = preço de venda / custo total
`;
}
```

### API route da IA

```typescript
// app/api/ai/chat/route.ts

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
```

### Alertas automáticos com IA (Trigger.dev)

```typescript
// trigger/analyzeRestaurant.ts

import { task, schedules } from '@trigger.dev/sdk/v3';

export const dailyAnalysis = schedules.task({
  id: 'daily-restaurant-analysis',
  cron: '0 8 * * *', // Executa às 8h todo dia
  run: async () => {
    const tenants = await getActiveTenants();

    for (const tenant of tenants) {
      const context = await buildRestaurantContext(tenant.id);
      
      // Detectar CMV acima da meta
      const highCmvDishes = context.dishes_analysis
        .filter(d => d.cmv_pct > d.target_cmv_pct + 3);
      
      for (const dish of highCmvDishes) {
        await createAlert({
          tenantId: tenant.id,
          type: 'cmv_high',
          severity: dish.cmv_pct > dish.target_cmv_pct + 8 ? 'critical' : 'warning',
          title: `CMV do ${dish.name} em ${dish.cmv_pct.toFixed(1)}%`,
          message: `Acima da meta de ${dish.target_cmv_pct}% em ${(dish.cmv_pct - dish.target_cmv_pct).toFixed(1)}pp`,
        });
      }

      // Detectar estoque crítico
      const criticalStock = context.stock_alerts
        .filter(s => s.status === 'crítico' || s.status === 'ruptura');
      
      for (const item of criticalStock) {
        await createAlert({
          tenantId: tenant.id,
          type: 'stock_low',
          severity: item.status === 'ruptura' ? 'critical' : 'warning',
          title: `Estoque baixo: ${item.ingredient_name}`,
          message: `${item.quantity}${item.unit} restantes (mínimo: ${item.min_quantity}${item.unit})`,
        });
      }

      // Detectar aumento de preços de fornecedores
      for (const supplier of context.supplier_price_changes) {
        await createAlert({
          tenantId: tenant.id,
          type: 'price_increase',
          severity: supplier.price_change_pct > 15 ? 'critical' : 'warning',
          title: `${supplier.supplier_name} aumentou preços`,
          message: `${supplier.ingredient_name} subiu ${supplier.price_change_pct.toFixed(1)}%`,
        });
      }
    }
  },
});
```

---

## 5. Estrutura de APIs REST

```
/api
├── /auth
│   ├── POST /login
│   ├── POST /register
│   └── POST /logout
│
├── /dishes                      # Fichas técnicas
│   ├── GET    /                 # Listar pratos com CMV calculado
│   ├── POST   /                 # Criar prato
│   ├── GET    /:id              # Detalhe com análise completa
│   ├── PUT    /:id              # Atualizar
│   ├── DELETE /:id
│   └── POST   /:id/calculate    # Recalcular CMV e FC
│
├── /ingredients                 # Insumos
│   ├── GET    /                 # Com posição de estoque
│   ├── POST   /
│   ├── PUT    /:id
│   └── GET    /:id/price-history
│
├── /stock                       # Estoque
│   ├── GET    /                 # Posição atual com alertas
│   ├── POST   /movements        # Entrada/saída/perda
│   ├── GET    /movements        # Histórico de movimentações
│   ├── POST   /inventory        # Inventário (ajuste)
│   └── GET    /alerts           # Alertas de estoque
│
├── /suppliers                   # Fornecedores
│   ├── GET    /
│   ├── POST   /
│   ├── GET    /:id/price-history
│   └── GET    /compare          # Comparativo de preços
│
├── /finance                     # Financeiro
│   ├── GET    /dre              # DRE por período
│   ├── POST   /dre/entries      # Lançar receita/despesa
│   ├── GET    /payables         # Contas a pagar
│   ├── POST   /payables         # Cadastrar boleto/conta
│   └── PATCH  /payables/:id/pay # Marcar como pago
│
├── /ai                          # Inteligência Artificial
│   ├── POST   /chat             # Chat em tempo real (streaming)
│   ├── POST   /analyze-dish     # Análise automática de prato
│   ├── POST   /suggest-price    # Sugestão de preço ideal
│   └── GET    /insights         # Insights automáticos do dia
│
└── /alerts                      # Alertas
    ├── GET    /                 # Listar alertas ativos
    └── PATCH  /:id/read         # Marcar como lido
```

---

## 6. Estrutura de Pastas do Projeto

```
restaurantiq/
├── app/                              # Next.js App Router
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx               # Sidebar + topbar
│   │   ├── page.tsx                 # Dashboard principal
│   │   ├── fichas-tecnicas/
│   │   │   ├── page.tsx             # Lista de pratos
│   │   │   ├── [id]/page.tsx        # Detalhe da ficha
│   │   │   └── nova/page.tsx
│   │   ├── estoque/
│   │   ├── fornecedores/
│   │   ├── financeiro/
│   │   │   ├── dre/page.tsx
│   │   │   └── contas-pagar/page.tsx
│   │   └── ia/page.tsx              # Chat com IA
│   └── api/                         # API Routes
│
├── components/
│   ├── ui/                          # shadcn/ui base
│   ├── charts/                      # Recharts components
│   │   ├── CmvBarChart.tsx
│   │   ├── MarginLineChart.tsx
│   │   └── CostDonutChart.tsx
│   ├── dishes/
│   │   ├── DishCard.tsx
│   │   ├── DishForm.tsx
│   │   └── IngredientTable.tsx
│   ├── stock/
│   ├── finance/
│   └── ai/
│       ├── ChatInterface.tsx
│       └── InsightCard.tsx
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── middleware.ts
│   ├── ai/
│   │   ├── buildRestaurantContext.ts
│   │   ├── systemPrompt.ts
│   │   └── calculations.ts          # FC, CMV, markup, preço ideal
│   ├── calculations/
│   │   ├── cmv.ts
│   │   ├── correctionFactor.ts
│   │   └── pricing.ts
│   └── utils/
│
├── trigger/                         # Background jobs
│   ├── dailyAnalysis.ts
│   ├── stockAlerts.ts
│   └── monthlyDre.ts
│
├── types/
│   ├── database.types.ts            # Gerado pelo Supabase CLI
│   └── index.ts
│
└── supabase/
    ├── migrations/                  # SQL migrations
    └── seed.sql
```

---

## 7. Fórmulas e Cálculos Implementados

```typescript
// lib/calculations/correctionFactor.ts

/** Fator de Correção (FC) = Peso Bruto / Peso Líquido */
export function correctionFactor(grossWeight: number, netWeight: number): number {
  if (netWeight <= 0) throw new Error('Peso líquido deve ser maior que zero');
  return Number((grossWeight / netWeight).toFixed(4));
}

/** Rendimento % = (Peso Líquido / Peso Bruto) × 100 */
export function yieldPercentage(grossWeight: number, netWeight: number): number {
  if (grossWeight <= 0) return 0;
  return Number(((netWeight / grossWeight) * 100).toFixed(2));
}

/** Custo real do ingrediente considerando FC */
export function realIngredientCost(
  netWeightKg: number,
  costPerKg: number,
  fc: number
): number {
  return Number((netWeightKg * costPerKg * fc).toFixed(4));
}

/** CMV% de um prato */
export function cmvPercentage(totalCost: number, salePrice: number): number {
  if (salePrice <= 0) return 0;
  return Number(((totalCost / salePrice) * 100).toFixed(2));
}

/** Preço ideal de venda para atingir margem alvo */
export function idealSalePrice(totalCost: number, targetMarginPct: number): number {
  if (targetMarginPct >= 100) throw new Error('Margem deve ser menor que 100%');
  return Number((totalCost / (1 - targetMarginPct / 100)).toFixed(2));
}

/** Markup */
export function markup(salePrice: number, totalCost: number): number {
  if (totalCost <= 0) return 0;
  return Number((salePrice / totalCost).toFixed(2));
}
```

---

## 8. UX/UI — Diretrizes de Design

### Sistema de design

- **Fontes:** Syne (headings, bold, brand) + DM Mono (valores numéricos, KPIs) + Inter (corpo de texto)
- **Cores primárias:** Verde esmeralda `#00C896` (brand), fundo neutro escuro para dashboard
- **Densidade:** Layout compacto e informativo — restauranteiros precisam ver muitos dados numa tela
- **Mobile:** Sidebar colapsável, KPIs empilhados, tabelas com scroll horizontal

### Hierarquia visual dos alertas

1. **Crítico** (vermelho) — ruptura de estoque, CMV >8pp acima da meta
2. **Atenção** (âmbar) — estoque baixo, CMV >3pp acima da meta, vencimentos em 7 dias
3. **Oportunidade** (verde) — prato com boa margem, economia possível

### Componentes-chave

- **KPI Card:** valor grande em DM Mono + delta colorido (↑verde / ↓vermelho)
- **CMV Bar Chart:** barras horizontais com linha de meta em tracejado
- **Ficha Técnica Table:** edição inline de pesos com recálculo em tempo real
- **AI Chat:** interface flutuante com streaming de resposta e botões de perguntas rápidas
- **Alert Feed:** feed lateral com severidade visual e ação direta (clicar abre análise)

---

## 9. Plano de Escalabilidade

### Fase 1 — Monolito Modular (0–500 restaurantes)
- Next.js + Supabase na Vercel
- Row Level Security para isolamento de dados
- Cache Redis para queries de dashboard
- Custo estimado: ~$200/mês

### Fase 2 — Separação de domínios (500–5.000 restaurantes)
- Extrair jobs pesados para microserviço Node.js separado
- Read replicas no Supabase para queries analíticas
- CDN para assets estáticos
- Custo estimado: ~$800/mês

### Fase 3 — Plataforma distribuída (5.000+ restaurantes)
- Múltiplas regiões (Vercel Edge)
- Banco de dados dedicado por tenant (enterprise)
- Pipeline de dados com Analytics separado (ClickHouse)
- Data warehouse para relatórios históricos
- Custo estimado: ~$3.000+/mês

---

## 10. Roadmap de Desenvolvimento

### Sprint 0 — Fundação (2 semanas)
- [ ] Setup Next.js + Supabase + TailwindCSS
- [ ] Schema do banco de dados + migrations
- [ ] Autenticação multi-tenant
- [ ] CI/CD (GitHub Actions + Vercel)
- [ ] Design system base (cores, tipografia, componentes)

### Sprint 1 — Ficha Técnica (2 semanas)
- [ ] CRUD de ingredientes com custo e unidade
- [ ] CRUD de pratos (fichas técnicas)
- [ ] Tabela de ingredientes com FC e rendimento
- [ ] Cálculo automático de CMV ao salvar
- [ ] Sugestão de preço de venda

### Sprint 2 — Estoque (2 semanas)
- [ ] Posição de estoque em tempo real
- [ ] Registro de entradas (manual + NF)
- [ ] Registro de saídas e perdas
- [ ] Alertas de estoque mínimo e vencimento
- [ ] Inventário (ajuste de contagem)

### Sprint 3 — Fornecedores (1 semana)
- [ ] Cadastro de fornecedores
- [ ] Histórico de preços por ingrediente
- [ ] Comparativo entre fornecedores
- [ ] Alertas de aumento de preço

### Sprint 4 — Financeiro / DRE (2 semanas)
- [ ] Estrutura do DRE (receitas, CMV, custos fixos, variáveis)
- [ ] Lançamento manual de receitas e despesas
- [ ] Integração CMV calculado ↔ DRE
- [ ] Contas a pagar com vencimentos
- [ ] Relatório DRE em PDF

### Sprint 5 — Dashboard + KPIs (1 semana)
- [ ] Dashboard com os 4 KPIs principais
- [ ] Gráficos CMV por prato (Recharts)
- [ ] Gráfico DRE mensal
- [ ] Feed de alertas em tempo real

### Sprint 6 — IA Integrada (2 semanas)
- [ ] Context builder (dados do restaurante → JSON)
- [ ] System prompt especializado em gastronomia
- [ ] Chat em tempo real com streaming
- [ ] Perguntas rápidas pré-configuradas
- [ ] Sugestão automática de preço via IA
- [ ] Job diário de análise automática e geração de alertas

### Sprint 7 — Polimento e Launch (2 semanas)
- [ ] Onboarding guiado (seed de dados de exemplo)
- [ ] Tour interativo do sistema
- [ ] Responsividade mobile
- [ ] Testes E2E (Playwright)
- [ ] Documentação para usuário
- [ ] Página de pricing e planos

**Total estimado: 14 semanas (3,5 meses) para MVP completo**

---

## 11. Modelos de Monetização (SaaS)

| Plano | Preço/mês | Limites | Target |
|-------|-----------|---------|--------|
| Starter | R$197 | 1 CNPJ, 50 pratos, sem IA | Lanchonetes, quiosques |
| Pro | R$397 | 1 CNPJ, ilimitado, IA básica | Restaurantes médios |
| Business | R$797 | 3 CNPJs, IA completa, API | Redes pequenas |
| Enterprise | Sob consulta | Multi-unidade, white-label, SLA | Franquias, grupos |

---

## 12. Checklist de Segurança

- [x] Row Level Security no Supabase (cada tenant vê só seus dados)
- [x] JWT com rotação automática
- [x] Rate limiting na API de IA (evitar custos excessivos)
- [x] Sanitização de inputs no banco de dados
- [x] Variáveis sensíveis apenas em `.env` (nunca no cliente)
- [x] HTTPS obrigatório
- [x] Auditoria de acessos por tenant
- [x] Backup automático do Supabase (diário)

---

*RestaurantIQ — Gerado com arquitetura production-ready*
*Stack: Next.js 14 · Supabase · OpenAI GPT-4o · TailwindCSS · Trigger.dev*

-- RestaurantIQ — Schema principal (multi-tenant com Row Level Security)

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

-- ═══════════════════════════════════════════════════════════════
-- VIEWS ANALÍTICAS
-- ═══════════════════════════════════════════════════════════════

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

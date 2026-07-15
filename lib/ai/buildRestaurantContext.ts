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

// NOTA: getDishCmvAnalysis, getStockStatus, getSupplierPriceChanges,
// getDreSummary, getActiveAlerts e currentMonth() são helpers de acesso
// ao banco (Supabase) que ainda precisam ser implementados/importados.

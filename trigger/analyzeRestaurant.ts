import { schedules } from '@trigger.dev/sdk/v3';
import { buildRestaurantContext } from '@/lib/ai/buildRestaurantContext';

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

// NOTA: getActiveTenants() e createAlert() são helpers de acesso ao banco
// (Supabase) que ainda precisam ser implementados/importados.

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

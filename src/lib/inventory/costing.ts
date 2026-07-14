export type InventoryCostingMethod = 'FIFO' | 'WEIGHTED_AVERAGE' | 'STANDARD'

export type InventoryMovementType =
  | 'RECEIPT'
  | 'ISSUE'
  | 'ADJUSTMENT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RESERVATION'
  | 'RESERVATION_RELEASE'
  | 'COUNT_ADJUSTMENT'
  | 'GOODS_RECEIPT'
  | 'GOODS_ISSUE'
  | 'MANUFACTURING_CONSUMPTION'
  | 'MANUFACTURING_OUTPUT'

export interface CostLayer {
  id?: string
  quantityRemaining: number
  unitCost: number
  receivedAt?: Date
}

export interface IssueCostResult {
  unitCost: number
  totalCost: number
  consumedLayers: Array<{ layerId?: string; quantity: number; unitCost: number }>
}

export function roundQty(value: number): number {
  return Math.round(value * 10000) / 10000
}

export function roundCost(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** Weighted average cost after receipt. */
export function calculateWeightedAverageCost(
  currentQty: number,
  currentAvgCost: number,
  receiptQty: number,
  receiptUnitCost: number,
): number {
  const totalQty = currentQty + receiptQty
  if (totalQty <= 0) return receiptUnitCost
  const totalValue = currentQty * currentAvgCost + receiptQty * receiptUnitCost
  return roundCost(totalValue / totalQty)
}

/** FIFO consumption from oldest layers first. */
export function consumeFifoLayers(
  layers: CostLayer[],
  quantity: number,
): IssueCostResult {
  let remaining = quantity
  let totalCost = 0
  const consumedLayers: IssueCostResult['consumedLayers'] = []

  const sorted = [...layers].sort((a, b) => {
    const aTime = a.receivedAt?.getTime() ?? 0
    const bTime = b.receivedAt?.getTime() ?? 0
    return aTime - bTime
  })

  for (const layer of sorted) {
    if (remaining <= 0) break
    if (layer.quantityRemaining <= 0) continue
    const take = Math.min(remaining, layer.quantityRemaining)
    const layerCost = take * layer.unitCost
    totalCost += layerCost
    consumedLayers.push({ layerId: layer.id, quantity: take, unitCost: layer.unitCost })
    remaining -= take
  }

  if (remaining > 0.0001) {
    throw new Error('INSUFFICIENT_FIFO_LAYERS')
  }

  return {
    unitCost: quantity > 0 ? roundCost(totalCost / quantity) : 0,
    totalCost: roundCost(totalCost),
    consumedLayers,
  }
}

/** Standard cost issue — uses fixed standard cost regardless of layers. */
export function calculateStandardIssueCost(quantity: number, standardCost: number): IssueCostResult {
  const totalCost = roundCost(quantity * standardCost)
  return {
    unitCost: standardCost,
    totalCost,
    consumedLayers: [{ quantity, unitCost: standardCost }],
  }
}

export function calculateAvailableQuantity(
  onHand: number,
  reserved: number,
): number {
  return roundQty(onHand - reserved)
}

export function assertNonNegativeStock(
  availableQty: number,
  issueQty: number,
  allowNegative: boolean,
): void {
  if (!allowNegative && issueQty > availableQty + 0.0001) {
    throw new Error('NEGATIVE_STOCK_PREVENTED')
  }
}

export function calculateValuation(
  quantity: number,
  unitCost: number,
): number {
  return roundCost(quantity * unitCost)
}

export function calculateCogsVariance(
  actualCost: number,
  standardCost: number,
  quantity: number,
): number {
  return roundCost(actualCost - standardCost * quantity)
}

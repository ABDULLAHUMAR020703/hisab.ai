# Enterprise Inventory — Implementation Report

Date: 2026-07-13  
Scope: ERP-grade inventory with costing, warehouse stock, lots/serials, reservations, stock counts, and Sales/Purchases integration.

---

## 1. Summary

Inventory upgraded from catalog + single quantity to **enterprise ERP inventory** with FIFO, weighted average, and standard costing; per-warehouse balances; goods receipt/issue from bills/invoices; reservations; stock/cycle counting; COGS journal entries; audit trail; and valuation reports.

**Sales and Purchases compatibility preserved** — existing item master, APIs, and line FKs unchanged; GRN/GIN triggered on bill/invoice GL posting when lines have `inventory_item_id`.

---

## 2. Database Changes

### Migration: `supabase/migrations/034_enterprise_inventory.sql`

| Table / Column | Purpose |
|----------------|---------|
| `inventory_items.costing_method` | FIFO, WEIGHTED_AVERAGE, STANDARD |
| `inventory_items.standard_cost` | Standard costing |
| `inventory_items.allow_negative_stock` | Negative inventory prevention |
| `inventory_items.track_lots/serials/batches` | Tracking flags |
| `warehouse_stock` | Per-warehouse on-hand, reserved, average cost, value |
| `inventory_cost_layers` | FIFO cost layers |
| `inventory_lots` | Lot/batch + expiry |
| `inventory_serials` | Serial number tracking |
| `inventory_reservations` | Stock reservations |
| `stock_count_sessions` / `stock_count_lines` | Physical & cycle counts |
| `inventory_audit_logs` | Immutable audit trail |
| `stock_movements` extensions | source_type/id, lot/serial, total_cost |

---

## 3. Costing Methods

| Method | Behavior |
|--------|----------|
| **FIFO** | Cost layers consumed oldest-first on issue |
| **Weighted Average** | Rolling average recalculated on receipt (default) |
| **Standard Cost** | Fixed standard cost on issue; variance calculable |

**COGS recalculation:** `POST /api/inventory/valuation` with `{ action: "recalculate_wac" }` refreshes WAC valuations.

---

## 4. Inventory Operations

| Operation | API / Trigger |
|-----------|---------------|
| Goods receipt (GRN) | Auto on `postBillToLedger` for bill lines with `inventory_item_id` |
| Goods issue (GIN) | Auto on `postInvoiceToLedger` for invoice lines with `inventory_item_id` |
| Manual receipt/issue | `POST /api/stock-movements` |
| Transfer | `action: "transfer"` on stock-movements |
| Adjustment | `action: "adjustment"` |
| Manufacturing | `manufacturing_consumption` / `manufacturing_output` |
| Reservations | `POST /api/inventory/reservations` |
| Stock count | `POST /api/inventory/stock-counts` |
| Cycle count | `isCycleCount: true` on stock count create |
| Lots | `POST /api/inventory/lots` |
| Serials | `POST /api/inventory/serials` |

---

## 5. Accounting Integration

- **COGS journal:** DR COGS / CR Inventory Asset on issue (via `journal-posting.ts`)
- **Receipt journal:** DR Inventory Asset / CR COGS on goods receipt from bills
- **Count adjustment:** Variance posted to expense vs inventory asset
- **Ledger source:** `INVENTORY` added to `ledger_source_type`

---

## 6. Audit & Reports

| Feature | Endpoint |
|---------|----------|
| Audit trail | `inventory_audit_logs` on every movement/reservation/count |
| Valuation report | `GET /api/inventory/valuation` |
| Per-warehouse breakdown | `?warehouseId=` filter |

---

## 7. Negative Inventory Prevention

`assertNonNegativeStock()` blocks issues when `available < issue qty` unless `allow_negative_stock = true` on the item.

Reservations reduce available quantity before issue.

---

## 8. Key Files

| Module | Path |
|--------|------|
| Costing (pure) | `src/lib/inventory/costing.ts` |
| Movement engine | `src/lib/inventory/movements.ts` |
| Reservations | `src/lib/inventory/reservations.ts` |
| Stock count | `src/lib/inventory/stock-count.ts` |
| Valuation | `src/lib/inventory/valuation.ts` |
| COGS journals | `src/lib/inventory/journal-posting.ts` |
| Sales/Purchase hooks | `src/lib/inventory/document-hooks.ts` |
| Audit | `src/lib/inventory/audit.ts` |

---

## 9. Backwards Compatibility

| Area | Status |
|------|--------|
| `inventory_items.quantity` | Synced from warehouse_stock totals |
| Existing stock-movements API | Same actions; delegates to new engine |
| Invoice/bill without inventory lines | No stock impact |
| Item master CRUD | Unchanged |
| Migrations 001–033 | Untouched |

---

## 10. Deployment Checklist

1. Apply migration `034_enterprise_inventory.sql`
2. Run `npm run test:accounting` (includes inventory tests)
3. Ensure each company has at least one warehouse (migration seeds `MAIN`)
4. Set `costing_method` on items as needed
5. Test bill post → goods receipt; invoice post → goods issue + COGS

-- Enterprise inventory: costing, warehouse stock, lots/serials, reservations, stock counts

CREATE TYPE public.inventory_costing_method AS ENUM (
  'FIFO',
  'WEIGHTED_AVERAGE',
  'STANDARD'
);

CREATE TYPE public.inventory_movement_type AS ENUM (
  'RECEIPT',
  'ISSUE',
  'ADJUSTMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'COUNT_ADJUSTMENT',
  'GOODS_RECEIPT',
  'GOODS_ISSUE',
  'MANUFACTURING_CONSUMPTION',
  'MANUFACTURING_OUTPUT'
);

CREATE TYPE public.serial_status AS ENUM (
  'AVAILABLE',
  'RESERVED',
  'ISSUED',
  'SCRAPPED'
);

CREATE TYPE public.stock_count_status AS ENUM (
  'DRAFT',
  'IN_PROGRESS',
  'POSTED',
  'CANCELLED'
);

CREATE TYPE public.reservation_status AS ENUM (
  'ACTIVE',
  'FULFILLED',
  'RELEASED',
  'EXPIRED'
);

-- Item costing configuration
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS costing_method public.inventory_costing_method NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
  ADD COLUMN IF NOT EXISTS standard_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS track_lots BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS track_serials BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS track_batches BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inventory_asset_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cogs_account_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

UPDATE public.inventory_items
SET standard_cost = cost_price
WHERE standard_cost = 0 AND cost_price > 0;

-- Per-warehouse stock balances
CREATE TABLE IF NOT EXISTS public.warehouse_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  quantity_on_hand NUMERIC(18, 4) NOT NULL DEFAULT 0,
  quantity_reserved NUMERIC(18, 4) NOT NULL DEFAULT 0,
  average_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, inventory_item_id, warehouse_id)
);

-- FIFO cost layers
CREATE TABLE IF NOT EXISTS public.inventory_cost_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  lot_id UUID,
  quantity_remaining NUMERIC(18, 4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_movement_id UUID
);

-- Lots / batches with expiry
CREATE TABLE IF NOT EXISTS public.inventory_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  lot_no TEXT NOT NULL,
  batch_no TEXT,
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  expiry_date TIMESTAMPTZ,
  manufactured_date TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, inventory_item_id, lot_no)
);

ALTER TABLE public.inventory_cost_layers
  ADD CONSTRAINT inventory_cost_layers_lot_fk
  FOREIGN KEY (lot_id) REFERENCES public.inventory_lots(id) ON DELETE SET NULL;

-- Serial numbers
CREATE TABLE IF NOT EXISTS public.inventory_serials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  lot_id UUID REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
  serial_no TEXT NOT NULL,
  status public.serial_status NOT NULL DEFAULT 'AVAILABLE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, serial_no)
);

-- Extend stock movements
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID,
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS serial_id UUID REFERENCES public.inventory_serials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_no TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX stock_movements_source_idx ON public.stock_movements (company_id, source_type, source_id);
CREATE INDEX stock_movements_item_date_idx ON public.stock_movements (company_id, inventory_item_id, date DESC);

-- Inventory reservations
CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  reservation_no TEXT NOT NULL,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  quantity NUMERIC(18, 4) NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  status public.reservation_status NOT NULL DEFAULT 'ACTIVE',
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE (company_id, reservation_no)
);

-- Stock counting
CREATE TABLE IF NOT EXISTS public.stock_count_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  count_no TEXT NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  status public.stock_count_status NOT NULL DEFAULT 'DRAFT',
  count_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_cycle_count BOOLEAN NOT NULL DEFAULT false,
  posted_at TIMESTAMPTZ,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, count_no)
);

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.stock_count_sessions(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  lot_id UUID REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
  system_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  counted_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  variance_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  variance_value NUMERIC(18, 4) NOT NULL DEFAULT 0
);

-- Immutable inventory audit trail
CREATE TABLE IF NOT EXISTS public.inventory_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  before_state JSONB,
  after_state JSONB,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX inventory_audit_logs_item_idx ON public.inventory_audit_logs (company_id, inventory_item_id, created_at DESC);

ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'INVENTORY';

-- RLS
ALTER TABLE public.warehouse_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_cost_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY warehouse_stock_tenant ON public.warehouse_stock FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY inventory_cost_layers_tenant ON public.inventory_cost_layers FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY inventory_lots_tenant ON public.inventory_lots FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY inventory_serials_tenant ON public.inventory_serials FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY inventory_reservations_tenant ON public.inventory_reservations FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY stock_count_sessions_tenant ON public.stock_count_sessions FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY stock_count_lines_tenant ON public.stock_count_lines FOR ALL USING (company_id IN (SELECT public.user_company_ids()));
CREATE POLICY inventory_audit_logs_tenant ON public.inventory_audit_logs FOR ALL USING (company_id IN (SELECT public.user_company_ids()));

-- Backfill warehouse stock from existing item quantities
INSERT INTO public.warehouse_stock (company_id, inventory_item_id, warehouse_id, quantity_on_hand, average_cost, total_value)
SELECT
  ii.company_id,
  ii.id,
  COALESCE(ii.warehouse_id, (
    SELECT w.id FROM public.warehouses w
    WHERE w.company_id = ii.company_id AND w.deleted_at IS NULL
    ORDER BY w.created_at LIMIT 1
  )),
  ii.quantity,
  ii.cost_price,
  ii.quantity * ii.cost_price
FROM public.inventory_items ii
WHERE ii.deleted_at IS NULL
  AND ii.quantity > 0
  AND COALESCE(ii.warehouse_id, (
    SELECT w.id FROM public.warehouses w
    WHERE w.company_id = ii.company_id AND w.deleted_at IS NULL LIMIT 1
  )) IS NOT NULL
ON CONFLICT (company_id, inventory_item_id, warehouse_id) DO NOTHING;

-- Seed default warehouse per company if missing
INSERT INTO public.warehouses (company_id, code, name)
SELECT c.id, 'MAIN', 'Main Warehouse'
FROM public.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM public.warehouses w WHERE w.company_id = c.id AND w.deleted_at IS NULL
);

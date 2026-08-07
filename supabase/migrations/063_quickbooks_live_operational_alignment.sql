-- Backward-compatible ledger classifications required by native QuickBooks documents.
ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'SALES_RECEIPT';
ALTER TYPE public.ledger_source_type ADD VALUE IF NOT EXISTS 'SUPPLIER_CREDIT';

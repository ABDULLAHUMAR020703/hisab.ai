-- Phase B hardening: non-negative amount checks and journal posting balance guard
-- Depends on: 006_accounting_core, 007_customers_vendors, 008_invoices
-- Apply with ALTER TABLE only; does not redefine existing columns or policies.

-- ---------------------------------------------------------------------------
-- 1. General non-negative CHECK constraints
-- ---------------------------------------------------------------------------

ALTER TABLE public.tax_rates
  ADD CONSTRAINT tax_rates_rate_nonneg_chk CHECK (rate >= 0);

ALTER TABLE public.sequences
  ADD CONSTRAINT sequences_next_no_positive_chk CHECK (next_no >= 1);

ALTER TABLE public.journal_lines
  ADD CONSTRAINT journal_lines_debit_nonneg_chk CHECK (debit >= 0),
  ADD CONSTRAINT journal_lines_credit_nonneg_chk CHECK (credit >= 0),
  ADD CONSTRAINT journal_lines_tax_rate_nonneg_chk CHECK (tax_rate >= 0);

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_total_nonneg_chk CHECK (total >= 0),
  ADD CONSTRAINT expenses_tax_amount_nonneg_chk CHECK (tax_amount >= 0);

ALTER TABLE public.expense_lines
  ADD CONSTRAINT expense_lines_amount_nonneg_chk CHECK (amount >= 0),
  ADD CONSTRAINT expense_lines_tax_rate_nonneg_chk CHECK (tax_rate >= 0);

ALTER TABLE public.receipts
  ADD CONSTRAINT receipts_amount_nonneg_chk CHECK (amount IS NULL OR amount >= 0);

ALTER TABLE public.customers
  ADD CONSTRAINT customers_credit_limit_nonneg_chk CHECK (credit_limit >= 0),
  ADD CONSTRAINT customers_payment_terms_nonneg_chk CHECK (payment_terms >= 0);

ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_payment_terms_nonneg_chk CHECK (payment_terms >= 0);

ALTER TABLE public.bills
  ADD CONSTRAINT bills_subtotal_nonneg_chk CHECK (subtotal >= 0),
  ADD CONSTRAINT bills_tax_amount_nonneg_chk CHECK (tax_amount >= 0),
  ADD CONSTRAINT bills_total_nonneg_chk CHECK (total >= 0),
  ADD CONSTRAINT bills_amount_paid_nonneg_chk CHECK (amount_paid >= 0);

ALTER TABLE public.bill_lines
  ADD CONSTRAINT bill_lines_quantity_nonneg_chk CHECK (quantity >= 0),
  ADD CONSTRAINT bill_lines_unit_price_nonneg_chk CHECK (unit_price >= 0),
  ADD CONSTRAINT bill_lines_tax_rate_nonneg_chk CHECK (tax_rate >= 0),
  ADD CONSTRAINT bill_lines_amount_nonneg_chk CHECK (amount >= 0);

ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_quantity_nonneg_chk CHECK (quantity >= 0),
  ADD CONSTRAINT invoice_lines_unit_price_nonneg_chk CHECK (unit_price >= 0),
  ADD CONSTRAINT invoice_lines_tax_rate_nonneg_chk CHECK (tax_rate >= 0),
  ADD CONSTRAINT invoice_lines_amount_nonneg_chk CHECK (amount >= 0);

ALTER TABLE public.payments
  ADD CONSTRAINT payments_amount_nonneg_chk CHECK (amount >= 0);

-- ---------------------------------------------------------------------------
-- 2. Journal balancing protections
-- ---------------------------------------------------------------------------

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_total_debit_nonneg_chk CHECK (total_debit >= 0),
  ADD CONSTRAINT journal_entries_total_credit_nonneg_chk CHECK (total_credit >= 0),
  ADD CONSTRAINT journal_entries_posted_balanced_chk CHECK (
    status <> 'POSTED' OR total_debit = total_credit
  );

-- ---------------------------------------------------------------------------
-- 3. Invoice amount protections
-- ---------------------------------------------------------------------------

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_subtotal_nonneg_chk CHECK (subtotal >= 0),
  ADD CONSTRAINT invoices_tax_amount_nonneg_chk CHECK (tax_amount >= 0),
  ADD CONSTRAINT invoices_total_nonneg_chk CHECK (total >= 0),
  ADD CONSTRAINT invoices_amount_paid_nonneg_chk CHECK (amount_paid >= 0);

-- ---------------------------------------------------------------------------
-- 4. Payroll amount protections
-- ---------------------------------------------------------------------------

ALTER TABLE public.employees
  ADD CONSTRAINT employees_salary_nonneg_chk CHECK (salary >= 0);

ALTER TABLE public.payroll_entries
  ADD CONSTRAINT payroll_entries_basic_salary_nonneg_chk CHECK (basic_salary >= 0),
  ADD CONSTRAINT payroll_entries_allowances_nonneg_chk CHECK (allowances >= 0),
  ADD CONSTRAINT payroll_entries_deductions_nonneg_chk CHECK (deductions >= 0),
  ADD CONSTRAINT payroll_entries_tax_amount_nonneg_chk CHECK (tax_amount >= 0);

ALTER TABLE public.payroll_lines
  ADD CONSTRAINT payroll_lines_amount_nonneg_chk CHECK (amount >= 0);

-- ---------------------------------------------------------------------------
-- 5. Inventory quantity and pricing protections
-- ---------------------------------------------------------------------------

ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_cost_price_nonneg_chk CHECK (cost_price >= 0),
  ADD CONSTRAINT inventory_items_sale_price_nonneg_chk CHECK (sale_price >= 0),
  ADD CONSTRAINT inventory_items_quantity_nonneg_chk CHECK (quantity >= 0),
  ADD CONSTRAINT inventory_items_min_quantity_nonneg_chk CHECK (min_quantity >= 0);

-- Tenant integrity: composite FKs, soft-delete child RLS, zatca_xml_archive role parity
-- Depends on: 006_accounting_core, 007_customers_vendors, 008_invoices, 009_zatca_core, 010_database_hardening

-- ---------------------------------------------------------------------------
-- 1. Composite unique keys on parent tables (required for composite FK targets)
-- ---------------------------------------------------------------------------

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_company_id_id_key UNIQUE (company_id, id);

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_company_id_id_key UNIQUE (company_id, id);

ALTER TABLE public.bills
  ADD CONSTRAINT bills_company_id_id_key UNIQUE (company_id, id);

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_company_id_id_key UNIQUE (company_id, id);

ALTER TABLE public.payroll_entries
  ADD CONSTRAINT payroll_entries_company_id_id_key UNIQUE (company_id, id);

-- ---------------------------------------------------------------------------
-- 2. Drop single-column parent FKs (replaced by composite tenant-scoped FKs)
-- ---------------------------------------------------------------------------

ALTER TABLE public.journal_lines
  DROP CONSTRAINT IF EXISTS journal_lines_journal_id_fkey;

ALTER TABLE public.expense_lines
  DROP CONSTRAINT IF EXISTS expense_lines_expense_id_fkey;

ALTER TABLE public.bill_lines
  DROP CONSTRAINT IF EXISTS bill_lines_bill_id_fkey;

ALTER TABLE public.invoice_lines
  DROP CONSTRAINT IF EXISTS invoice_lines_invoice_id_fkey;

ALTER TABLE public.payroll_lines
  DROP CONSTRAINT IF EXISTS payroll_lines_payroll_id_fkey;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_invoice_id_fkey,
  DROP CONSTRAINT IF EXISTS payments_bill_id_fkey;

ALTER TABLE public.zatca_xml_archive
  DROP CONSTRAINT IF EXISTS zatca_xml_archive_invoice_id_fkey;

ALTER TABLE public.zatca_audit_logs
  DROP CONSTRAINT IF EXISTS zatca_audit_logs_invoice_id_fkey;

ALTER TABLE public.zatca_api_logs
  DROP CONSTRAINT IF EXISTS zatca_api_logs_invoice_id_fkey;

-- ---------------------------------------------------------------------------
-- 3. Composite foreign keys — enforce child.company_id matches parent.company_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.journal_lines
  ADD CONSTRAINT journal_lines_company_journal_fkey
  FOREIGN KEY (company_id, journal_id)
  REFERENCES public.journal_entries (company_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.expense_lines
  ADD CONSTRAINT expense_lines_company_expense_fkey
  FOREIGN KEY (company_id, expense_id)
  REFERENCES public.expenses (company_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.bill_lines
  ADD CONSTRAINT bill_lines_company_bill_fkey
  FOREIGN KEY (company_id, bill_id)
  REFERENCES public.bills (company_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.invoice_lines
  ADD CONSTRAINT invoice_lines_company_invoice_fkey
  FOREIGN KEY (company_id, invoice_id)
  REFERENCES public.invoices (company_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.payroll_lines
  ADD CONSTRAINT payroll_lines_company_payroll_fkey
  FOREIGN KEY (company_id, payroll_id)
  REFERENCES public.payroll_entries (company_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_company_invoice_fkey
  FOREIGN KEY (company_id, invoice_id)
  REFERENCES public.invoices (company_id, id)
  ON DELETE SET NULL,
  ADD CONSTRAINT payments_company_bill_fkey
  FOREIGN KEY (company_id, bill_id)
  REFERENCES public.bills (company_id, id)
  ON DELETE SET NULL;

ALTER TABLE public.zatca_xml_archive
  ADD CONSTRAINT zatca_xml_archive_company_invoice_fkey
  FOREIGN KEY (company_id, invoice_id)
  REFERENCES public.invoices (company_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.zatca_audit_logs
  ADD CONSTRAINT zatca_audit_logs_company_invoice_fkey
  FOREIGN KEY (company_id, invoice_id)
  REFERENCES public.invoices (company_id, id)
  ON DELETE SET NULL;

ALTER TABLE public.zatca_api_logs
  ADD CONSTRAINT zatca_api_logs_company_invoice_fkey
  FOREIGN KEY (company_id, invoice_id)
  REFERENCES public.invoices (company_id, id)
  ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 4. Supporting indexes for RLS parent EXISTS checks (soft-delete filter)
-- ---------------------------------------------------------------------------

CREATE INDEX journal_entries_id_not_deleted_idx
  ON public.journal_entries (id)
  WHERE deleted_at IS NULL;

CREATE INDEX expenses_id_not_deleted_idx
  ON public.expenses (id)
  WHERE deleted_at IS NULL;

CREATE INDEX bills_id_not_deleted_idx
  ON public.bills (id)
  WHERE deleted_at IS NULL;

CREATE INDEX invoices_id_not_deleted_idx
  ON public.invoices (id)
  WHERE deleted_at IS NULL;

CREATE INDEX payroll_entries_id_not_deleted_idx
  ON public.payroll_entries (id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. RLS — hide line rows when parent is soft-deleted
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS journal_lines_tenant ON public.journal_lines;
CREATE POLICY journal_lines_tenant ON public.journal_lines FOR ALL TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND EXISTS (
      SELECT 1
      FROM public.journal_entries parent
      WHERE parent.id = journal_lines.journal_id
        AND parent.company_id = journal_lines.company_id
        AND parent.deleted_at IS NULL
    )
  )
  WITH CHECK (
    company_id IN (SELECT public.user_company_ids())
    AND EXISTS (
      SELECT 1
      FROM public.journal_entries parent
      WHERE parent.id = journal_lines.journal_id
        AND parent.company_id = journal_lines.company_id
        AND parent.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS expense_lines_tenant ON public.expense_lines;
CREATE POLICY expense_lines_tenant ON public.expense_lines FOR ALL TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND EXISTS (
      SELECT 1
      FROM public.expenses parent
      WHERE parent.id = expense_lines.expense_id
        AND parent.company_id = expense_lines.company_id
        AND parent.deleted_at IS NULL
    )
  )
  WITH CHECK (
    company_id IN (SELECT public.user_company_ids())
    AND EXISTS (
      SELECT 1
      FROM public.expenses parent
      WHERE parent.id = expense_lines.expense_id
        AND parent.company_id = expense_lines.company_id
        AND parent.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS bill_lines_tenant ON public.bill_lines;
CREATE POLICY bill_lines_tenant ON public.bill_lines FOR ALL TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND EXISTS (
      SELECT 1
      FROM public.bills parent
      WHERE parent.id = bill_lines.bill_id
        AND parent.company_id = bill_lines.company_id
        AND parent.deleted_at IS NULL
    )
  )
  WITH CHECK (
    company_id IN (SELECT public.user_company_ids())
    AND EXISTS (
      SELECT 1
      FROM public.bills parent
      WHERE parent.id = bill_lines.bill_id
        AND parent.company_id = bill_lines.company_id
        AND parent.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS invoice_lines_tenant ON public.invoice_lines;
CREATE POLICY invoice_lines_tenant ON public.invoice_lines FOR ALL TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND EXISTS (
      SELECT 1
      FROM public.invoices parent
      WHERE parent.id = invoice_lines.invoice_id
        AND parent.company_id = invoice_lines.company_id
        AND parent.deleted_at IS NULL
    )
  )
  WITH CHECK (
    company_id IN (SELECT public.user_company_ids())
    AND EXISTS (
      SELECT 1
      FROM public.invoices parent
      WHERE parent.id = invoice_lines.invoice_id
        AND parent.company_id = invoice_lines.company_id
        AND parent.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS payroll_lines_tenant ON public.payroll_lines;
CREATE POLICY payroll_lines_tenant ON public.payroll_lines FOR ALL TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND EXISTS (
      SELECT 1
      FROM public.payroll_entries parent
      WHERE parent.id = payroll_lines.payroll_id
        AND parent.company_id = payroll_lines.company_id
        AND parent.deleted_at IS NULL
    )
  )
  WITH CHECK (
    company_id IN (SELECT public.user_company_ids())
    AND EXISTS (
      SELECT 1
      FROM public.payroll_entries parent
      WHERE parent.id = payroll_lines.payroll_id
        AND parent.company_id = payroll_lines.company_id
        AND parent.deleted_at IS NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 6. zatca_xml_archive — align WITH CHECK role guard with USING
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS zatca_xml_archive_tenant ON public.zatca_xml_archive;
CREATE POLICY zatca_xml_archive_tenant ON public.zatca_xml_archive FOR ALL TO authenticated
  USING (
    company_id IN (SELECT public.user_company_ids())
    AND public.user_has_company_role(
      company_id,
      ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT']::public.company_role[]
    )
  )
  WITH CHECK (
    company_id IN (SELECT public.user_company_ids())
    AND public.user_has_company_role(
      company_id,
      ARRAY['OWNER', 'ADMIN', 'ACCOUNTANT']::public.company_role[]
    )
  );

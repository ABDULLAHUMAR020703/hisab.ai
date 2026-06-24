type ActivityItem = {
  id: string
  type: string
  action: string
  label: string
  detail: string
  amount?: number
  status?: string
  date: string
  href: string
}

export function buildActivityFeed(sources: {
  recentInvoices: {
    id: string; invoiceNo: string; total: number; status: string; invoiceType?: string
    zatcaStatus?: string; updatedAt: Date; createdAt: Date
    customer: { name: string }
  }[]
  recentBills: { id: string; billNo: string; total: number; status: string; updatedAt: Date; vendor: { name: string } }[]
  recentExpenses: { id: string; expenseNo: string; description: string; category: string; total: number; status: string; updatedAt: Date }[]
  recentJournal: { id: string; entryNo: string; description: string; status: string; totalDebit: number; updatedAt: Date; createdBy: { name: string | null } }[]
  recentPayroll: { id: string; payrollNo: string; netSalary: number; status: string; period: string; updatedAt: Date; employee: { name: string } }[]
  recentPayments: { id: string; paymentNo: string; amount: number; date: Date; invoice: { invoiceNo: string } | null; bill: { billNo: string } | null }[]
  recentCustomers: { id: string; customerNo: string; name: string; createdAt: Date; updatedAt?: Date }[]
  recentVendors: { id: string; vendorNo: string; name: string; createdAt: Date }[]
  recentEmployees: { id: string; employeeNo: string; name: string; department: string | null; createdAt: Date }[]
  recentInventory: { id: string; itemCode: string; name: string; quantity: number; salePrice: number; updatedAt: Date }[]
  recentReceipts: { id: string; fileName: string; vendor: string | null; amount: number | null; status: string; createdAt: Date }[]
  zatcaAudit?: { id: string; action: string; result: string; message: string | null; createdAt: Date; invoiceId?: string | null }[]
}): ActivityItem[] {
  const items: ActivityItem[] = []

  for (const inv of sources.recentInvoices) {
    const type = inv.invoiceType ?? 'STANDARD'
    const isNote = type === 'CREDIT_NOTE' || type === 'DEBIT_NOTE'
    const zatca = inv.zatcaStatus ?? 'DRAFT'

    items.push({
      id: `inv-created-${inv.id}`,
      type: 'invoice',
      action: isNote ? (type === 'CREDIT_NOTE' ? 'Credit Note Created' : 'Debit Note Created') : 'Invoice Created',
      label: inv.invoiceNo,
      detail: inv.customer.name,
      amount: inv.total,
      status: inv.status,
      date: inv.createdAt.toISOString(),
      href: '/invoices',
    })

    if (zatca === 'CLEARED') {
      items.push({
        id: `inv-cleared-${inv.id}`,
        type: 'zatca',
        action: 'Invoice Cleared',
        label: inv.invoiceNo,
        detail: inv.customer.name,
        status: 'CLEARED',
        date: inv.updatedAt.toISOString(),
        href: '/invoices',
      })
    } else if (zatca === 'REPORTED') {
      items.push({
        id: `inv-reported-${inv.id}`,
        type: 'zatca',
        action: 'Invoice Reported',
        label: inv.invoiceNo,
        detail: inv.customer.name,
        status: 'REPORTED',
        date: inv.updatedAt.toISOString(),
        href: '/invoices',
      })
    } else if (['SUBMITTED', 'PENDING', 'FAILED', 'REJECTED'].includes(zatca)) {
      items.push({
        id: `inv-zatca-${inv.id}`,
        type: 'zatca',
        action: 'Invoice Submitted',
        label: inv.invoiceNo,
        detail: inv.customer.name,
        status: zatca,
        date: inv.updatedAt.toISOString(),
        href: '/invoices',
      })
    }
  }

  for (const audit of sources.zatcaAudit ?? []) {
    const actionLabel = formatAuditAction(audit.action)
    if (!actionLabel) continue
    items.push({
      id: `audit-${audit.id}`,
      type: 'zatca',
      action: actionLabel,
      label: audit.action.replaceAll('_', ' '),
      detail: audit.message ?? audit.result,
      status: audit.result,
      date: audit.createdAt.toISOString(),
      href: audit.invoiceId ? '/invoices' : '/zatca',
    })
  }

  for (const bill of sources.recentBills) {
    items.push({
      id: `bill-${bill.id}`, type: 'bill', action: 'Bill Updated', label: bill.billNo,
      detail: bill.vendor.name, amount: bill.total, status: bill.status,
      date: bill.updatedAt.toISOString(), href: '/bills',
    })
  }
  for (const exp of sources.recentExpenses) {
    items.push({
      id: `exp-${exp.id}`, type: 'expense', action: 'Expense Updated', label: exp.expenseNo,
      detail: `${exp.category} · ${exp.description}`, amount: exp.total, status: exp.status,
      date: exp.updatedAt.toISOString(), href: '/expenses',
    })
  }
  for (const je of sources.recentJournal) {
    items.push({
      id: `jv-${je.id}`, type: 'journal', action: 'Journal Entry', label: je.entryNo,
      detail: je.description, amount: je.totalDebit, status: je.status,
      date: je.updatedAt.toISOString(), href: '/journal',
    })
  }
  for (const pr of sources.recentPayroll) {
    items.push({
      id: `pr-${pr.id}`, type: 'payroll', action: 'Payroll Updated', label: pr.payrollNo,
      detail: `${pr.employee.name} · ${pr.period}`, amount: pr.netSalary, status: pr.status,
      date: pr.updatedAt.toISOString(), href: '/payroll',
    })
  }
  for (const pay of sources.recentPayments) {
    const ref = pay.invoice?.invoiceNo ?? pay.bill?.billNo ?? 'Payment'
    items.push({
      id: `pay-${pay.id}`, type: 'payment', action: 'Payment Recorded', label: pay.paymentNo,
      detail: ref, amount: pay.amount, date: pay.date.toISOString(),
      href: pay.invoice ? '/invoices' : '/bills',
    })
  }
  for (const c of sources.recentCustomers) {
    items.push({
      id: `cust-${c.id}`, type: 'customer', action: 'Customer Created', label: c.customerNo,
      detail: c.name, date: c.createdAt.toISOString(), href: '/customers',
    })
  }
  for (const v of sources.recentVendors) {
    items.push({
      id: `vend-${v.id}`, type: 'vendor', action: 'Vendor Created', label: v.vendorNo,
      detail: v.name, date: v.createdAt.toISOString(), href: '/vendors',
    })
  }
  for (const e of sources.recentEmployees) {
    items.push({
      id: `emp-${e.id}`, type: 'employee', action: 'Employee Added', label: e.employeeNo,
      detail: `${e.name}${e.department ? ` · ${e.department}` : ''}`,
      date: e.createdAt.toISOString(), href: '/employees',
    })
  }
  for (const item of sources.recentInventory) {
    items.push({
      id: `item-${item.id}`, type: 'inventory', action: 'Inventory Updated', label: item.itemCode,
      detail: `${item.name} · Qty ${item.quantity}`, amount: item.salePrice * item.quantity,
      date: item.updatedAt.toISOString(), href: '/inventory',
    })
  }
  for (const r of sources.recentReceipts) {
    items.push({
      id: `rcpt-${r.id}`, type: 'receipt', action: 'Receipt Uploaded', label: r.fileName,
      detail: r.vendor ?? 'Uploaded receipt', amount: r.amount ?? undefined, status: r.status,
      date: r.createdAt.toISOString(), href: '/receipts',
    })
  }

  return items
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 30)
}

function formatAuditAction(action: string): string | null {
  const map: Record<string, string> = {
    COMPLIANCE_CHECKS_COMPLETED: 'Compliance Passed',
    PRODUCTION_CSID_ISSUED: 'Production CSID Issued',
    INVOICE_SUBMITTED: 'Invoice Submitted',
    INVOICE_CLEARED: 'Invoice Cleared',
    INVOICE_REPORTED: 'Invoice Reported',
    SUBMISSION_FAILED: 'Submission Failed',
    CONNECTION_TESTED: 'Connection Tested',
    SANDBOX_TEST_RUN: 'Sandbox Tests Run',
  }
  return map[action] ?? null
}

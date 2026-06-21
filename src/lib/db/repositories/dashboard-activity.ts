type ActivityItem = {
  id: string
  type: string
  label: string
  detail: string
  amount?: number
  status?: string
  date: string
  href: string
}

export function buildActivityFeed(sources: {
  recentInvoices: { id: string; invoiceNo: string; total: number; status: string; updatedAt: Date; customer: { name: string } }[]
  recentBills: { id: string; billNo: string; total: number; status: string; updatedAt: Date; vendor: { name: string } }[]
  recentExpenses: { id: string; expenseNo: string; description: string; category: string; total: number; status: string; updatedAt: Date }[]
  recentJournal: { id: string; entryNo: string; description: string; status: string; totalDebit: number; updatedAt: Date; createdBy: { name: string | null } }[]
  recentPayroll: { id: string; payrollNo: string; netSalary: number; status: string; period: string; updatedAt: Date; employee: { name: string } }[]
  recentPayments: { id: string; paymentNo: string; amount: number; date: Date; invoice: { invoiceNo: string } | null; bill: { billNo: string } | null }[]
  recentCustomers: { id: string; customerNo: string; name: string; createdAt: Date }[]
  recentVendors: { id: string; vendorNo: string; name: string; createdAt: Date }[]
  recentEmployees: { id: string; employeeNo: string; name: string; department: string | null; createdAt: Date }[]
  recentInventory: { id: string; itemCode: string; name: string; quantity: number; salePrice: number; updatedAt: Date }[]
  recentReceipts: { id: string; fileName: string; vendor: string | null; amount: number | null; status: string; createdAt: Date }[]
}): ActivityItem[] {
  const items: ActivityItem[] = []

  for (const inv of sources.recentInvoices) {
    items.push({
      id: `inv-${inv.id}`,
      type: 'invoice',
      label: inv.invoiceNo,
      detail: inv.customer.name,
      amount: inv.total,
      status: inv.status,
      date: inv.updatedAt.toISOString(),
      href: '/invoices',
    })
  }
  for (const bill of sources.recentBills) {
    items.push({
      id: `bill-${bill.id}`,
      type: 'bill',
      label: bill.billNo,
      detail: bill.vendor.name,
      amount: bill.total,
      status: bill.status,
      date: bill.updatedAt.toISOString(),
      href: '/bills',
    })
  }
  for (const exp of sources.recentExpenses) {
    items.push({
      id: `exp-${exp.id}`,
      type: 'expense',
      label: exp.expenseNo,
      detail: `${exp.category} · ${exp.description}`,
      amount: exp.total,
      status: exp.status,
      date: exp.updatedAt.toISOString(),
      href: '/expenses',
    })
  }
  for (const je of sources.recentJournal) {
    items.push({
      id: `jv-${je.id}`,
      type: 'journal',
      label: je.entryNo,
      detail: je.description,
      amount: je.totalDebit,
      status: je.status,
      date: je.updatedAt.toISOString(),
      href: '/journal',
    })
  }
  for (const pr of sources.recentPayroll) {
    items.push({
      id: `pr-${pr.id}`,
      type: 'payroll',
      label: pr.payrollNo,
      detail: `${pr.employee.name} · ${pr.period}`,
      amount: pr.netSalary,
      status: pr.status,
      date: pr.updatedAt.toISOString(),
      href: '/payroll',
    })
  }
  for (const pay of sources.recentPayments) {
    const ref = pay.invoice?.invoiceNo ?? pay.bill?.billNo ?? 'Payment'
    items.push({
      id: `pay-${pay.id}`,
      type: 'payment',
      label: pay.paymentNo,
      detail: ref,
      amount: pay.amount,
      date: pay.date.toISOString(),
      href: pay.invoice ? '/invoices' : '/bills',
    })
  }
  for (const c of sources.recentCustomers) {
    items.push({
      id: `cust-${c.id}`,
      type: 'customer',
      label: c.customerNo,
      detail: c.name,
      date: c.createdAt.toISOString(),
      href: '/customers',
    })
  }
  for (const v of sources.recentVendors) {
    items.push({
      id: `vend-${v.id}`,
      type: 'vendor',
      label: v.vendorNo,
      detail: v.name,
      date: v.createdAt.toISOString(),
      href: '/vendors',
    })
  }
  for (const e of sources.recentEmployees) {
    items.push({
      id: `emp-${e.id}`,
      type: 'employee',
      label: e.employeeNo,
      detail: `${e.name}${e.department ? ` · ${e.department}` : ''}`,
      date: e.createdAt.toISOString(),
      href: '/employees',
    })
  }
  for (const item of sources.recentInventory) {
    items.push({
      id: `item-${item.id}`,
      type: 'inventory',
      label: item.itemCode,
      detail: `${item.name} · Qty ${item.quantity}`,
      amount: item.salePrice * item.quantity,
      date: item.updatedAt.toISOString(),
      href: '/inventory',
    })
  }
  for (const r of sources.recentReceipts) {
    items.push({
      id: `rcpt-${r.id}`,
      type: 'receipt',
      label: r.fileName,
      detail: r.vendor ?? 'Uploaded receipt',
      amount: r.amount ?? undefined,
      status: r.status,
      date: r.createdAt.toISOString(),
      href: '/receipts',
    })
  }

  return items
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 20)
}

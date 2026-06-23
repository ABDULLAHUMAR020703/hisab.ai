export interface QaSeedResult {
  status: 'supabase-ready'
  customers: number
  inventory: number
  invoices: number
  vendors: number
  message: string
}

export async function seedQaData(): Promise<QaSeedResult> {
  return {
    status: 'supabase-ready',
    customers: 0,
    inventory: 0,
    invoices: 0,
    vendors: 0,
    message: 'Supabase runtime is active; sample data is managed in Supabase.',
  }
}

import type { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { DEMO_ACCOUNTANT_EMAIL, DEMO_ADMIN_EMAIL } from './brand'

const LEGACY_ADMIN_EMAIL = 'admin@financebook.com'
const LEGACY_ACCOUNTANT_EMAIL = 'accountant@financebook.com'

/** Rename legacy demo emails or create hisab.ai demo users (keeps existing data). */
export async function ensureDemoUsers(prisma: PrismaClient) {
  const pairs = [
    { legacy: LEGACY_ADMIN_EMAIL, email: DEMO_ADMIN_EMAIL, name: 'System Administrator', role: 'ADMIN', password: 'admin123' },
    { legacy: LEGACY_ACCOUNTANT_EMAIL, email: DEMO_ACCOUNTANT_EMAIL, name: 'Senior Accountant', role: 'ACCOUNTANT', password: 'accountant123' },
  ] as const

  for (const { legacy, email, name, role, password } of pairs) {
    const legacyUser = await prisma.user.findUnique({ where: { email: legacy } })
    const existing = await prisma.user.findUnique({ where: { email } })

    if (legacyUser && !existing) {
      await prisma.user.update({ where: { email: legacy }, data: { email } })
      console.log(`Migrated user ${legacy} → ${email}`)
      continue
    }

    if (!existing) {
      const hashed = await bcrypt.hash(password, 10)
      await prisma.user.create({
        data: { name, email, password: hashed, role, isActive: true },
      })
      console.log(`Created user ${email}`)
    }
  }
}

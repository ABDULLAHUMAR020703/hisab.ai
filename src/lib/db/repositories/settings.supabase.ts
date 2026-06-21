import 'server-only'
import {
  createCompanySettings,
  findFirstCompanySettings,
  updateCompanySettings,
  upsertCompanySettings,
} from '../settings.repository'
import type { SettingsRepository } from './settings.interface'

export const supabaseSettingsRepository: SettingsRepository = {
  findFirst: () => findFirstCompanySettings(),
  create: (input) => createCompanySettings(input),
  update: (companyId, input) => updateCompanySettings(companyId, input),
  upsert: (input) => upsertCompanySettings(input),
}

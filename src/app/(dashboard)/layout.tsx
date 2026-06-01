'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, BookOpen, FileText, Users, Receipt, CreditCard,
  Building2, DollarSign, UserCheck, Package, MapPin, Camera,
  BarChart3, Shield, UserCog, Settings, LogOut, ChevronLeft,
  Menu, X, List, Bell, ChevronDown, TrendingUp
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEMO_ADMIN_EMAIL, PRODUCT_NAME } from '@/lib/brand'

const NAV = [
  {
    section: null,
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard },
    ]
  },
  {
    section: 'Accounting',
    items: [
      { label: 'Chart of Accounts', href: '/accounts', icon: List },
      { label: 'Journal Entry', href: '/journal', icon: BookOpen },
    ]
  },
  {
    section: 'Income',
    items: [
      { label: 'Invoices', href: '/invoices', icon: FileText },
      { label: 'Customers', href: '/customers', icon: Users },
    ]
  },
  {
    section: 'Expenses',
    items: [
      { label: 'Bills', href: '/bills', icon: Receipt },
      { label: 'Expenses', href: '/expenses', icon: CreditCard },
      { label: 'Vendors', href: '/vendors', icon: Building2 },
    ]
  },
  {
    section: 'Operations',
    items: [
      { label: 'Payroll', href: '/payroll', icon: DollarSign },
      { label: 'Employees', href: '/employees', icon: UserCheck },
      { label: 'Inventory', href: '/inventory', icon: Package },
      { label: 'Cost Centers', href: '/cost-centers', icon: MapPin },
      { label: 'Receipts', href: '/receipts', icon: Camera },
    ]
  },
  {
    section: 'Reports & Tax',
    items: [
      { label: 'Reports', href: '/reports', icon: BarChart3 },
      { label: 'Tax & ZATCA', href: '/tax', icon: Shield },
    ]
  },
  {
    section: 'Administration',
    items: [
      { label: 'Users', href: '/users', icon: UserCog },
      { label: 'Settings', href: '/settings', icon: Settings },
    ]
  },
]

interface UserInfo {
  name?: string
  email?: string
  role?: string
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState<UserInfo>({ name: 'Admin', role: 'ADMIN' })
  const [showUserMenu, setShowUserMenu] = useState(false)

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).catch(() => null)
  }, [])

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const currentPageLabel = NAV.flatMap(s => s.items).find(i => isActive(i.href))?.label || 'Dashboard'

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className={cn(
        'flex items-center gap-3 px-4 py-5 border-b flex-shrink-0',
        'border-white/[0.06]'
      )}>
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-indigo-900/40">
          <TrendingUp size={18} className="text-white" />
        </div>
        {(!collapsed || mobile) && (
          <div className="overflow-hidden">
            <div className="text-white font-bold text-sm leading-tight">{PRODUCT_NAME}</div>
            <div className="text-indigo-300 text-[10px] font-medium truncate max-w-[130px] leading-tight mt-0.5">
              NETKOM Co.
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 overflow-y-auto sidebar-scroll py-3', collapsed && !mobile ? 'px-2' : 'px-3')}>
        {NAV.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-1' : ''}>
            {group.section && (!collapsed || mobile) && (
              <p className="px-2 pt-4 pb-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                {group.section}
              </p>
            )}
            {group.section && (collapsed && !mobile) && (
              <div className="my-2 border-t border-white/[0.05]" />
            )}
            {group.items.map((item) => {
              const Icon = item.icon
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => mobile && setMobileOpen(false)}
                  title={collapsed && !mobile ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-xl mb-0.5 transition-all duration-150 group relative',
                    collapsed && !mobile ? 'p-2.5 justify-center' : 'px-3 py-2.5',
                    active
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-indigo-300 rounded-r-full" />
                  )}
                  <Icon
                    size={17}
                    className={cn(
                      'flex-shrink-0 transition-colors',
                      active ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'
                    )}
                  />
                  {(!collapsed || mobile) && (
                    <span className={cn(
                      'text-[13px] font-medium truncate',
                      active ? 'text-white' : ''
                    )}>
                      {item.label}
                    </span>
                  )}
                  {active && (!collapsed || mobile) && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/60" />
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* User + Logout */}
      <div className={cn(
        'flex-shrink-0 border-t border-white/[0.06] p-3',
        collapsed && !mobile ? '' : ''
      )}>
        {(!collapsed || mobile) ? (
          <div className="rounded-xl bg-white/[0.04] p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">
                {(user.name || 'A')[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-semibold truncate">{user.name || 'Admin'}</p>
              <p className="text-slate-500 text-[10px] truncate">{user.role || 'ADMIN'}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogout}
            title="Logout"
            className="w-full flex items-center justify-center p-2.5 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut size={17} />
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col flex-shrink-0 transition-all duration-300 ease-in-out',
          collapsed ? 'w-[68px]' : 'w-[240px]'
        )}
        style={{ background: 'var(--bg-sidebar)' }}
      >
        <Sidebar />
      </aside>

      {/* Mobile Sidebar */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <aside className="w-[260px] flex flex-col animate-slide-in" style={{ background: 'var(--bg-sidebar)' }}>
            <Sidebar mobile />
          </aside>
          <div
            className="flex-1 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <header className="flex-shrink-0 bg-white border-b border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 px-4 md:px-6 h-[60px]">

            {/* Mobile toggle */}
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors"
            >
              <Menu size={20} />
            </button>

            {/* Collapse toggle (desktop) */}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="hidden md:flex p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <ChevronLeft size={18} className={cn('transition-transform duration-300', collapsed && 'rotate-180')} />
            </button>

            {/* Breadcrumb */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-slate-300 text-sm hidden sm:block">/</span>
              <span className="text-sm font-semibold text-slate-800 truncate">{currentPageLabel}</span>
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-2">

              {/* Notification bell */}
              <button className="relative p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <Bell size={18} />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500" />
              </button>

              {/* User */}
              <div className="relative">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
                    <span className="text-white text-xs font-bold">A</span>
                  </div>
                  <span className="hidden sm:block text-sm font-medium text-slate-700">Admin</span>
                  <ChevronDown size={14} className={cn('text-slate-400 transition-transform', showUserMenu && 'rotate-180')} />
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-30 animate-scale-in">
                    <div className="px-4 py-2 border-b border-slate-100">
                      <p className="text-xs font-semibold text-slate-700">Admin User</p>
                      <p className="text-xs text-slate-400">{DEMO_ADMIN_EMAIL}</p>
                    </div>
                    <a href="/settings" className="flex items-center gap-2 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                      <Settings size={14} /> Settings
                    </a>
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50 w-full text-left"
                    >
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

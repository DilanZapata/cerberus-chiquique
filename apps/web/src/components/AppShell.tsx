'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import {
  LayoutDashboard,
  Users,
  Clock3,
  FileText,
  CalendarCheck2,
  CalendarClock,
  FileSpreadsheet,
  SlidersHorizontal,
  Mail,
  LogOut,
  Menu,
  ShieldCheck,
  Milk,
  HelpCircle,
  MapPin,
  Briefcase,
  Pencil,
  AlertTriangle,
} from 'lucide-react';
import { clearSession, getUser } from '@/lib/auth';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Principal',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/employees', label: 'Empleados', icon: Users },
      { href: '/positions', label: 'Cargos y Horarios', icon: Briefcase },
      { href: '/attendance-history', label: 'Historial de Marcas', icon: MapPin },
      { href: '/payroll-manual', label: 'Corregir Marcas y Novedades', icon: Pencil },
      { href: '/jornadas-abiertas', label: 'Jornadas Abiertas', icon: AlertTriangle },
    ],
  },
  {
    title: 'Nomina',
    items: [
      { href: '/overtime', label: 'Horas Extra', icon: Clock3 },
      { href: '/incidences', label: 'Permisos e Incapacidades', icon: FileText },
      { href: '/rest-credits', label: 'Descanso Compensatorio', icon: CalendarCheck2 },
      { href: '/reports', label: 'Reportes (Excel)', icon: FileSpreadsheet },
    ],
  },
  {
    title: 'Operaciones',
    items: [
      { href: '/shift-patterns', label: 'Rutinas de Turnos', icon: CalendarClock },
      { href: '/milking-routine', label: 'Rutina de Ordeño', icon: Milk },
    ],
  },
  {
    title: 'Configuracion',
    items: [
      { href: '/settings/payroll', label: 'Parametros de Nomina', icon: SlidersHorizontal },
      { href: '/settings/email', label: 'Configuracion SMTP', icon: Mail },
    ],
  },
  {
    title: 'Ayuda',
    items: [{ href: '/help', label: 'Guia de uso', icon: HelpCircle }],
  },
];

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const user = getUser();
  const router = useRouter();

  function handleLogout() {
    clearSession();
    router.push('/login');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-white">
          <ShieldCheck size={18} />
        </div>
        <span className="text-base font-semibold text-ink">Cerberus</span>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="px-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">{section.title}</div>
            <div className="mt-1.5 space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={clsx(
                      'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active ? 'bg-brand-50 text-brand-700' : 'text-ink-secondary hover:bg-surface-page hover:text-ink',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand-500"
                        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                      />
                    )}
                    <Icon size={17} strokeWidth={2} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line-hair p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {(user?.fullName ?? '?').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{user?.fullName ?? 'Invitado'}</div>
            <div className="truncate text-xs text-ink-muted">{user?.role ?? ''}</div>
          </div>
          <button
            onClick={handleLogout}
            title="Cerrar sesion"
            className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-page hover:text-ink"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!getUser()) {
      router.replace('/login');
    } else {
      setChecked(true);
    }
  }, [router]);

  if (!checked) return null;

  return (
    <div className="flex min-h-screen bg-surface-page">
      <aside className="hidden w-64 shrink-0 border-r border-line-hair bg-surface-card lg:block">
        <SidebarContent pathname={pathname} />
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30 lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <motion.aside
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="h-full w-64 bg-surface-card"
              onClick={(e) => e.stopPropagation()}
            >
              <SidebarContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line-hair bg-surface-card px-4 py-3 lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-page">
            <Menu size={20} />
          </button>
          <span className="text-sm font-semibold text-ink">Cerberus</span>
        </header>

        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mx-auto w-full max-w-6xl flex-1 p-6 sm:p-8"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}

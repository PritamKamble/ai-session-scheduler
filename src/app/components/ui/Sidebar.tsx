import { usePathname } from 'next/navigation';
import { Users, ShieldCheck, KeyRound, Mail, Home, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';

const navLinks = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/roles', label: 'Roles', icon: ShieldCheck },
  { href: '/admin/permissions', label: 'Permissions', icon: KeyRound },
  { href: '/admin/invites', label: 'Invites', icon: Mail },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-16 h-[calc(100vh-4rem)] w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 py-6 px-4 hidden md:block">
      <ul className="space-y-2">
        {navLinks.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg font-medium transition-colors
                ${pathname === href ? 'bg-primary text-white' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
              aria-current={pathname === href ? 'page' : undefined}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
} 
import type * as React from 'react';
import { Link } from 'react-router-dom';
import { Hexagon } from 'lucide-react';
import { ThemeToggle } from '@/components/layout/Topbar';

interface AuthLayoutProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between px-6">
        <Link to="/login" className="flex items-center gap-2 font-semibold tracking-tight">
          <Hexagon className="size-5 text-primary" aria-hidden />
          NEXUS
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-8 sm:pt-16">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description ? <p className="mt-1 text-[13px] text-muted-foreground">{description}</p> : null}
          </div>
          <div className="rounded-lg border bg-card p-6 shadow-sm">{children}</div>
          {footer ? <div className="mt-4 text-center text-[13px] text-muted-foreground">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}

import { useEffect, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/query-client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { resolveTheme, useUiStore } from '@/stores/ui.store';
import { RealtimeProvider } from '@/features/realtime/RealtimeProvider';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const resolved = resolveTheme(theme);
      root.classList.toggle('dark', resolved === 'dark');
      root.style.colorScheme = resolved;
    };
    apply();
    if (theme !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  return <>{children}</>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const theme = useUiStore((s) => s.theme);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RealtimeProvider>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        </RealtimeProvider>
        <Toaster
          position="bottom-right"
          theme={resolveTheme(theme)}
          closeButton
          toastOptions={{ classNames: { toast: 'text-[13px]' } }}
        />
      </ThemeProvider>
      {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" /> : null}
    </QueryClientProvider>
  );
}

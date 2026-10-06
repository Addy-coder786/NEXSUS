import { lazy, Suspense, type ComponentProps } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/** Recharts is loaded only when an analytics page renders. */
const StatusDonutImpl = lazy(() => import('./StatusDonut').then((m) => ({ default: m.StatusDonut })));
const PriorityBarsImpl = lazy(() => import('./PriorityBars').then((m) => ({ default: m.PriorityBars })));
const VelocityChartImpl = lazy(() => import('./VelocityChart').then((m) => ({ default: m.VelocityChart })));

const fallback = <Skeleton className="h-64" />;

export function StatusDonut(props: ComponentProps<typeof StatusDonutImpl>) {
  return (
    <Suspense fallback={fallback}>
      <StatusDonutImpl {...props} />
    </Suspense>
  );
}

export function PriorityBars(props: ComponentProps<typeof PriorityBarsImpl>) {
  return (
    <Suspense fallback={fallback}>
      <PriorityBarsImpl {...props} />
    </Suspense>
  );
}

export function VelocityChart(props: ComponentProps<typeof VelocityChartImpl>) {
  return (
    <Suspense fallback={fallback}>
      <VelocityChartImpl {...props} />
    </Suspense>
  );
}

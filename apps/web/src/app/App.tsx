import { RouterProvider } from 'react-router-dom';
import { AppProviders } from './providers';
import { router } from './router';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useBootstrapAuth } from '@/features/auth/hooks';

function AuthBootstrap() {
  useBootstrapAuth();
  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <AuthBootstrap />
        <RouterProvider router={router} />
      </AppProviders>
    </ErrorBoundary>
  );
}

import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { RequireAnon, RequireAuth, RequireWorkspace, RootRedirect } from './guards';
import { AppShell } from '@/components/layout/AppShell';
import { NotFound } from '@/components/common/NotFound';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { RegisterPage } from '@/features/auth/pages/RegisterPage';
import { ForgotPasswordPage } from '@/features/auth/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage';
import { VerifyEmailPage } from '@/features/auth/pages/VerifyEmailPage';
import { OAuthCallbackPage } from '@/features/auth/pages/OAuthCallbackPage';
import { AcceptInvitePage } from '@/features/workspaces/pages/AcceptInvitePage';
import { OnboardingPage } from '@/features/workspaces/pages/OnboardingPage';
import { WorkspaceDashboardPage } from '@/features/workspaces/pages/WorkspaceDashboardPage';
import { ProjectLayout } from '@/features/projects/pages/ProjectLayout';
import { ProjectBoardPage } from '@/features/projects/pages/ProjectBoardPage';

/**
 * Route-level code splitting: a page module is fetched on first navigation to it. The router
 * keeps the current screen until it has loaded, so no Suspense boundary is needed.
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return () => load().then((m) => ({ Component: m[name] }));
}

/** `/w/:ws/projects/:p/tasks/:taskId` → board with the drawer open via `?task=`. */
function TaskRedirect() {
  const { taskId } = useParams<{ taskId: string }>();
  const [search] = useSearchParams();
  const params = new URLSearchParams(search);
  if (taskId) params.set('task', taskId);
  return <Navigate to={`../board?${params.toString()}`} replace relative="path" />;
}

export const router = createBrowserRouter([
  {
    errorElement: (
      <ErrorBoundary>
        <NotFound />
      </ErrorBoundary>
    ),
    children: [
      {
        element: <RequireAnon />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
          { path: '/reset-password', element: <ResetPasswordPage /> },
        ],
      },
      // Reachable in both states: a signed-in user may verify / return from OAuth.
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/auth/callback', element: <OAuthCallbackPage /> },
      { path: '/invite/:token', element: <AcceptInvitePage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <RootRedirect /> },
          { path: '/onboarding', element: <OnboardingPage /> },
          {
            element: <AppShell />,
            children: [
              {
                path: '/settings/profile',
                lazy: page(
                  () => import('@/features/users/pages/ProfileSettingsPage'),
                  'ProfileSettingsPage',
                ),
              },
              {
                path: '/notifications',
                lazy: page(
                  () => import('@/features/notifications/pages/NotificationsPage'),
                  'NotificationsPage',
                ),
              },
              {
                path: '/w/:workspaceId',
                element: <RequireWorkspace />,
                children: [
                  { index: true, element: <WorkspaceDashboardPage /> },
                  {
                    path: 'members',
                    lazy: page(
                      () => import('@/features/workspaces/pages/MembersPage'),
                      'MembersPage',
                    ),
                  },
                  {
                    path: 'settings',
                    lazy: page(
                      () => import('@/features/workspaces/pages/WorkspaceSettingsPage'),
                      'WorkspaceSettingsPage',
                    ),
                  },
                  {
                    path: 'chat',
                    lazy: page(() => import('@/features/chat/pages/ChatPage'), 'ChatPage'),
                  },
                  {
                    path: 'chat/:channelId',
                    lazy: page(() => import('@/features/chat/pages/ChatPage'), 'ChatPage'),
                  },
                  {
                    path: 'docs',
                    lazy: page(
                      () => import('@/features/documents/pages/DocumentsPage'),
                      'DocumentsPage',
                    ),
                  },
                  {
                    path: 'docs/:documentId',
                    lazy: page(
                      () => import('@/features/documents/pages/DocumentPage'),
                      'DocumentPage',
                    ),
                  },
                  {
                    path: 'files',
                    lazy: page(() => import('@/features/files/pages/FilesPage'), 'FilesPage'),
                  },
                  {
                    path: 'search',
                    lazy: page(() => import('@/features/search/pages/SearchPage'), 'SearchPage'),
                  },
                  {
                    path: 'analytics',
                    lazy: page(
                      () => import('@/features/analytics/pages/WorkspaceAnalyticsPage'),
                      'WorkspaceAnalyticsPage',
                    ),
                  },
                  {
                    path: 'assistant',
                    lazy: page(() => import('@/features/ai/pages/AssistantPage'), 'AssistantPage'),
                  },
                  {
                    path: 'assistant/:conversationId',
                    lazy: page(() => import('@/features/ai/pages/AssistantPage'), 'AssistantPage'),
                  },
                  {
                    path: 'meetings',
                    lazy: page(
                      () => import('@/features/meetings/pages/MeetingsPage'),
                      'MeetingsPage',
                    ),
                  },
                  {
                    path: 'meetings/:meetingId',
                    lazy: page(
                      () => import('@/features/meetings/pages/MeetingPage'),
                      'MeetingPage',
                    ),
                  },
                  {
                    path: 'projects/:projectId',
                    element: <ProjectLayout />,
                    children: [
                      { index: true, element: <Navigate to="board" replace /> },
                      { path: 'board', element: <ProjectBoardPage /> },
                      {
                        path: 'list',
                        lazy: page(
                          () => import('@/features/projects/pages/ProjectListPage'),
                          'ProjectListPage',
                        ),
                      },
                      {
                        path: 'chat',
                        lazy: page(
                          () => import('@/features/chat/pages/ProjectChatPage'),
                          'ProjectChatPage',
                        ),
                      },
                      {
                        path: 'docs',
                        lazy: page(
                          () => import('@/features/documents/pages/ProjectDocsPage'),
                          'ProjectDocsPage',
                        ),
                      },
                      {
                        path: 'files',
                        lazy: page(
                          () => import('@/features/files/pages/ProjectFilesPage'),
                          'ProjectFilesPage',
                        ),
                      },
                      {
                        path: 'analytics',
                        lazy: page(
                          () => import('@/features/analytics/pages/ProjectAnalyticsPage'),
                          'ProjectAnalyticsPage',
                        ),
                      },
                      {
                        path: 'activity',
                        lazy: page(
                          () => import('@/features/projects/pages/ProjectActivityPage'),
                          'ProjectActivityPage',
                        ),
                      },
                      {
                        path: 'settings',
                        lazy: page(
                          () => import('@/features/projects/pages/ProjectSettingsPage'),
                          'ProjectSettingsPage',
                        ),
                      },
                      { path: 'tasks/:taskId', element: <TaskRedirect /> },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

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
import { MembersPage } from '@/features/workspaces/pages/MembersPage';
import { WorkspaceSettingsPage } from '@/features/workspaces/pages/WorkspaceSettingsPage';
import { ProjectLayout } from '@/features/projects/pages/ProjectLayout';
import { ProjectBoardPage } from '@/features/projects/pages/ProjectBoardPage';
import { ProjectListPage } from '@/features/projects/pages/ProjectListPage';
import { ProjectActivityPage } from '@/features/projects/pages/ProjectActivityPage';
import { ProjectSettingsPage } from '@/features/projects/pages/ProjectSettingsPage';
import { ProfileSettingsPage } from '@/features/users/pages/ProfileSettingsPage';
import { ChatPage } from '@/features/chat/pages/ChatPage';
import { ProjectChatPage } from '@/features/chat/pages/ProjectChatPage';
import { NotificationsPage } from '@/features/notifications/pages/NotificationsPage';
import { DocumentsPage } from '@/features/documents/pages/DocumentsPage';
import { DocumentPage } from '@/features/documents/pages/DocumentPage';
import { ProjectDocsPage } from '@/features/documents/pages/ProjectDocsPage';
import { FilesPage } from '@/features/files/pages/FilesPage';
import { ProjectFilesPage } from '@/features/files/pages/ProjectFilesPage';
import { SearchPage } from '@/features/search/pages/SearchPage';
import { WorkspaceAnalyticsPage } from '@/features/analytics/pages/WorkspaceAnalyticsPage';
import { ProjectAnalyticsPage } from '@/features/analytics/pages/ProjectAnalyticsPage';
import { AssistantPage } from '@/features/ai/pages/AssistantPage';
import { MeetingsPage } from '@/features/meetings/pages/MeetingsPage';
import { MeetingPage } from '@/features/meetings/pages/MeetingPage';

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
              { path: '/settings/profile', element: <ProfileSettingsPage /> },
              { path: '/notifications', element: <NotificationsPage /> },
              {
                path: '/w/:workspaceId',
                element: <RequireWorkspace />,
                children: [
                  { index: true, element: <WorkspaceDashboardPage /> },
                  { path: 'members', element: <MembersPage /> },
                  { path: 'settings', element: <WorkspaceSettingsPage /> },
                  { path: 'chat', element: <ChatPage /> },
                  { path: 'chat/:channelId', element: <ChatPage /> },
                  { path: 'docs', element: <DocumentsPage /> },
                  { path: 'docs/:documentId', element: <DocumentPage /> },
                  { path: 'files', element: <FilesPage /> },
                  { path: 'search', element: <SearchPage /> },
                  { path: 'analytics', element: <WorkspaceAnalyticsPage /> },
                  { path: 'assistant', element: <AssistantPage /> },
                  { path: 'assistant/:conversationId', element: <AssistantPage /> },
                  { path: 'meetings', element: <MeetingsPage /> },
                  { path: 'meetings/:meetingId', element: <MeetingPage /> },
                  {
                    path: 'projects/:projectId',
                    element: <ProjectLayout />,
                    children: [
                      { index: true, element: <Navigate to="board" replace /> },
                      { path: 'board', element: <ProjectBoardPage /> },
                      { path: 'list', element: <ProjectListPage /> },
                      { path: 'chat', element: <ProjectChatPage /> },
                      { path: 'docs', element: <ProjectDocsPage /> },
                      { path: 'files', element: <ProjectFilesPage /> },
                      { path: 'analytics', element: <ProjectAnalyticsPage /> },
                      { path: 'activity', element: <ProjectActivityPage /> },
                      { path: 'settings', element: <ProjectSettingsPage /> },
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

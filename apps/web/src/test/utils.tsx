import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { LabelDto, TaskDto, UserPublicDto } from '@nexus/shared';
import { TooltipProvider } from '@/components/ui/tooltip';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  options: { route?: string; queryClient?: QueryClient } & Omit<RenderOptions, 'wrapper'> = {},
) {
  const { route = '/', queryClient = createTestQueryClient(), ...rest } = options;
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...rest }) };
}

let seq = 0;
const hex = (n: number) => n.toString(16).padStart(24, '0');

export function makeUser(overrides: Partial<UserPublicDto> = {}): UserPublicDto {
  seq += 1;
  return {
    id: hex(seq),
    name: `User ${seq}`,
    email: `user${seq}@example.com`,
    avatarUrl: null,
    title: null,
    availability: 'AVAILABLE',
    ...overrides,
  };
}

export function makeLabel(overrides: Partial<LabelDto> = {}): LabelDto {
  seq += 1;
  return { id: hex(seq), name: `Label ${seq}`, color: '#6366f1', ...overrides };
}

export function makeTask(overrides: Partial<TaskDto> = {}): TaskDto {
  seq += 1;
  const now = new Date().toISOString();
  return {
    id: hex(seq),
    projectId: hex(1),
    workspaceId: hex(2),
    number: seq,
    key: `WEB-${seq}`,
    title: `Task ${seq}`,
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    position: seq * 1024,
    assignee: null,
    createdBy: makeUser(),
    labels: [],
    dueDate: null,
    startDate: null,
    estimateHours: null,
    parentTaskId: null,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    checklist: [],
    dependsOn: [],
    commentCount: 0,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

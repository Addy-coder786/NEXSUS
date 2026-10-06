import { z } from 'zod';
import type { ProjectHealth, TaskPriority, TaskStatus } from '../constants';
import type { UserPublicDto } from './user';

export const analyticsQuerySchema = z.object({
  /** Number of trailing weeks for trend series. */
  weeks: z.coerce.number().int().min(2).max(26).default(8),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export interface TaskSummaryStats {
  total: number;
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<TaskPriority, number>;
  overdue: number;
  unassigned: number;
  blocked: number;
  dueNext7Days: number;
  completedLast7Days: number;
  createdLast7Days: number;
  /** 0..100 */
  progressPercent: number;
}

export interface VelocityPoint {
  /** ISO date of the Monday starting the week */
  weekStart: string;
  created: number;
  completed: number;
}

export interface WorkloadRow {
  user: UserPublicDto;
  open: number;
  inProgress: number;
  overdue: number;
  completedLast7Days: number;
}

export interface HealthAssessment {
  status: ProjectHealth;
  /** 0..100 */
  score: number;
  reasons: string[];
  recommendation: string | null;
}

export interface ProjectAnalyticsDto {
  projectId: string;
  summary: TaskSummaryStats;
  velocity: VelocityPoint[];
  workload: WorkloadRow[];
  health: HealthAssessment;
  /** Average days from creation to completion over the window, null if none completed */
  avgCycleTimeDays: number | null;
  generatedAt: string;
}

export interface ProjectProgressRow {
  projectId: string;
  name: string;
  key: string;
  color: string;
  status: string;
  total: number;
  done: number;
  overdue: number;
  progressPercent: number;
  health: ProjectHealth;
  dueDate: string | null;
}

export interface WorkspaceAnalyticsDto {
  workspaceId: string;
  summary: TaskSummaryStats;
  velocity: VelocityPoint[];
  workload: WorkloadRow[];
  projects: ProjectProgressRow[];
  activeMembers7Days: number;
  generatedAt: string;
}

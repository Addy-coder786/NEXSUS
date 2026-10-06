import { z } from 'zod';
import {
  activityQuerySchema,
  objectIdSchema,
  taskListQuerySchema,
  type AddProjectMembersInput,
  type CreateLabelInput,
  type CreateProjectInput,
  type CreateTaskInput,
  type UpdateLabelInput,
  type UpdateProjectInput,
} from '@nexus/shared';
import { getAuthUser, getProjectContext, getWorkspaceContext } from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { created, noContent, ok } from '../../utils/response';
import { listProjectActivities } from '../activity/activity.service';
import * as taskService from '../tasks/task.service';
import * as projectService from './project.service';

export const projectMemberParamsSchema = z.object({ id: objectIdSchema, userId: objectIdSchema });
export const labelParamsSchema = z.object({ id: objectIdSchema, labelId: objectIdSchema });

type ProjectMemberParams = z.infer<typeof projectMemberParamsSchema>;
type LabelParams = z.infer<typeof labelParamsSchema>;

// Mounted under /workspaces/:id/projects

export const createProject = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const input: CreateProjectInput = req.body;
  created(res, await projectService.createProject(ws.id, user.id, input));
});

export const listProjects = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  ok(res, await projectService.listProjects(ws.id, user.id, ws.role));
});

// /projects/:id

export const getProject = asyncHandler(async (req, res) => {
  ok(res, await projectService.buildProjectDto(getProjectContext(req)));
});

export const updateProject = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: UpdateProjectInput = req.body;
  ok(res, await projectService.updateProject(getProjectContext(req), user.id, input));
});

export const deleteProject = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  await projectService.deleteProject(getProjectContext(req), user.id);
  noContent(res);
});

export const addMembers = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: AddProjectMembersInput = req.body;
  ok(res, await projectService.addProjectMembers(getProjectContext(req), user.id, input));
});

export const removeMember = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { userId } = req.params as ProjectMemberParams;
  ok(res, await projectService.removeProjectMember(getProjectContext(req), user.id, userId));
});

// Labels

export const listLabels = asyncHandler(async (req, res) => {
  ok(res, projectService.listLabels(getProjectContext(req)));
});

export const createLabel = asyncHandler(async (req, res) => {
  const input: CreateLabelInput = req.body;
  created(res, await projectService.createLabel(getProjectContext(req), input));
});

export const updateLabel = asyncHandler(async (req, res) => {
  const { labelId } = req.params as LabelParams;
  const input: UpdateLabelInput = req.body;
  ok(res, await projectService.updateLabel(getProjectContext(req), labelId, input));
});

export const deleteLabel = asyncHandler(async (req, res) => {
  const { labelId } = req.params as LabelParams;
  await projectService.deleteLabel(getProjectContext(req), labelId);
  noContent(res);
});

// Tasks

export const listTasks = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const query = typedQuery(req, taskListQuerySchema);
  const { items, meta } = await taskService.listTasks(getProjectContext(req), user.id, query);
  ok(res, items, meta);
});

export const createTask = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: CreateTaskInput = req.body;
  created(res, await taskService.createTask(getProjectContext(req), user.id, input));
});

// Activities

export const listActivities = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  const project = getProjectContext(req);
  const query = typedQuery(req, activityQuerySchema);
  const { items, meta } = await listProjectActivities(ws.id, String(project._id), query);
  ok(res, items, meta);
});

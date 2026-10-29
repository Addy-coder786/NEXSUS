import { events } from '../../events';
import { invalidateProjectInsight } from './insights.service';

// Project insights are rebuilt from fresh analytics after any task change in that project.
events.on('task.created', ({ task }) => invalidateProjectInsight(task.projectId));
events.on('task.updated', ({ task }) => invalidateProjectInsight(task.projectId));
events.on('task.moved', ({ task }) => invalidateProjectInsight(task.projectId));
events.on('task.deleted', ({ projectId }) => invalidateProjectInsight(projectId));

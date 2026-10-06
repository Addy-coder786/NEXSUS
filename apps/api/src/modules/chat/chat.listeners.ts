import { events } from '../../events';
import { logger } from '../../config/logger';
import { archiveProjectChannels, createProjectChannel, ensureGeneralChannel } from './channel.service';

/**
 * System channels: every workspace gets `#general`, every project gets a PUBLIC channel named
 * after it (slug `proj-<key>`), archived when the project is deleted.
 */

events.on('workspace.created', async ({ workspaceId, ownerId }) => {
  try {
    await ensureGeneralChannel(workspaceId, ownerId);
  } catch (err) {
    logger.error({ err, workspaceId }, 'Failed to create #general channel');
  }
});

events.on('project.created', async ({ project, actorId }) => {
  try {
    await createProjectChannel(project, actorId);
  } catch (err) {
    logger.error({ err, projectId: project.id }, 'Failed to create project channel');
  }
});

events.on('project.deleted', async ({ projectId, actorId }) => {
  try {
    await archiveProjectChannels(projectId, actorId);
  } catch (err) {
    logger.error({ err, projectId }, 'Failed to archive project channel');
  }
});

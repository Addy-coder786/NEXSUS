/** Client routes for entities surfaced by AI features (same formats as Phase 2 notifications). */
export const links = {
  task: (workspaceId: string, projectId: string, taskId: string) =>
    `/w/${workspaceId}/projects/${projectId}/board?task=${taskId}`,
  project: (workspaceId: string, projectId: string) => `/w/${workspaceId}/projects/${projectId}/board`,
  document: (workspaceId: string, documentId: string) => `/w/${workspaceId}/docs/${documentId}`,
  message: (workspaceId: string, channelId: string) => `/w/${workspaceId}/chat/${channelId}`,
  file: (workspaceId: string) => `/w/${workspaceId}/files`,
  meeting: (workspaceId: string, meetingId: string) => `/w/${workspaceId}/meetings/${meetingId}`,
};

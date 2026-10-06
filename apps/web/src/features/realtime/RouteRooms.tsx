import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProjectRoom } from './hooks';
import { registerNavigator } from './navigation';

/**
 * Rendered inside the router (Topbar): joins the realtime room of the project in the URL and lets
 * toasts navigate client-side.
 */
export function RouteRooms() {
  const { projectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();
  useProjectRoom(projectId);
  useEffect(() => {
    registerNavigator((to) => navigate(to));
    return () => registerNavigator(null);
  }, [navigate]);
  return null;
}

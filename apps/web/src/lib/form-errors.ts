import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { getErrorMessage, isApiError } from './api';

/**
 * Maps a `VALIDATION_ERROR` onto react-hook-form fields; any other error is shown as a toast
 * (or passed to `onOther`). Returns true when at least one field error was set.
 */
export function applyApiErrorToForm<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  options?: { fields?: readonly Path<T>[]; onOther?: (message: string, code: string) => void; silent?: boolean },
): boolean {
  if (isApiError(error) && error.code === 'VALIDATION_ERROR') {
    let applied = false;
    for (const detail of error.validationDetails) {
      const path = detail.path.replace(/^body\./, '') as Path<T>;
      if (!path) continue;
      if (options?.fields && !options.fields.includes(path)) continue;
      setError(path, { type: 'server', message: detail.message });
      applied = true;
    }
    if (applied) return true;
    setError('root' as Path<T>, { type: 'server', message: error.message });
    return true;
  }
  const message = getErrorMessage(error);
  const code = isApiError(error) ? error.code : 'UNKNOWN';
  if (options?.onOther) options.onOther(message, code);
  else if (!options?.silent) toast.error(message);
  return false;
}

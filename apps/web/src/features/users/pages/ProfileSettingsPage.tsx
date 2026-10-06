import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Camera, Laptop, LogOut, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  changePasswordSchema,
  notificationPreferencesSchema,
  updateProfileSchema,
  USER_AVAILABILITY,
  type NotificationPreferences,
  type UpdateProfileInput,
  type UserDto,
} from '@nexus/shared';
import { useChangePassword, useRemoveAvatar, useUpdatePreferences, useUpdateProfile, useUploadAvatar } from '../hooks';
import { useLogoutAll, useRevokeSession, useSessions } from '@/features/auth/hooks';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FormField } from '@/components/common/FormField';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useAuthStore } from '@/stores/auth.store';
import { applyApiErrorToForm } from '@/lib/form-errors';
import { getErrorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { humanize } from '@/lib/utils';

export function ProfileSettingsPage() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Profile settings" description="Your personal details, security and notifications." />
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        <div className="max-w-2xl space-y-6">
          <ProfileCard key={user.id + user.avatarUrl} user={user} />
          <NotificationsCard key={`n-${user.id}`} user={user} />
          {user.hasPassword ? <PasswordCard /> : <NoPasswordCard providers={user.oauthProviders} />}
          <SessionsCard />
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ user }: { user: UserDto }) {
  const update = useUpdateProfile();
  const upload = useUploadAvatar();
  const removeAvatar = useRemoveAvatar();
  const fileRef = useRef<HTMLInputElement>(null);
  const { register, handleSubmit, control, setError, formState } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      name: user.name,
      title: user.title ?? '',
      bio: user.bio ?? '',
      timezone: user.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      availability: user.availability,
    },
  });

  const onSubmit = handleSubmit((values) => {
    update.mutate(values, {
      onSuccess: () => toast.success('Profile updated'),
      onError: (error) => applyApiErrorToForm(error, setError),
    });
  });

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be 2 MB or smaller');
      return;
    }
    upload.mutate(file, {
      onSuccess: () => toast.success('Avatar updated'),
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How you appear to your teammates.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          <UserAvatar user={user} size="xl" />
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" loading={upload.isPending} onClick={() => fileRef.current?.click()}>
                <Camera /> Upload
              </Button>
              {user.avatarUrl ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={removeAvatar.isPending}
                  onClick={() => removeAvatar.mutate(undefined, { onError: (e) => toast.error(getErrorMessage(e)) })}
                >
                  <Trash2 /> Remove
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPG or WebP up to 2 MB.</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Upload avatar"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="pf-name" label="Full name" error={formState.errors.name?.message}>
              <Input autoComplete="name" {...register('name')} />
            </FormField>
            <FormField id="pf-email" label="Email" hint={user.emailVerified ? 'Verified' : 'Not verified'}>
              <Input value={user.email} disabled readOnly />
            </FormField>
            <FormField id="pf-title" label="Job title" error={formState.errors.title?.message}>
              <Input placeholder="Product designer" {...register('title')} />
            </FormField>
            <Controller
              control={control}
              name="availability"
              render={({ field }) => (
                <FormField id="pf-availability" label="Availability">
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger aria-label="Availability">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {USER_AVAILABILITY.map((a) => (
                        <SelectItem key={a} value={a}>
                          {humanize(a)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
            <FormField id="pf-timezone" label="Timezone" error={formState.errors.timezone?.message} className="sm:col-span-2">
              <Input placeholder="Europe/Berlin" {...register('timezone')} />
            </FormField>
          </div>
          <FormField id="pf-bio" label="Bio" error={formState.errors.bio?.message}>
            <Textarea rows={3} maxLength={300} {...register('bio')} />
          </FormField>
          <div className="flex justify-end">
            <Button type="submit" loading={update.isPending} disabled={!formState.isDirty}>
              Save profile
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const NOTIFICATION_LABELS: Record<keyof NotificationPreferences, string> = {
  email: 'Email notifications',
  inApp: 'In-app notifications',
  taskAssigned: 'When a task is assigned to me',
  taskCompleted: 'When a task I created is completed',
  mentions: 'When someone mentions me',
  comments: 'Comments on my tasks',
  deadlines: 'Upcoming deadlines',
};

function NotificationsCard({ user }: { user: UserDto }) {
  const update = useUpdatePreferences();
  const [prefs, setPrefs] = useState<NotificationPreferences>(() =>
    notificationPreferencesSchema.parse(user.preferences.notifications),
  );
  const keys = Object.keys(NOTIFICATION_LABELS) as (keyof NotificationPreferences)[];

  const toggle = (key: keyof NotificationPreferences, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    update.mutate(
      { notifications: { [key]: value } },
      {
        onError: (e) => {
          setPrefs(prefs);
          toast.error(getErrorMessage(e));
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Choose what you want to hear about. Changes save automatically.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {keys.map((key) => (
            <li key={key} className="flex items-center justify-between py-2.5">
              <Label htmlFor={`notif-${key}`} className="font-normal">
                {NOTIFICATION_LABELS[key]}
              </Label>
              <Checkbox id={`notif-${key}`} checked={prefs[key]} onCheckedChange={(v) => toggle(key, v === true)} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const passwordFormSchema = changePasswordSchema
  .extend({ confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type PasswordForm = z.infer<typeof passwordFormSchema>;

function PasswordCard() {
  const change = useChangePassword();
  const { register, handleSubmit, setError, reset, formState } = useForm<PasswordForm>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const onSubmit = handleSubmit((values) => {
    change.mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      {
        onSuccess: () => {
          toast.success('Password changed. Other sessions were signed out.');
          reset();
        },
        onError: (error) =>
          applyApiErrorToForm(error, setError, {
            onOther: (message, code) =>
              code === 'UNAUTHORIZED' || code === 'BAD_REQUEST'
                ? setError('currentPassword', { type: 'server', message })
                : setError('root', { type: 'server', message }),
          }),
      },
    );
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing your password signs out every other device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formState.errors.root ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              {formState.errors.root.message}
            </p>
          ) : null}
          <FormField id="pw-current" label="Current password" error={formState.errors.currentPassword?.message}>
            <Input type="password" autoComplete="current-password" {...register('currentPassword')} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="pw-new" label="New password" error={formState.errors.newPassword?.message}>
              <Input type="password" autoComplete="new-password" {...register('newPassword')} />
            </FormField>
            <FormField id="pw-confirm" label="Confirm new password" error={formState.errors.confirm?.message}>
              <Input type="password" autoComplete="new-password" {...register('confirm')} />
            </FormField>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={change.isPending}>
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function NoPasswordCard({ providers }: { providers: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          You sign in with {providers.map(humanize).join(', ') || 'an external provider'}. Use &quot;Forgot password&quot; on
          the sign-in page to set a password for this account.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function SessionsCard() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const logoutAll = useLogoutAll();
  const [confirmAll, setConfirmAll] = useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="space-y-1">
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Devices currently signed in to your account.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setConfirmAll(true)}>
          <LogOut /> Sign out everywhere
        </Button>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : sessions.isError ? (
          <p role="alert" className="text-[13px] text-destructive">{sessions.error.message}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{describeUserAgent(s.userAgent)}</span>
                    {s.current ? <Badge variant="success">This device</Badge> : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.ip ?? 'Unknown IP'} · last active {formatRelative(s.lastUsedAt)} · signed in {formatDateTime(s.createdAt)}
                  </div>
                </div>
                {!s.current ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={revoke.isPending && revoke.variables === s.id}
                    onClick={() =>
                      revoke.mutate(s.id, {
                        onSuccess: () => toast.success('Session revoked'),
                        onError: (e) => toast.error(getErrorMessage(e)),
                      })
                    }
                  >
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out of all devices?"
        description="You will be signed out here too and need to sign in again."
        confirmLabel="Sign out everywhere"
        destructive
        loading={logoutAll.isPending}
        onConfirm={() => logoutAll.mutate()}
      />
    </Card>
  );
}

function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

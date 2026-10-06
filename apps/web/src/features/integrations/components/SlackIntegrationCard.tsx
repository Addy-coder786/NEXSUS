import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Hash, Plus, Slack, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { NOTIFICATION_TYPES, type NotificationType, type SlackIntegrationDto } from '@nexus/shared';
import { useDisconnectSlack, useIntegrations, useSlackChannels, useUnsyncSlackChannel, useUpdateSlack } from '../hooks';
import { slackInstallUrl } from '../api';
import { NOTIFICATION_TYPE_LABELS } from '../labels';
import { SyncChannelsDialog } from './SyncChannelsDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { getErrorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/format';

const NO_CHANNEL = '__none__';

export function SlackIntegrationCard({ workspaceId }: { workspaceId: string }) {
  const overview = useIntegrations(workspaceId);
  const [params, setParams] = useSearchParams();

  // `?slack=connected|error` arrives from the OAuth callback redirect.
  const slackParam = params.get('slack');
  useEffect(() => {
    if (!slackParam) return;
    if (slackParam === 'connected') toast.success('Slack connected');
    else if (slackParam === 'error') toast.error('Slack connection failed. Please try again.');
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('slack');
        return next;
      },
      { replace: true },
    );
  }, [slackParam, setParams]);

  if (overview.isPending) return <Skeleton className="h-40" />;
  if (overview.isError) {
    return (
      <Card>
        <CardContent className="p-4">
          <p role="alert" className="text-[13px] text-destructive">
            {overview.error.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { available, slack } = overview.data;

  return (
    <Card data-testid="slack-card">
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-card">
          <Slack className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CardTitle>Slack</CardTitle>
            {slack ? <StatusBadge status={slack.status} /> : null}
          </div>
          <CardDescription className="mt-1">
            Post workspace notifications to a Slack channel and mirror Slack conversations into NEXUS chat.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {!available.slack ? (
          <p className="rounded-md border border-dashed px-3 py-2.5 text-[13px] text-muted-foreground" role="note">
            Slack is not configured on this server. Ask the administrator to set the Slack client id, secret and signing secret.
          </p>
        ) : !slack ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-muted-foreground">Connect your Slack workspace to get started. You will be asked to authorise NEXUS in Slack.</p>
            <Button asChild>
              <a href={slackInstallUrl(workspaceId)} rel="noopener">
                <Slack /> Add to Slack
              </a>
            </Button>
          </div>
        ) : (
          <ConnectedSlack workspaceId={workspaceId} slack={slack} />
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: SlackIntegrationDto['status'] }) {
  if (status === 'ACTIVE') return <Badge variant="success">Connected</Badge>;
  if (status === 'ERROR') return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Revoked</Badge>;
}

function ConnectedSlack({ workspaceId, slack }: { workspaceId: string; slack: SlackIntegrationDto }) {
  const channels = useSlackChannels(workspaceId);
  const update = useUpdateSlack(workspaceId);
  const unsync = useUnsyncSlackChannel(workspaceId);
  const disconnect = useDisconnectSlack(workspaceId);
  const [syncOpen, setSyncOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [unsyncing, setUnsyncing] = useState<string | null>(null);

  const onError = (e: unknown) => toast.error(getErrorMessage(e));

  const setNotificationChannel = (value: string) => {
    if (value === NO_CHANNEL) {
      update.mutate({ notificationChannelId: null, notificationChannelName: null }, { onError });
      return;
    }
    const ch = channels.data?.find((c) => c.id === value);
    update.mutate({ notificationChannelId: value, notificationChannelName: ch?.name ?? null }, { onError });
  };

  const toggleNotify = (type: NotificationType, on: boolean) => {
    const next = on ? [...new Set([...slack.notifyOn, type])] : slack.notifyOn.filter((t) => t !== type);
    update.mutate({ notifyOn: next }, { onError });
  };

  // The configured channel may not be in the bot-visible list (e.g. the bot was removed); keep it selectable.
  const channelOptions = channels.data ?? [];
  const hasConfigured = slack.notificationChannelId && channelOptions.some((c) => c.id === slack.notificationChannelId);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2.5">
        {slack.teamIconUrl ? (
          <img src={slack.teamIconUrl} alt="" width={28} height={28} className="size-7 rounded" />
        ) : (
          <span className="flex size-7 items-center justify-center rounded bg-card text-xs font-semibold">{slack.teamName.slice(0, 1)}</span>
        )}
        <div className="min-w-0 flex-1 text-[13px]">
          <p className="truncate font-medium">{slack.teamName}</p>
          <p className="truncate text-xs text-muted-foreground">Connected {formatRelative(slack.createdAt)}</p>
        </div>
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmDisconnect(true)}>
          <Unplug /> Disconnect
        </Button>
      </div>
      {slack.status === 'ERROR' && slack.lastError ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {slack.lastError}
        </p>
      ) : null}

      <section className="space-y-2" aria-labelledby="slack-notify-heading">
        <h4 id="slack-notify-heading" className="text-[13px] font-semibold">
          Notifications
        </h4>
        <div className="space-y-1.5">
          <label htmlFor="slack-notification-channel" className="text-xs text-muted-foreground">
            Post to channel
          </label>
          <Select value={slack.notificationChannelId ?? NO_CHANNEL} onValueChange={setNotificationChannel} disabled={update.isPending}>
            <SelectTrigger id="slack-notification-channel" className="max-w-sm">
              <SelectValue placeholder={channels.isPending ? 'Loading channels…' : 'Choose a channel'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CHANNEL}>Do not post to Slack</SelectItem>
              {slack.notificationChannelId && !hasConfigured ? (
                <SelectItem value={slack.notificationChannelId}>#{slack.notificationChannelName ?? slack.notificationChannelId}</SelectItem>
              ) : null}
              {channelOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  #{c.name}
                  {c.isPrivate ? ' (private)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {channels.isError ? (
            <p className="text-xs text-destructive" role="alert">
              Could not load Slack channels: {channels.error.message}
            </p>
          ) : null}
        </div>
        <fieldset className="mt-3" disabled={update.isPending || !slack.notificationChannelId}>
          <legend className="mb-1.5 text-xs text-muted-foreground">
            Notify on {slack.notificationChannelId ? '' : '(choose a channel first)'}
          </legend>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {NOTIFICATION_TYPES.map((t) => {
              const id = `notify-${t}`;
              return (
                <label key={t} htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
                  <Checkbox id={id} checked={slack.notifyOn.includes(t)} onCheckedChange={(v) => toggleNotify(t, v === true)} />
                  {NOTIFICATION_TYPE_LABELS[t]}
                </label>
              );
            })}
          </div>
        </fieldset>
      </section>

      <Separator />

      <section className="space-y-2" aria-labelledby="slack-sync-heading">
        <div className="flex items-center justify-between gap-2">
          <h4 id="slack-sync-heading" className="text-[13px] font-semibold">
            Synced channels
          </h4>
          <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)}>
            <Plus /> Sync channels
          </Button>
        </div>
        {slack.syncedChannels.length === 0 ? (
          <p className="text-xs text-muted-foreground">No Slack channels are mirrored yet.</p>
        ) : (
          <ul className="divide-y rounded-md border" aria-label="Synced channels">
            {slack.syncedChannels.map((c) => (
              <li key={c.slackChannelId} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                <Hash className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">{c.slackChannelName}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {c.messageCount} {c.messageCount === 1 ? 'message' : 'messages'}
                  {c.lastSyncedAt ? ` · synced ${formatRelative(c.lastSyncedAt)}` : ' · syncing…'}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  loading={unsyncing === c.slackChannelId && unsync.isPending}
                  onClick={() => {
                    setUnsyncing(c.slackChannelId);
                    unsync.mutate(c.slackChannelId, {
                      onSuccess: () => toast.success(`#${c.slackChannelName} unsynced`),
                      onError,
                      onSettled: () => setUnsyncing(null),
                    });
                  }}
                >
                  Unsync
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SyncChannelsDialog workspaceId={workspaceId} open={syncOpen} onOpenChange={setSyncOpen} />
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={`Disconnect ${slack.teamName}?`}
        description="Notifications stop posting to Slack and mirrored channels are archived. You can reconnect at any time."
        confirmLabel="Disconnect"
        destructive
        loading={disconnect.isPending}
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSuccess: () => {
              toast.success('Slack disconnected');
              setConfirmDisconnect(false);
            },
            onError,
          })
        }
      />
    </div>
  );
}

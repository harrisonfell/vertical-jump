import { useState } from 'react';
import { View } from 'react-native';
import { formatInteger } from '@vert/engine';
import { formatClock, serverConfigured } from '@/app/syncLineText';
import { useSnapshotActions, useSnapshotStatus, useSnapshotVersions } from '@/data/hooks';
import type { SnapshotMeta } from '@/data/sync/apiContract';
import { Button, Notice, Sheet, Text, space } from '@/ui';
import { shortCalendarDate } from './regenerate';
import { RowDivider, SettingRow, SettingSection } from './row';

/**
 * The database copy on the server: where this device stands, the two
 * decisions the sync never takes on its own, and the versions kept.
 *
 * The sync runs by itself; this section exists for the moments it will not
 * guess. A device that already holds data and has never adopted a copy asks
 * which to keep. A save that passed over another device's newer copy says so
 * and offers that copy back. The rest is one row that says when the last
 * save was and syncs on a tap.
 */

function whenLabel(at: string): string {
  const clock = formatClock(at);
  return clock === null ? shortCalendarDate(at) : `${shortCalendarDate(at)} ${clock}`;
}

function sizeLabel(bytes: number): string {
  return `${formatInteger(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

function originLabel(meta: SnapshotMeta): string {
  return meta.origin === 'device' ? 'Phone' : 'Web';
}

export function SyncSection() {
  const status = useSnapshotStatus();
  const actions = useSnapshotActions();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const versions = useSnapshotVersions(versionsOpen);

  if (!serverConfigured()) return null;

  const local = status.data;
  const busy =
    actions.syncNow.isPending ||
    actions.keepThisDevice.isPending ||
    actions.useServerCopy.isPending ||
    actions.restore.isPending;

  const value =
    local === undefined
      ? '…'
      : local.version === null
        ? 'Not synced yet'
        : `Version ${formatInteger(local.version)}`;
  const last = local?.pushedAt ?? local?.pulledAt ?? null;
  const caption =
    local?.lastError ??
    (last === null
      ? 'Saves after every change, and adopts a newer copy when the app opens.'
      : `Last synced ${whenLabel(last)}. Tap to sync now.`);

  const failure =
    actions.syncNow.error?.message ??
    actions.keepThisDevice.error?.message ??
    actions.useServerCopy.error?.message ??
    actions.restore.error?.message ??
    null;

  return (
    <SettingSection
      title="Sync"
      note="Your database is kept on the server, so your phone and your computer open on the same data."
      testID="settings-sync"
    >
      <SettingRow
        label="Server copy"
        value={value}
        caption={caption}
        numeric
        disabled={busy}
        onPress={() => actions.syncNow.mutate()}
        testID="settings-sync-now"
      />

      {local?.conflict == null ? null : (
        <View style={{ gap: space.md, paddingVertical: space.md }}>
          <Notice
            text="This device and the server both have data."
            detail={`The server holds version ${formatInteger(local.conflict)}. Keep what is on this device, or take the server's copy. Whichever you pass over stays restorable for a while.`}
            live
            testID="settings-sync-conflict"
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            <Button
              label="Keep this device's data"
              variant="primary"
              loading={actions.keepThisDevice.isPending}
              disabled={busy && !actions.keepThisDevice.isPending}
              onPress={() => actions.keepThisDevice.mutate()}
              testID="settings-sync-keep"
            />
            <Button
              label="Use the server's copy"
              loading={actions.useServerCopy.isPending}
              disabled={busy && !actions.useServerCopy.isPending}
              onPress={() => actions.useServerCopy.mutate()}
              testID="settings-sync-adopt"
            />
          </View>
        </View>
      )}

      {local?.replaced == null ? null : (
        <View style={{ gap: space.sm, paddingVertical: space.md }}>
          <Notice
            text={`Your save replaced version ${formatInteger(local.replaced)} from another device.`}
            detail="Restore it to go back to that copy. The copy you saved stays on the server too."
            actionLabel={`Restore version ${formatInteger(local.replaced)}`}
            onAction={() => actions.restore.mutate(local.replaced as number)}
            live
            testID="settings-sync-replaced"
          />
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              label="Keep mine"
              variant="quiet"
              onPress={() => actions.dismissReplaced.mutate()}
              testID="settings-sync-dismiss"
            />
          </View>
        </View>
      )}

      <RowDivider />
      <SettingRow
        label="Versions on the server"
        caption="The last saves, newest first. Restoring one makes it the newest again, on every device."
        chevron
        onPress={() => setVersionsOpen(true)}
        testID="settings-sync-versions"
      />

      {failure === null ? null : <Notice text={failure} live />}

      <Sheet
        visible={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        title="Versions on the server"
        subtitle="Restoring one replaces what is on this device and becomes the newest copy."
      >
        <View style={{ gap: space.xs }}>
          {versions.isPending ? (
            <Text variant="body" color="ink2">
              Loading…
            </Text>
          ) : null}
          {versions.isError ? <Notice text={versions.error.message} live /> : null}
          {(versions.data ?? []).map((meta, index) => (
            <View key={meta.version}>
              {index === 0 ? null : <RowDivider />}
              <SettingRow
                label={`Version ${formatInteger(meta.version)}`}
                value={whenLabel(meta.createdAt)}
                caption={`${originLabel(meta)} · ${sizeLabel(meta.byteLength)}${
                  local?.version === meta.version ? ' · on this device' : ''
                }`}
                numeric
                chevron={local?.version !== meta.version}
                disabled={busy || local?.version === meta.version}
                onPress={() => {
                  setVersionsOpen(false);
                  actions.restore.mutate(meta.version);
                }}
                testID={`settings-sync-version-${meta.version}`}
              />
            </View>
          ))}
          {versions.data !== undefined && versions.data.length === 0 ? (
            <Text variant="body" color="ink2">
              Nothing saved on the server yet.
            </Text>
          ) : null}
        </View>
      </Sheet>
    </SettingSection>
  );
}

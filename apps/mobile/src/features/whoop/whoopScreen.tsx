import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { AppHeader, formatClock } from '@/app';
import {
  useDeleteWhoopData,
  useSetWhoopConnection,
  useWhoopConnection,
} from '@/data';
import { Button, Chip, Notice, Screen, Sheet, Strip, Text, space } from '@/ui';
import { RowDivider, SettingRow, SettingSection, useSettingsFacts } from '../settings';
import {
  createWhoopClient,
  WhoopClientError,
  serverUrl,
  WHOOP_APP_REDIRECT,
  type FixtureWhoopState,
  type WhoopClient,
  type WhoopStatusResponse,
} from './client';
import {
  CANCELLED_LINE,
  DATA_BY_WHOOP,
  DELETE_DATA_CONFIRM_BODY,
  DELETE_DATA_CONFIRM_TITLE,
  DISCONNECT_CONFIRM_BODY,
  DISCONNECT_CONFIRM_TITLE,
  NO_SERVER_ACTION_CAPTION,
  REVOKED_MATCH_LINE,
  cooldownRemainingMs,
  errorLine,
  gateCriterionLine,
  headlineFor,
  syncLabel,
} from './copy';
import { STRENGTH_TRAINER_HINT } from './match';

/**
 * The Whoop screen: connect, backfill, sync, disconnect, and the gate counts.
 *
 * Every state in brief section 06 "Whoop settings and pairing" is here and
 * reachable. With no server configured, which is where v1 sits, the screen
 * says so plainly and the dev selector walks the same states against the
 * fixture client, so the copy is never written blind.
 */

const DEV_STATES: readonly FixtureWhoopState[] = [
  'disconnected',
  'connecting',
  'importing',
  'connected',
  'revoked',
  'api_down',
  'rate_limited',
];

const EMPTY_STATUS: WhoopStatusResponse = {
  status: 'disconnected',
  whoopUserId: null,
  connectedAt: null,
  lastSyncAt: null,
  backfillDaysDone: 0,
  backfillDaysTotal: 0,
  lastError: null,
  nextRetryAt: null,
};

function stripState(status: WhoopStatusResponse['status']): 'connected' | 'notConnected' | 'importing' | 'revoked' {
  if (status === 'connected') return 'connected';
  if (status === 'importing' || status === 'connecting') return 'importing';
  if (status === 'revoked') return 'revoked';
  return 'notConnected';
}

export function WhoopScreen() {
  const configured = serverUrl() !== null;
  const connectionQuery = useWhoopConnection();
  const setConnection = useSetWhoopConnection();
  const deleteData = useDeleteWhoopData();
  const facts = useSettingsFacts(null, []);

  const [devState, setDevState] = useState<FixtureWhoopState>('connected');
  const [status, setStatus] = useState<WhoopStatusResponse>(EMPTY_STATUS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lastSyncUsedAt, setLastSyncUsedAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const client = useMemo<WhoopClient>(() => createWhoopClient({ state: devState }), [devState]);

  useEffect(() => {
    let cancelled = false;
    void client
      .status()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(EMPTY_STATUS);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // The cooldown ticks only while it is running, so an idle screen has no timer.
  useEffect(() => {
    if (lastSyncUsedAt === null) return;
    const tick = (): void => setCooldown(cooldownRemainingMs(lastSyncUsedAt, Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastSyncUsedAt]);

  const run = useCallback(
    async (action: () => Promise<WhoopStatusResponse>): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        setStatus(await action());
      } catch (caught) {
        setError(
          caught instanceof WhoopClientError
            ? errorLine(caught.kind, caught.retryAt)
            : 'Something went wrong reaching the sync server. Try again.',
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onConnect = useCallback(() => {
    setNote(null);
    void run(async () => {
      // The system authentication session, opened by the client so the device
      // secret never rides the URL: it spends a single-use ticket instead.
      const result = await client.connect(WHOOP_APP_REDIRECT);
      if (result.outcome === 'cancelled') {
        setNote(CANCELLED_LINE);
        return result.status;
      }
      if (result.outcome === 'redirected') return result.status;
      // The server moves connecting to importing on its own; the fixture needs
      // the first chunk asked for, so the state after Connect is the same one.
      return client.sync();
    });
  }, [client, run]);

  const onSync = useCallback(() => {
    setLastSyncUsedAt(Date.now());
    void run(() => client.sync());
  }, [client, run]);

  const stored = connectionQuery.data ?? null;
  const daysImported = Math.max(status.backfillDaysDone, stored?.backfillDaysDone ?? 0);
  const syncedClock = status.lastSyncAt === null ? null : formatClock(status.lastSyncAt);
  const headline = headlineFor(status, configured);

  return (
    <Screen
      header={<AppHeader title="Whoop" showSettings={false} />}
      gap={space.xxl}
      testID="whoop-screen"
    >
      <Strip
        state={stripState(status.status)}
        {...(syncedClock === null ? null : { syncedAt: syncedClock })}
        importedDays={status.backfillDaysDone}
        importTotalDays={status.backfillDaysTotal}
      />

      <SettingSection title="Connection" testID="whoop-connection">
        <SettingRow label="Status" caption={headline} testID="whoop-status" />
        {daysImported > 0 ? (
          <>
            <RowDivider />
            <SettingRow
              label="Days imported"
              value={`${daysImported} of ${status.backfillDaysTotal || 90}`}
              caption={`Chunked and resumable. ${DATA_BY_WHOOP}`}
              numeric
            />
          </>
        ) : null}

        {error === null ? null : <Notice text={error} live />}
        {note === null ? null : <Notice text={note} live />}

        {status.status === 'revoked' ? <Notice text={REVOKED_MATCH_LINE} /> : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.md }}>
          {status.status === 'connected' || status.status === 'importing' ? (
            <Button
              label={syncLabel(cooldown)}
              variant="primary"
              disabled={!configured || busy || cooldown > 0}
              loading={busy}
              onPress={onSync}
              testID="whoop-sync"
            />
          ) : (
            <Button
              label={status.status === 'revoked' ? 'Reconnect' : 'Connect Whoop'}
              variant="primary"
              disabled={!configured || busy}
              loading={busy}
              onPress={onConnect}
              testID="whoop-connect"
            />
          )}

          {status.status === 'connecting' ? (
            <Button
              label="Cancel"
              variant="secondary"
              disabled={!configured}
              onPress={() => {
                setNote(CANCELLED_LINE);
                void run(() => client.disconnect());
              }}
              testID="whoop-cancel"
            />
          ) : null}

          {status.status === 'connected' || status.status === 'importing' ? (
            <Button
              label="Disconnect"
              variant="secondary"
              disabled={!configured}
              onPress={() => setDisconnectOpen(true)}
              testID="whoop-disconnect"
            />
          ) : null}
        </View>

        {/* An enabled Connect under a line that says there is no server to
            connect to is the app promising what it cannot do (defect D-28). */}
        {configured ? null : (
          <Text variant="caption" color="ink3" style={{ paddingTop: space.sm }}>
            {NO_SERVER_ACTION_CAPTION}
          </Text>
        )}
      </SettingSection>

      <SettingSection
        title="Strain logging"
        note={`${STRENGTH_TRAINER_HINT}. Whoop rarely auto-detects a short lifting session.`}
        testID="whoop-strain"
      >
        <SettingRow
          label="Matching"
          caption="A workout matches a session when it overlaps the session's own window, half an hour either side."
        />
      </SettingSection>

      <SettingSection title="Gate" note="What autoregulation is waiting on." testID="whoop-gate">
        {facts.gate.criteria.map((criterion, index) => (
          <View key={criterion.id}>
            {index === 0 ? null : <RowDivider />}
            <SettingRow
              label={criterion.met ? 'Met' : 'Not yet'}
              value={gateCriterionLine(criterion)}
              numeric
            />
          </View>
        ))}
      </SettingSection>

      <SettingSection title="Whoop data on this phone" testID="whoop-data">
        <SettingRow
          label="Delete Whoop data"
          caption="Removes every mirror. Your sessions and jump tests are untouched."
          chevron
          onPress={() => setDeleteOpen(true)}
          testID="whoop-delete"
        />
      </SettingSection>

      {configured ? null : (
        <SettingSection
          title="Dev states"
          note="No server is configured, so this walks the fixture client through every state."
          testID="whoop-dev"
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingVertical: space.md }}>
            {DEV_STATES.map((state) => (
              <Chip
                key={state}
                label={state.replace(/_/g, ' ')}
                role="radio"
                selected={devState === state}
                onPress={() => setDevState(state)}
              />
            ))}
          </View>
          {Platform.OS === 'web' ? (
            <Text variant="caption" color="ink3">
              These states are local to this screen and write nothing.
            </Text>
          ) : null}
        </SettingSection>
      )}

      <Sheet
        visible={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title={DISCONNECT_CONFIRM_TITLE}
        closeLabel="Stay connected"
        actions={
          <Button
            label="Disconnect Whoop"
            variant="destructive"
            fullWidth
            onPress={() => {
              setDisconnectOpen(false);
              void run(() => client.disconnect());
              setConnection.mutate({ status: 'disconnected' });
            }}
            testID="whoop-disconnect-confirm"
          />
        }
      >
        <Text variant="body" color="ink2">
          {DISCONNECT_CONFIRM_BODY}
        </Text>
      </Sheet>

      <Sheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={DELETE_DATA_CONFIRM_TITLE}
        closeLabel="Keep the data"
        actions={
          <Button
            label="Delete Whoop data"
            variant="destructive"
            fullWidth
            loading={deleteData.isPending}
            onPress={() => {
              setDeleteOpen(false);
              deleteData.mutate();
            }}
            testID="whoop-delete-confirm"
          />
        }
      >
        <Text variant="body" color="ink2">
          {DELETE_DATA_CONFIRM_BODY}
        </Text>
      </Sheet>
    </Screen>
  );
}

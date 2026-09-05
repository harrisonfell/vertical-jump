import { formatClock } from '@/app';
import { RowDivider, SettingRow, SettingSection } from './row';

/**
 * The two rows that go somewhere: Whoop and Import.
 *
 * Each carries its own current state so the athlete never has to open a screen
 * to find out nothing happened there.
 */

export interface LinkSectionProps {
  readonly whoopStatus: 'disconnected' | 'connecting' | 'connected' | 'revoked' | 'error';
  readonly lastSyncAt: string | null;
  readonly onWhoop: () => void;
  readonly onImport: () => void;
}

const WHOOP_VALUES: Readonly<Record<LinkSectionProps['whoopStatus'], string>> = {
  disconnected: 'Not connected',
  connecting: 'Connecting',
  connected: 'Connected',
  revoked: 'Disconnected',
  error: 'Needs attention',
};

export function LinkSection({ whoopStatus, lastSyncAt, onWhoop, onImport }: LinkSectionProps) {
  const clock = lastSyncAt === null ? null : formatClock(lastSyncAt);

  return (
    <SettingSection title="Devices and data" testID="settings-links">
      <SettingRow
        label="Whoop"
        value={WHOOP_VALUES[whoopStatus]}
        caption={
          whoopStatus === 'connected' && clock !== null
            ? `Last sync ${clock} · Data by WHOOP`
            : 'Recovery, sleep and strain beside your own numbers.'
        }
        chevron
        onPress={onWhoop}
        testID="settings-whoop-link"
      />
      <RowDivider />
      <SettingRow
        label="Import"
        caption="Bring in an OVR Connect export of your jump and velocity history."
        chevron
        onPress={onImport}
        testID="settings-import-link"
      />
    </SettingSection>
  );
}

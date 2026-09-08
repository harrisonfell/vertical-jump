import { useState } from 'react';
import { View } from 'react-native';
import { Button, Field, Notice, Sheet, Text, space } from '@/ui';
import { RowDivider, SettingRow, SettingSection } from './row';
import { BACKUP_REMINDER, type ExportFile } from './exportData';
import {
  DELETE_BODY,
  DELETE_CONFIRM_WORD,
  DELETE_FIELD_LABEL,
  DELETE_MISMATCH_ERROR,
  DELETE_TITLE,
  SIGN_OUT_BODY,
  SIGN_OUT_TITLE,
  deleteConfirmMatches,
} from './deleteAll';

/**
 * Export, delete, tips, sign out, about.
 *
 * The export is a list of real files with their row counts, because "Export"
 * with no numbers beside it tells the athlete nothing about what they are
 * carrying away. Delete is the only irreversible control in the app, so it
 * asks for the word to be typed and says what goes.
 */

export interface DataSectionProps {
  readonly files: readonly ExportFile[];
  readonly onSave: (file: ExportFile) => void;
  readonly savingName: string | null;
  readonly saveError: string | null;
  readonly timezone: string;
  readonly rolloverHour: number;
  readonly onEditRollover: (hour: number) => void;
  readonly onResetTips: () => void;
  readonly tipsReset: boolean;
  /** Fills setup with the owner's saved answers. Nothing is written yet. */
  readonly onUseSavedProfile: () => void;
  readonly onDeleteAll: () => void;
  readonly deleting: boolean;
  readonly onSignOut: () => void;
  readonly onPrivacy: () => void;
  readonly appVersion: string;
}

const ROLLOVER_CHOICES = [0, 2, 3, 4, 5] as const;

/** "3 AM" for the rollover hour, which is a clock time, not a training number. */
export function rolloverLabel(hour: number): string {
  if (hour === 0) return 'Midnight';
  if (hour === 12) return 'Noon';
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function DataSection({
  files,
  onSave,
  savingName,
  saveError,
  timezone,
  rolloverHour,
  onEditRollover,
  onResetTips,
  tipsReset,
  onUseSavedProfile,
  onDeleteAll,
  deleting,
  onSignOut,
  onPrivacy,
  appVersion,
}: DataSectionProps) {
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const matches = deleteConfirmMatches(typed);
  const showMismatch = typed.trim() !== '' && !matches;

  return (
    <>
      <SettingSection title="Your day" testID="settings-day">
        <SettingRow label="Timezone" value={timezone} caption="Read from this device." />
        <RowDivider />
        <SettingRow
          label="Day rolls over at"
          value={rolloverLabel(rolloverHour)}
          caption="A session logged before this hour still counts as yesterday."
          chevron
          onPress={() => setRolloverOpen(true)}
          testID="settings-rollover"
        />
      </SettingSection>

      <SettingSection title="Export" note={BACKUP_REMINDER} testID="settings-export">
        {files.map((file, index) => (
          <View key={file.name}>
            {index === 0 ? null : <RowDivider />}
            <SettingRow
              label={file.label}
              value={`${file.rowCount} ${file.rowCount === 1 ? 'row' : 'rows'}`}
              caption={file.name}
              numeric
              disabled={savingName !== null}
              onPress={() => onSave(file)}
              testID={`settings-export-${file.mime === 'application/json' ? 'json' : index}`}
            />
          </View>
        ))}
        {saveError === null ? null : <Notice text={saveError} tone="danger" live />}
      </SettingSection>

      <SettingSection title="This device" testID="settings-device">
        <SettingRow
          label="Session tips"
          value={tipsReset ? 'Will show again' : 'Dismissed'}
          caption="The coach marks that explain the runner on a first session."
          onPress={onResetTips}
          testID="settings-reset-tips"
        />
        <RowDivider />
        <SettingRow
          label="Use my saved profile"
          caption="Fills setup with your saved answers. Nothing is saved until you save it."
          chevron
          onPress={onUseSavedProfile}
          testID="settings-use-saved-profile"
        />
        <RowDivider />
        <SettingRow
          label="Sign out"
          caption="Forgets the pairing with the web review. Your data stays here."
          chevron
          onPress={() => setSignOutOpen(true)}
          testID="settings-sign-out"
        />
        <RowDivider />
        <SettingRow
          label="Delete all data"
          caption="Everything on this phone, permanently."
          chevron
          onPress={() => {
            setTyped('');
            setDeleteOpen(true);
          }}
          testID="settings-delete-all"
        />
      </SettingSection>

      <SettingSection title="About" testID="settings-about">
        <SettingRow label="Version" value={appVersion} numeric />
        <RowDivider />
        <SettingRow label="Privacy" chevron onPress={onPrivacy} testID="settings-privacy" />
        <RowDivider />
        <SettingRow label="Recovery, sleep and strain" caption="Data by WHOOP" />
      </SettingSection>

      <Sheet
        visible={rolloverOpen}
        onClose={() => setRolloverOpen(false)}
        title="Day rolls over at"
        subtitle="Pick the hour a late session still counts as the day before."
      >
        <View style={{ gap: space.sm }}>
          {ROLLOVER_CHOICES.map((hour) => (
            <Button
              key={hour}
              label={rolloverLabel(hour)}
              variant={hour === rolloverHour ? 'primary' : 'secondary'}
              fullWidth
              onPress={() => {
                onEditRollover(hour);
                setRolloverOpen(false);
              }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet
        visible={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title={SIGN_OUT_TITLE}
        closeLabel="Stay signed in"
        actions={
          <Button
            label="Sign out"
            variant="destructive"
            fullWidth
            onPress={() => {
              setSignOutOpen(false);
              onSignOut();
            }}
            testID="settings-sign-out-confirm"
          />
        }
      >
        <Text variant="body" color="ink2">
          {SIGN_OUT_BODY}
        </Text>
      </Sheet>

      <Sheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={DELETE_TITLE}
        closeLabel="Keep my data"
        actions={
          <Button
            label="Delete all data"
            variant="destructive"
            fullWidth
            disabled={!matches || deleting}
            loading={deleting}
            onPress={onDeleteAll}
            testID="settings-delete-confirm"
          />
        }
      >
        <View style={{ gap: space.lg }}>
          <Text variant="body" color="ink2">
            {DELETE_BODY}
          </Text>
          <Field
            label={DELETE_FIELD_LABEL}
            value={typed}
            placeholder={DELETE_CONFIRM_WORD}
            autoFocus
            {...(showMismatch ? { error: DELETE_MISMATCH_ERROR } : null)}
            onChangeText={setTyped}
            testID="settings-delete-field"
          />
        </View>
      </Sheet>
    </>
  );
}

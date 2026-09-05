import { View } from 'react-native';
import { Chip, Text, space } from '@/ui';
import { RowDivider, SettingRow } from '../settings';
import type { CanonicalField } from './headers';

/**
 * The manual mapping step.
 *
 * It appears only when the automatic mapper could not decide, and it asks the
 * smallest possible question: for each field the import needs, which column
 * holds it. Nothing is committed while this is open, so a wrong pick costs a
 * tap rather than a bad row.
 */

/** The fields worth asking about, with the words the athlete reads. */
const ASKABLE: readonly { readonly field: CanonicalField; readonly label: string }[] = [
  { field: 'date', label: 'Date' },
  { field: 'heightIn', label: 'Jump height, inches' },
  { field: 'heightCm', label: 'Jump height, centimetres' },
  { field: 'contactTimeMs', label: 'Contact time, ms' },
  { field: 'rsi', label: 'RSI' },
  { field: 'exercise', label: 'Exercise' },
  { field: 'set', label: 'Set' },
  { field: 'rep', label: 'Rep' },
  { field: 'loadLb', label: 'Load, pounds' },
  { field: 'meanVelocity', label: 'Mean velocity' },
];

export interface MappingStepProps {
  readonly headers: readonly string[];
  readonly mapping: Partial<Record<CanonicalField, string>>;
  readonly onChange: (next: Partial<Record<CanonicalField, string>>) => void;
}

export function MappingStep({ headers, mapping, onChange }: MappingStepProps) {
  const columns = headers.filter((header) => header !== '');

  return (
    <View style={{ gap: space.sm, paddingVertical: space.md }} testID="import-mapping">
      <Text variant="body">Tell the import which column holds each value.</Text>
      {ASKABLE.map((entry, index) => (
        <View key={entry.field}>
          {index === 0 ? null : <RowDivider />}
          <SettingRow label={entry.label} value={mapping[entry.field] ?? 'Not mapped'}>
            <View
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.sm }}
            >
              {columns.map((header) => (
                <Chip
                  key={`${entry.field}-${header}`}
                  label={header}
                  role="radio"
                  selected={mapping[entry.field] === header}
                  onPress={() => {
                    const next = { ...mapping };
                    if (next[entry.field] === header) delete next[entry.field];
                    else next[entry.field] = header;
                    onChange(next);
                  }}
                />
              ))}
            </View>
          </SettingRow>
        </View>
      ))}
    </View>
  );
}

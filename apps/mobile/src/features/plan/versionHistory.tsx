import { View } from 'react-native';
import type { ProgramVersion } from '@/data/types';
import { Disclosure, Hairline, Text, space } from '@/ui';
import { versionNote, versionSpan } from './header';
import { localDay } from '@/lib/localDay';

/**
 * Version history. A regeneration makes a new version rather than editing the
 * old one, so the weeks already trained keep the layout they were trained
 * under. Earlier versions are read-only here: their logs are still theirs.
 */

export interface VersionHistoryProps {
  /** Newest first. */
  readonly versions: readonly ProgramVersion[];
  readonly timezone: string;
  readonly testID?: string;
}

export function VersionHistory({ versions, timezone, testID }: VersionHistoryProps) {
  if (versions.length < 2) return null;

  return (
    <Disclosure
      title="Version history"
      summary={`${versions.length} versions`}
      testID={testID}
    >
      {versions.map((version, index) => {
        const span = versionSpan(version.weekLayout);
        return (
          <View key={version.id}>
            <Hairline />
            <View style={{ paddingVertical: space.sm, gap: 2 }}>
              <Text variant="body" color="ink" numeric>
                {versionNote({
                  version: version.version,
                  since: localDay(version.createdAt, timezone),
                  reason: version.reason,
                })}
              </Text>
              {span === null ? null : (
                <Text variant="caption" color="ink2" numeric>
                  {span}
                </Text>
              )}
              {index === 0 ? null : (
                <Text variant="caption" color="ink3">
                  Read-only. Its logged sessions stay on this version.
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </Disclosure>
  );
}

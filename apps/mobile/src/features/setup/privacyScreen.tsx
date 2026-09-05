import { View } from 'react-native';
import { Hairline, Screen, Text, space } from '@/ui';
import { SETUP_COPY } from './copy';

/**
 * The privacy page. Required by Whoop's API terms even for one athlete, and
 * the honest place to say where the data actually is. Static: it never reads
 * the database, so it renders before the app has one.
 */

interface SectionProps {
  readonly title: string;
  readonly lines: readonly string[];
}

function Section({ title, lines }: SectionProps) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" color="ink2">
        {title}
      </Text>
      {lines.map((line) => (
        <Text key={line} variant="body" color="ink" style={{ maxWidth: 640 }}>
          {line}
        </Text>
      ))}
      <Hairline />
    </View>
  );
}

export function PrivacyScreen() {
  return (
    <Screen testID="privacy">
      <View style={{ gap: space.xl }}>
        <Text variant="headline" color="ink">
          {SETUP_COPY.privacyTitle}
        </Text>

        <Section
          title="What is stored, and where"
          lines={[
            'Your answers, your program, every set you log and every jump test live in a database on this device. Nothing leaves it unless a review server is set up.',
            'With a review server, the same rows are copied to it so the training can be reviewed on a laptop. The server is a single-owner deployment: no accounts, no other users, no analytics.',
            'This app collects no advertising identifiers and contains no third-party trackers.',
          ]}
        />

        <Section
          title="Whoop"
          lines={[
            'Whoop is optional and off until you connect it. When you connect it, the review server holds the Whoop tokens; this app never holds one.',
            'Recovery, sleep, cycles and workouts are stored in full, because you have given express permission as the data owner, so the charts can show 90 days beside your own numbers.',
            'Disconnecting stops the sync. Deleting Whoop data removes those rows here and on the server.',
            SETUP_COPY.stepThreeAttribution,
          ]}
        />

        <Section
          title="Export and delete"
          lines={[
            'Settings exports everything as CSV and JSON at any time. The export is the whole record, not a summary.',
            'Settings also deletes everything, on this device and on the review server, behind a typed confirmation. Deleted data is not recoverable.',
          ]}
        />

        <Section
          title="Support"
          lines={[SETUP_COPY.privacySupport]}
        />
      </View>
    </Screen>
  );
}

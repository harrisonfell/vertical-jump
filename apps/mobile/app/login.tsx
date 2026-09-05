import { PairScreen } from '@/features/setup';

/** The web signs in with the single-owner passphrase. There are no accounts. */
export default function LoginRoute() {
  return <PairScreen mode="login" />;
}

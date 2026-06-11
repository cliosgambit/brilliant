import CustomGamePage from './CustomGamePage';

/** Board + import PGN only — no brilliance cascade panel. */
export default function TestPage() {
  return <CustomGamePage boardId="TestBoard" inputSource="test" hideBrilliancePanel />;
}

import { useCallback, useEffect, useRef, useState } from 'react';

import { runNoticeChoice, type NoticeChoice, type NoticeOutcome } from '@/lib/leaderboardView';
import { markLeaderboardNoticeSeen, setLeaderboardVisibility } from '@/services/leaderboard';

export interface LeaderboardNoticeState {
  /** The button whose call is running, or null. Both buttons are disabled while it is set. */
  busy: NoticeChoice | null;
  /** The last choice failed: the notice shows `notice.error` and the buttons are back. */
  failed: boolean;
  /** Runs one choice (lib/leaderboardView.ts `runNoticeChoice`: hide first, then mark). Ignored while a call is running. Never throws. */
  choose: (choice: NoticeChoice) => Promise<void>;
  /** Clears the failure line (the sheet is opened again). */
  reset: () => void;
}

/** Story 30.6 (MA-19, FR-227): the one shared first-open notice flow, used by the /leaderboard route (in place) and by Profile (in a full-screen modal).
 * `onResult` is told the outcome so the caller can update its own copy of the settings: after [Appear as Anonymous] the member is hidden even when the
 * second call failed (`hiddenWritten`). Leaving the notice never calls anything: nothing here runs unless a button is pressed. */
export function useLeaderboardNotice(onResult: (choice: NoticeChoice, outcome: NoticeOutcome) => void | Promise<void>): LeaderboardNoticeState {
  const [busy, setBusy] = useState<NoticeChoice | null>(null);
  const [failed, setFailed] = useState(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const choose = useCallback(async (choice: NoticeChoice) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(choice);
    setFailed(false);
    try {
      const outcome = await runNoticeChoice(choice, { setVisibility: setLeaderboardVisibility, markSeen: markLeaderboardNoticeSeen });
      if (mountedRef.current) setFailed(!outcome.ok);
      await onResultRef.current(choice, outcome);
    } catch {
      if (mountedRef.current) setFailed(true);
    } finally {
      runningRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  }, []);

  const reset = useCallback(() => setFailed(false), []);

  return { busy, failed, choose, reset };
}

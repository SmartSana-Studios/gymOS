import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isShareFileName,
  isShareKnownUnavailable,
  markShareUnavailable,
  resetShareAvailability,
  runShareFlow,
  shareFileName,
  shareMessageKey,
  shareRetryKey,
  shareStatusAfter,
  visibleShareStatus,
  type ShareFlowDeps,
} from './shareFlow';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// The libraries sit behind injected functions: every step below can be made to fail, and the log says exactly what was called, in order.
function fakes(over: Partial<ShareFlowDeps> = {}) {
  const log: string[] = [];
  const deps: ShareFlowDeps = {
    isAvailable: async () => {
      log.push('isAvailable');
      return true;
    },
    logoReady: async () => {
      log.push('logoReady');
    },
    capture: async () => {
      log.push('capture');
      return 'BASE64PNG';
    },
    writeFile: async (base64) => {
      log.push(`writeFile:${base64}`);
      return 'file:///cache/gymos-share-1.png';
    },
    cleanLeftovers: async () => {
      log.push('cleanLeftovers');
    },
    deleteFile: async (uri) => {
      log.push(`deleteFile:${uri}`);
    },
    share: async (uri) => {
      log.push(`share:${uri}`);
    },
    ...over,
  };
  return { deps, log };
}

beforeEach(() => resetShareAvailability());
afterEach(() => vi.unstubAllGlobals());

describe('the result states', () => {
  it('shared or closed with no target (the OS reports no difference): done, the file is deleted after the sheet closes, in that order', async () => {
    const { deps, log } = fakes();
    expect(await runShareFlow(deps)).toEqual({ kind: 'done' });
    expect(log).toEqual([
      'isAvailable',
      'cleanLeftovers',
      'logoReady',
      'capture',
      'writeFile:BASE64PNG',
      'share:file:///cache/gymos-share-1.png',
      'deleteFile:file:///cache/gymos-share-1.png',
    ]);
  });

  it('the capture throws (out of memory, a view that is gone): error, nothing was written, the sweep runs, the share sheet never opens', async () => {
    const { deps, log } = fakes({
      capture: async () => {
        log.push('capture');
        throw new Error('out of memory');
      },
    });
    expect(await runShareFlow(deps)).toEqual({ kind: 'error' });
    expect(log.filter((l) => l.startsWith('share:') || l.startsWith('writeFile'))).toEqual([]);
    expect(log.filter((l) => l === 'cleanLeftovers')).toHaveLength(2);
  });

  it('the cache is not writable: error, the share sheet never opens, and the sweep removes a partial file', async () => {
    const { deps, log } = fakes({
      writeFile: async () => {
        log.push('writeFile');
        throw new Error('ENOSPC');
      },
    });
    expect(await runShareFlow(deps)).toEqual({ kind: 'error' });
    expect(log.some((l) => l.startsWith('share:'))).toBe(false);
    expect(log.filter((l) => l === 'cleanLeftovers')).toHaveLength(2);
  });

  it('the platform refuses the hand-off: error (never a permission prompt), and the written file is deleted', async () => {
    const { deps, log } = fakes({
      share: async (uri) => {
        log.push(`share:${uri}`);
        throw new Error('EACCES');
      },
    });
    expect(await runShareFlow(deps)).toEqual({ kind: 'error' });
    expect(log.at(-1)).toBe('deleteFile:file:///cache/gymos-share-1.png');
  });

  it('sharing is not available: unavailable, and nothing is captured, written or shared', async () => {
    const { deps, log } = fakes({
      isAvailable: async () => {
        log.push('isAvailable');
        return false;
      },
    });
    expect(await runShareFlow(deps)).toEqual({ kind: 'unavailable' });
    expect(log).toEqual(['isAvailable']);
  });

  it('a rejected availability check counts as unavailable', async () => {
    const { deps } = fakes({
      isAvailable: async () => {
        throw new Error('native module missing');
      },
    });
    expect(await runShareFlow(deps)).toEqual({ kind: 'unavailable' });
  });

  it('a failing delete after a successful share does not turn it into an error', async () => {
    const { deps } = fakes({
      deleteFile: async () => {
        throw new Error('already gone');
      },
    });
    expect(await runShareFlow(deps)).toEqual({ kind: 'done' });
  });

  it('a failing sweep never blocks the share', async () => {
    const { deps } = fakes({
      cleanLeftovers: async () => {
        throw new Error('cache unreadable');
      },
    });
    expect(await runShareFlow(deps)).toEqual({ kind: 'done' });
  });

  it('never throws, whatever fails', async () => {
    const boom = async () => {
      throw new Error('x');
    };
    const { deps } = fakes({ isAvailable: boom, logoReady: boom, capture: boom, writeFile: boom, cleanLeftovers: boom, deleteFile: boom, share: boom });
    await expect(runShareFlow(deps)).resolves.toBeTruthy();
  });
});

describe('leftovers', () => {
  it('older share images in the cache are removed BEFORE the new image is made', async () => {
    const { deps, log } = fakes();
    await runShareFlow(deps);
    expect(log.indexOf('cleanLeftovers')).toBeGreaterThan(-1);
    expect(log.indexOf('cleanLeftovers')).toBeLessThan(log.indexOf('capture'));
  });

  it('only files the app made are swept (the name prefix)', () => {
    expect(isShareFileName(shareFileName(1_700_000_000_000))).toBe(true);
    expect(shareFileName(1_700_000_000_000.9)).toBe('gymos-share-1700000000000.png');
    for (const other of ['photo.png', 'gymos-share-1.jpg', 'sentry-1.png', 'share.png']) expect(isShareFileName(other)).toBe(false);
  });
});

describe('offline, network and permissions', () => {
  it('works offline: a logo that cannot be loaded (the network call fails) is left out and the image is still built and shared', async () => {
    const { deps, log } = fakes({
      logoReady: async () => {
        log.push('logoReady');
        throw new Error('Network request failed');
      },
    });
    expect(await runShareFlow(deps)).toEqual({ kind: 'done' });
    expect(log).toContain('capture');
    expect(log.some((l) => l.startsWith('share:'))).toBe(true);
  });

  it('makes no network call of its own: fetch is never touched and XMLHttpRequest is never opened', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network is down');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { deps } = fakes();
    expect(await runShareFlow(deps)).toEqual({ kind: 'done' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('touches only the seven declared dependencies, none of them a permission request', async () => {
    const touched = new Set<string>();
    const { deps } = fakes();
    const spy = new Proxy(deps, {
      get(target, prop) {
        touched.add(String(prop));
        return Reflect.get(target, prop);
      },
    });
    await runShareFlow(spy);
    expect([...touched].sort()).toEqual(['capture', 'cleanLeftovers', 'deleteFile', 'isAvailable', 'logoReady', 'share', 'writeFile']);
    expect([...touched].some((name) => /permission|request|mediaLibrary|storage/i.test(name))).toBe(false);
  });

  it('no source file of the share path asks for a photo-library or storage permission, saves to the gallery, or calls a server', () => {
    for (const path of ['lib/shareFlow.ts', 'lib/shareImage.ts', 'hooks/use-share-image.ts', 'components/ShareImageComposition.tsx', 'components/ShareImageHost.tsx']) {
      expect(read(path), path).not.toMatch(
        /requestPermission|requestMediaLibrary|requestCameraRoll|getPermission|MediaLibrary|expo-media-library|saveToLibrary|saveToCameraRoll|CameraRoll|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|supabase|fetch\(|analytics|posthog|Sentry/i,
      );
    }
  });

  it('the app declares no media-library or storage-permission package, and pins the share libraries (no floating range)', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((name) => /media-library|cameraroll|permissions/i.test(name))).toEqual([]);
    expect(pkg.dependencies['react-native-view-shot']).toBe('5.1.0');
    expect(pkg.dependencies['expo-sharing']).toMatch(/^~57\.\d+\.\d+$/);
  });

  it('the hook captures as base64 into the cache directory, 1080 by 1920 from the pixel ratio, and hands the file to the OS share sheet', () => {
    const hook = read('hooks/use-share-image.ts');
    expect(hook).toContain("result: 'base64'");
    expect(hook).toContain('captureSize(PixelRatio.get())');
    expect(hook).toContain('new File(Paths.cache, shareFileName(Date.now()))');
    expect(hook).toContain('Sharing.shareAsync(uri, buildShareOptions(dialogTitle, anchor))');
    expect(hook).toContain('Sharing.isAvailableAsync()');
    // The logo wait is the tested gate (lib/logoGate.ts), re-armed whenever the logo URL changes, and a failed logo is dropped for that URL only.
    expect(hook).toContain('createLogoGate(LOGO_WAIT_MS)');
    expect(hook).toContain('logoGate.reset(logoKey);');
    expect(hook).toContain('logoReady: () => logoGate.ready()');
    const composition = read('components/ShareImageComposition.tsx');
    expect(composition).toContain('const dropped = currentLogo !== null && failedUri === currentLogo;');
    // An unavailable answer is remembered for the next view, and a view reads it once, when it mounts (so the message stays while it is on screen).
    expect(hook).toContain("if (outcome.kind === 'unavailable') markShareUnavailable();");
    expect(hook).toContain('useState(() => !isShareKnownUnavailable())');
    // iPad: the sheet is anchored to the button, measured on iOS only.
    expect(hook).toContain("Platform.OS !== 'ios'");
  });
});

describe('what the screens show', () => {
  it('done shows nothing; error shows the message with a retry; unavailable shows its message with no retry', () => {
    expect(shareStatusAfter({ kind: 'done' })).toBe('idle');
    expect(shareMessageKey(shareStatusAfter({ kind: 'done' }))).toBeNull();
    expect(shareMessageKey(shareStatusAfter({ kind: 'error' }))).toBe('engage.share.error');
    expect(shareRetryKey(shareStatusAfter({ kind: 'error' }))).toBe('engage.share.retry');
    expect(shareMessageKey(shareStatusAfter({ kind: 'unavailable' }))).toBe('engage.share.unavailable');
    expect(shareRetryKey(shareStatusAfter({ kind: 'unavailable' }))).toBeNull();
    expect(shareMessageKey('sharing')).toBeNull();
  });

  it.each([
    ['the same subject', { key: 'badge:visits_30', status: 'error' }, 'badge:visits_30', 'error'],
    ['the same subject, unavailable', { key: 'badge:visits_30', status: 'unavailable' }, 'badge:visits_30', 'unavailable'],
    ['the next badge', { key: 'badge:visits_30', status: 'error' }, 'badge:visits_100', 'idle'],
    ['a milestone after a badge', { key: 'badge:visits_30', status: 'error' }, 'milestone:30', 'idle'],
    ['the sheet closed (no subject)', { key: 'badge:visits_30', status: 'error' }, null, 'idle'],
    ['nothing recorded yet', null, 'badge:visits_30', 'idle'],
    ['a run for no subject', { key: null, status: 'error' }, null, 'idle'],
  ] as const)('a result belongs to its subject: %s', (_name, entry, current, expected) => {
    expect(visibleShareStatus(entry as { key: string | null; status: 'error' | 'unavailable' } | null, current)).toBe(expected);
  });

  it('the hook keeps a result with the subject it was made for and shows it only there; the screens hand it the subject through the input', () => {
    const hook = read('hooks/use-share-image.ts');
    expect(hook).toContain('const status = visibleShareStatus(entry, subjectKey);');
    expect(hook).toContain("setEntry({ key: startKey, status: shareStatusAfter(outcome) });");
    expect(hook).toContain("setEntry({ key: startKey, status: 'error' });");
    expect(hook).not.toMatch(/\bsetStatus\b/);
  });

  it('the composition builder applies the allow-list copy itself, and the share context clears and catches', () => {
    expect(read('lib/shareImage.ts')).toContain('const input = shareImageInputFrom(raw);');
    const context = read('hooks/use-share-context.ts');
    expect(context).toContain('setBranding(null);');
    expect(context).toContain('setCalendar(null);');
    expect(context.match(/\.catch\(\(\) => \{\}\)/g)).toHaveLength(2);
    expect(context).toContain('[enabled, gymId, wantCalendar]');
  });

  it('every text of the share composition ignores the device font scale (a 360 by 640 pt capture must not overflow at large text sizes)', () => {
    const composition = read('components/ShareImageComposition.tsx');
    const texts = composition.match(/<ThemedText\b/g) ?? [];
    expect(texts.length).toBeGreaterThan(0);
    expect(composition.match(/allowFontScaling=\{false\}/g)).toHaveLength(texts.length);
  });

  it('an unavailable answer hides the button on the NEXT view, not the current one', async () => {
    expect(isShareKnownUnavailable()).toBe(false);
    const { deps } = fakes({ isAvailable: async () => false });
    const outcome = await runShareFlow(deps);
    // The hook marks it; a view that mounted before still has its button, a view mounted after starts without it.
    const viewBefore = !isShareKnownUnavailable();
    markShareUnavailable();
    const viewAfter = !isShareKnownUnavailable();
    expect(outcome.kind).toBe('unavailable');
    expect([viewBefore, viewAfter]).toEqual([true, false]);
  });
});

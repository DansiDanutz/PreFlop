/**
 * The PreFlop iOS and Android apps (apps/mobile) are a Capacitor shell around this web app. This
 * module is the only place that knows about it; on the website every function here is a no-op and
 * the Capacitor plugins are never downloaded (they are imported on demand).
 */

interface CapacitorGlobal { isNativePlatform?: () => boolean; getPlatform?: () => string }

/** True inside the native app (never in a browser, the installed PWA or a partner iframe). */
export function isNativeApp(): boolean {
  const c = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return !!c?.isNativePlatform?.();
}

/** Where a native launch lands: the player app, not the marketing home page. */
export const NATIVE_START = '/app';

export interface NativeHooks {
  /** Go back one screen. */
  back(): void;
  /** True on a top-level screen, where Back leaves the app instead. */
  atRoot(): boolean;
  /** The app came back to the foreground: refresh what may be stale. */
  resume(): void;
}

/** Top-level screens: Android Back there sends the app to the background. */
export function isRootPath(path: string): boolean {
  return path === '/' || path === NATIVE_START || path === '/login' || path === '/register';
}

/**
 * Android Back closes the top dialog first (the sheets close on Escape), then goes back a screen,
 * and on a top-level screen sends the app to the background like other Android apps.
 */
export function backAction(dialogOpen: boolean, canGoBack: boolean, atRoot: boolean): 'close-dialog' | 'back' | 'minimize' {
  if (dialogOpen) return 'close-dialog';
  return canGoBack && !atRoot ? 'back' : 'minimize';
}

/**
 * The origin to put in links shared outside the app (invitations, referral links). Inside the native
 * app window.location.origin is the app's own internal origin (https://localhost on Android,
 * capacitor://localhost on iOS), useless to anyone else: the public website's origin is used instead.
 */
export function publicOrigin(webUrl: string | undefined = import.meta.env.VITE_WEB_URL as string | undefined): string {
  const own = (globalThis as { location?: { origin?: string } }).location?.origin ?? '';
  return isNativeApp() && webUrl ? webUrl.replace(/\/+$/, '') : own;
}

let started = false;

/** Native-only setup: status bar, splash screen, Back button, resume. Safe to call more than once. */
export async function initNativeApp(h: NativeHooks): Promise<void> {
  if (!isNativeApp() || started) return;
  started = true;
  const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([
    import('@capacitor/app'), import('@capacitor/status-bar'), import('@capacitor/splash-screen'),
  ]);
  // Light status-bar text over the dark app; the app draws under it and pads with safe-area insets.
  await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  // The splash stays up until the first render (capacitor.config.ts: launchAutoHide false).
  await SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
  await App.addListener('backButton', ({ canGoBack }) => {
    const dialogOpen = !!document.querySelector('[role="dialog"][aria-modal="true"]');
    const action = backAction(dialogOpen, canGoBack, h.atRoot());
    if (action === 'close-dialog') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else if (action === 'back') h.back();
    else void App.minimizeApp();
  });
  await App.addListener('resume', () => h.resume());
}

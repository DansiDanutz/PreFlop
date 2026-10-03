import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native apps bundle the player web app (apps/web, built with VITE_API_URL pointing at the
 * API) and load it from the device: no remote web server is involved, only the API. The API must
 * allow the app's origins in CORS_ORIGINS: capacitor://localhost (iOS) and https://localhost
 * (Android). See README.md in this folder.
 */
const config: CapacitorConfig = {
  appId: 'com.preflop.app',
  appName: 'PreFlop',
  webDir: '../web/dist',
  backgroundColor: '#0e1311',
  android: {
    // Served as https://localhost so the WebView is a secure context (WebSocket, storage).
    allowMixedContent: false,
  },
  ios: {
    // The web app pads itself with env(safe-area-inset-*); the WebView must not add its own inset.
    contentInset: 'never',
    backgroundColor: '#0e1311',
  },
  plugins: {
    SplashScreen: {
      // Hidden by the web app once it has rendered (src/lib/native.ts), so no white flash.
      launchAutoHide: false,
      backgroundColor: '#0e1311',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#0e1311',
    },
  },
};

export default config;

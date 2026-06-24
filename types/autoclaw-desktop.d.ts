// Global typing for the bridge the Electron desktop shell injects via
// electron/preload.js. Present only when running inside the AutoClaw desktop
// app; always guard with `window.autoclawDesktop?.isDesktop` in web code.
export interface AutoclawDesktopBridge {
  isDesktop: true;
  platform: NodeJS.Platform;
  versions: { electron: string; chrome: string };
  notify: (options: {
    title: string;
    body?: string;
    silent?: boolean;
  }) => Promise<{ ok: boolean; reason?: string }>;
}

declare global {
  interface Window {
    autoclawDesktop?: AutoclawDesktopBridge;
  }
}

export {};

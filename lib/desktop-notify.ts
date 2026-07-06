// Unified client-side notification entry point.
//
// Inside the AutoClaw Electron desktop shell it routes to the native OS
// notification (correct app name/icon, click focuses the window). In a plain
// browser it falls back to the Web Notification API, requesting permission on
// first use. Use this for events like "campaign sent", "AI generation done",
// "lead enriched", "account logged out".
//
// This module is browser-only — do not import it from server code.

export interface NotifyOptions {
  title: string;
  body?: string;
  silent?: boolean;
  /**
   * Same-origin path ("/campaigns/123") or URL to open when the notification is
   * clicked. In the desktop shell this navigates the app window; in the browser
   * fallback it focuses the tab and navigates there.
   */
  url?: string;
}

/**
 * Show a notification to the user. Resolves to true if a notification was
 * shown, false if it could not be (no permission, unsupported, or SSR).
 */
export async function notifyUser(options: NotifyOptions): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // Desktop shell: use the native OS notification via the preload bridge.
  const desktop = window.autoclawDesktop;
  if (desktop?.isDesktop) {
    try {
      const result = await desktop.notify(options);
      if (result?.ok) return true;
      // Fall through to the web path if the desktop side declined.
    } catch {
      // Fall through to the web fallback below.
    }
  }

  // Browser fallback: Web Notification API.
  if (typeof Notification === "undefined") return false;

  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return false;
    }
  }
  if (permission !== "granted") return false;

  try {
    const notification = new Notification(options.title, {
      body: options.body,
      silent: options.silent,
    });
    if (options.url) {
      notification.onclick = () => {
        window.focus();
        window.location.assign(options.url as string);
      };
    }
    return true;
  } catch {
    return false;
  }
}

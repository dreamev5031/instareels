"use client";

import { subscribePush } from "@/ui/api";

const DEVICE_ID_KEY = "instareels.pushDeviceId";
export const WEB_PUSH_VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? "";

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && Boolean(WEB_PUSH_VAPID_PUBLIC_KEY);
}

/** iOS Safari only supports the Push API for a site added to the Home
 *  Screen (standalone display mode) — a regular Safari tab cannot
 *  subscribe at all, even if the API objects exist. Detecting this lets
 *  the UI explain what's needed instead of a subscribe attempt silently
 *  failing. */
export function isIosNonStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches || (window.navigator as { standalone?: boolean }).standalone === true;
  return isIos && !isStandalone;
}

function deviceId(): string {
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export type PushSetupResult = "SUBSCRIBED" | "PERMISSION_DENIED" | "UNSUPPORTED" | "ERROR";

/** Requests Notification permission (browser prompt) and, if granted,
 *  registers the service worker + subscribes + persists the subscription
 *  server-side. Must only be called from a deliberate user action (a
 *  button tap) — never on page load. */
export async function requestPushSubscription(): Promise<PushSetupResult> {
  if (!isPushSupported()) return "UNSUPPORTED";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "PERMISSION_DENIED";

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(WEB_PUSH_VAPID_PUBLIC_KEY) as BufferSource,
      });
    }
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("구독 정보를 생성하지 못했습니다.");

    await subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }, deviceId());
    return "SUBSCRIBED";
  } catch (caught) {
    console.error("[push] subscribe failed", caught);
    return "ERROR";
  }
}

export function notificationPermissionState(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

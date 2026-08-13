import { NextResponse } from "next/server";
import { pushSubscriptionStorage } from "@/push/storage";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; deviceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const auth = body.keys?.auth?.trim();
  const deviceId = body.deviceId?.trim();
  if (!endpoint || !p256dh || !auth || !deviceId) {
    return NextResponse.json(
      { error: "PUSH_SUBSCRIPTION_REQUIRED", error_code: "PUSH_SUBSCRIPTION_REQUIRED", message: "구독 정보가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (!pushSubscriptionStorage.isConfigured()) {
    return NextResponse.json(
      { error: "PUSH_NOT_CONFIGURED", error_code: "PUSH_NOT_CONFIGURED", message: "알림 저장소가 연결되지 않았습니다." },
      { status: 503 },
    );
  }

  const entry = await pushSubscriptionStorage.addSubscription({ endpoint, p256dh, auth, deviceId });
  return NextResponse.json({ subscription: entry });
}

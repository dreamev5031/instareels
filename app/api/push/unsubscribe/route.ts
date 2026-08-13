import { NextResponse } from "next/server";
import { pushSubscriptionStorage } from "@/push/storage";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const endpoint = body.endpoint?.trim();
  if (!endpoint) {
    return NextResponse.json({ error: "PUSH_SUBSCRIPTION_REQUIRED", error_code: "PUSH_SUBSCRIPTION_REQUIRED", message: "endpoint가 필요합니다." }, { status: 400 });
  }
  const removed = await pushSubscriptionStorage.removeSubscription(endpoint);
  return NextResponse.json({ removed });
}

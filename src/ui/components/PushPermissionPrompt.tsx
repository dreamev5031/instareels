"use client";

import { useState } from "react";
import { isIosNonStandalone, isPushSupported, requestPushSubscription } from "@/ui/push";

export default function PushPermissionPrompt({ onDismiss }: { onDismiss: () => void }) {
  const [status, setStatus] = useState<"idle" | "requesting" | "error">("idle");

  if (!isPushSupported()) {
    if (!isIosNonStandalone()) return null;
    return (
      <div className="rounded-xl border border-[var(--border)] bg-slate-50 px-4 py-3 text-xs text-[var(--text-muted)]">
        iPhone에서는 홈 화면에 추가한 뒤에만 완료 알림을 받을 수 있어요. (공유 → 홈 화면에 추가)
        <button type="button" onClick={onDismiss} className="mt-2 block text-[11px] font-semibold text-[var(--primary)]">
          닫기
        </button>
      </div>
    );
  }

  async function handleEnable() {
    setStatus("requesting");
    const outcome = await requestPushSubscription();
    if (outcome === "ERROR") {
      setStatus("error");
      return;
    }
    onDismiss();
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm shadow-sm" data-testid="push-permission-prompt">
      <p className="font-semibold">영상이 완성되면 알려드릴까요?</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">다른 화면을 보고 있어도 완료·실패를 알림으로 받을 수 있어요.</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          data-testid="push-enable-button"
          onClick={handleEnable}
          disabled={status === "requesting"}
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {status === "requesting" ? "요청 중..." : "알림 받기"}
        </button>
        <button type="button" onClick={onDismiss} className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
          나중에
        </button>
      </div>
      {status === "error" && <p className="mt-2 text-xs text-[var(--danger)]">알림 설정에 실패했습니다. 나중에 다시 시도해 주세요.</p>}
    </div>
  );
}

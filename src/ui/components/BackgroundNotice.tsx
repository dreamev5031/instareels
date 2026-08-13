"use client";

export default function BackgroundNotice() {
  return (
    <div className="rounded-xl bg-indigo-50 px-4 py-3 text-xs text-[var(--primary)]" data-testid="background-notice">
      다른 앱을 사용해도 작업은 계속됩니다. 완료되면 알림으로 알려드립니다.
    </div>
  );
}

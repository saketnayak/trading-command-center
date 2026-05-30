"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RunForm } from "@/components/runs/RunForm";
import type { RunFormInitialValues } from "@/components/runs/RunForm";

function NewRunContent() {
  const router = useRouter();
  const params = useSearchParams();

  const initialValues: RunFormInitialValues = {
    ticker: params.get("ticker") ?? undefined,
    provider: params.get("provider") ?? undefined,
    model: params.get("model") ?? undefined,
    depth: params.get("depth") ?? undefined,
    analysts: params.get("analysts") ? params.get("analysts")!.split(",") : undefined,
    label: params.get("label") ?? undefined,
  };

  const hasPreFill = Object.values(initialValues).some(Boolean);

  return (
    <>
      {hasPreFill && (
        <p className="text-muted text-xs mb-4">Pre-filled from previous run — adjust as needed.</p>
      )}
      <RunForm initialValues={initialValues} onSuccess={(runId) => router.push(`/runs/${runId}/live`)} />
    </>
  );
}

export default function NewRunPage() {
  return (
    <main className="px-4 py-4 sm:p-6">
      <h1 className="text-fg text-lg font-semibold mb-6">New Run</h1>
      <Suspense fallback={<div className="text-muted text-sm">Loading…</div>}>
        <NewRunContent />
      </Suspense>
    </main>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDeliverySettings, updateDeliverySettings, testWebhook } from "@/lib/api";
import type { DeliverySettings } from "@/lib/types";
import { getBrowserTimezone, timezoneSelectOptions } from "@/lib/ianaTimezones";

interface Props {
  portfolioId: string;
  open: boolean;
  onClose: () => void;
}

export function DeliverySettingsModal({ portfolioId, open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [testError, setTestError] = useState("");
  const [showChatIdHelp, setShowChatIdHelp] = useState(false);

  const { data, isLoading } = useQuery<DeliverySettings>({
    queryKey: ["deliverySettings", portfolioId],
    queryFn: () => getDeliverySettings(portfolioId),
    enabled: open,
  });

  const [form, setForm] = useState<Partial<DeliverySettings>>({});

  useEffect(() => {
    if (data) {
      const browserTz = getBrowserTimezone();
      setForm({
        ...data,
        delivery_timezone: data.delivery_timezone && data.delivery_timezone !== "UTC"
          ? data.delivery_timezone
          : browserTz,
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => updateDeliverySettings(portfolioId, form),
    onSuccess: (updated) => {
      queryClient.setQueryData(["deliverySettings", portfolioId], updated);
      onClose();
    },
  });

  const handleTest = async () => {
    setTestStatus("sending");
    setTestError("");
    try {
      await testWebhook(portfolioId);
      setTestStatus("ok");
    } catch (e: unknown) {
      setTestStatus("error");
      setTestError(e instanceof Error ? e.message : "Delivery failed");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-page border border-input-border rounded-2xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-fg">Brief Delivery</h2>
          <button onClick={onClose} className="text-muted hover:text-fg-secondary text-lg leading-none">✕</button>
        </div>

        {isLoading ? (
          <p className="text-muted text-sm text-center py-6">Loading…</p>
        ) : (
          <div className="space-y-5">
            {/* Email section */}
            <div className="bg-input/60 border border-input-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-fg">Email Delivery</span>
                <button
                  onClick={() => setForm((f) => ({ ...f, email_enabled: !f.email_enabled }))}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    form.email_enabled ? "bg-indigo-600" : "bg-muted-surface"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      form.email_enabled ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
              {form.email_enabled && (
                <div>
                  <label className="text-xs text-muted mb-1 block">Email address</label>
                  <input
                    type="email"
                    value={form.email_address ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, email_address: e.target.value || null }))}
                    placeholder="your@email.com"
                    className="w-full bg-muted-surface border border-input-border rounded-lg px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
              )}
              <p className="text-xs text-muted">Delivered weekdays ~9:15 AM in your delivery timezone</p>
            </div>

            {/* Timezone section */}
            <div className="bg-input/60 border border-input-border rounded-xl p-4 space-y-2">
              <label className="text-sm font-medium text-fg block">Delivery Timezone</label>
              <select
                value={form.delivery_timezone ?? "UTC"}
                onChange={(e) => setForm((f) => ({ ...f, delivery_timezone: e.target.value }))}
                className="w-full bg-muted-surface border border-input-border rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-indigo-500"
              >
                {timezoneSelectOptions(form.delivery_timezone ?? "UTC").map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <p className="text-xs text-muted">Briefs are generated and delivered at 9:15 AM in this timezone.</p>
            </div>

            {/* Webhook section */}
            <div className="bg-input/60 border border-input-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-fg">Webhook Delivery</span>
                  <div className="group relative">
                    <span className="cursor-help text-muted text-xs leading-none border border-input-border rounded-full w-4 h-4 inline-flex items-center justify-center">?</span>
                    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 rounded-lg bg-input border border-input-border p-3 text-xs text-fg-secondary opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow-xl">
                      <p className="font-semibold mb-1">Webhook formats</p>
                      <p className="mb-2 text-muted"><span className="text-fg font-medium">Generic JSON</span> — POSTs the full insight payload to any URL.</p>
                      <p className="mb-2 text-muted"><span className="text-fg font-medium">Slack</span> — Sends a formatted Slack Block Kit message. Use a Slack <a className="text-indigo-400" href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener noreferrer">Incoming Webhook</a> URL.</p>
                      <p className="text-muted"><span className="text-fg font-medium">Telegram</span> — Sends an HTML message via a Telegram bot. Set URL to <span className="font-mono text-fg-secondary">https://api.telegram.org/bot&lt;TOKEN&gt;/sendMessage</span> and enter the chat ID below.</p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setForm((f) => ({ ...f, webhook_enabled: !f.webhook_enabled }))}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    form.webhook_enabled ? "bg-indigo-600" : "bg-muted-surface"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      form.webhook_enabled ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
              {form.webhook_enabled && (
                <>
                  <div>
                    <label className="text-xs text-muted mb-1 block">Webhook URL (https://)</label>
                    <input
                      type="url"
                      value={form.webhook_url ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, webhook_url: e.target.value || null }))}
                      placeholder="https://hooks.slack.com/..."
                      className="w-full bg-muted-surface border border-input-border rounded-lg px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-hidden focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted mb-1 block">Format</label>
                    <select
                      value={form.webhook_format ?? "json"}
                      onChange={(e) => setForm((f) => ({ ...f, webhook_format: e.target.value as "json" | "slack" | "telegram" }))}
                      className="bg-muted-surface border border-input-border rounded-lg px-3 py-2 text-sm text-fg focus:outline-hidden focus:border-indigo-500"
                    >
                      <option value="json">Generic JSON</option>
                      <option value="slack">Slack Message</option>
                      <option value="telegram">Telegram</option>
                    </select>
                  </div>
                  {form.webhook_format === "telegram" && (
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs text-muted mb-1 block">Webhook URL</label>
                        <p className="text-xs text-muted">Set the URL above to your bot&apos;s sendMessage endpoint:</p>
                        <p className="text-xs font-mono text-muted mt-0.5">https://api.telegram.org/bot&lt;TOKEN&gt;/sendMessage</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs text-muted">Telegram Chat ID</label>
                          <button
                            type="button"
                            onClick={() => setShowChatIdHelp((v) => !v)}
                            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                          >
                            {showChatIdHelp ? "Hide help ▲" : "How to get your Chat ID ▼"}
                          </button>
                        </div>
                        <input
                          type="text"
                          value={form.telegram_chat_id ?? ""}
                          onChange={(e) => setForm((f) => ({ ...f, telegram_chat_id: e.target.value || null }))}
                          placeholder="-1001234567890"
                          className="w-full bg-muted-surface border border-input-border rounded-lg px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:border-indigo-500"
                        />
                        {showChatIdHelp && (
                          <div className="mt-2 bg-page/60 border border-input-border rounded-lg p-3 space-y-1.5">
                            <ol className="text-xs text-muted space-y-1 list-decimal list-inside">
                              <li>Create a bot via <span className="text-fg-secondary">@BotFather</span> in Telegram and copy the token</li>
                              <li>Send your bot any message (e.g. <span className="text-fg-secondary">/start</span>)</li>
                              <li>Open <span className="font-mono text-fg-secondary">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</span> in a browser</li>
                              <li>Find <span className="font-mono text-fg-secondary">&quot;chat&quot;:&#123;&quot;id&quot;:...</span> — that number is your Chat ID</li>
                            </ol>
                            <p className="text-xs text-muted pt-0.5">For a channel: add the bot as admin, post a message, then check <span className="text-muted">getUpdates</span>. The ID will be a negative number like <span className="font-mono text-muted">-1001234567890</span>.</p>
                            <p className="text-xs text-indigo-400 pt-0.5">Shortcut: forward any message from the target chat to <span className="font-medium">@userinfobot</span> — it replies with the ID instantly.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={handleTest}
                      disabled={testStatus === "sending" || !form.webhook_url}
                      className="text-xs text-indigo-400 hover:text-indigo-300 disabled:text-subtle transition-colors"
                      title="Tests against saved settings — click Save first if you've made changes"
                    >
                      {testStatus === "sending" ? "Sending…" : "Test webhook"}
                    </button>
                    {testStatus === "ok" && <span className="text-xs text-green-400">✓ Sent</span>}
                    {testStatus === "error" && <span className="text-xs text-red-400 wrap-break-word min-w-0">{testError}</span>}
                  </div>
                  <p className="text-xs text-subtle">Tests saved settings — click Save first if you&apos;ve made changes</p>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-fg transition-colors">
                Cancel
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-muted-surface disabled:text-muted text-fg text-sm font-medium rounded-lg transition-colors"
              >
                {saveMutation.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

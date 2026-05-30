"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getInvestorProfile, upsertInvestorProfile } from "@/lib/api";

const SECTORS = [
  { slug: "technology", label: "Technology" },
  { slug: "healthcare", label: "Healthcare" },
  { slug: "energy", label: "Energy" },
  { slug: "financials", label: "Financials" },
  { slug: "consumer", label: "Consumer" },
  { slug: "industrials", label: "Industrials" },
  { slug: "real_estate", label: "Real Estate" },
  { slug: "utilities", label: "Utilities" },
  { slug: "materials", label: "Materials" },
  { slug: "crypto", label: "Crypto/Digital Assets" },
  { slug: "commodities", label: "Commodities" },
  { slug: "international", label: "International/EM" },
];

const ESG = [
  { slug: "tobacco", label: "Tobacco" },
  { slug: "gambling", label: "Gambling" },
  { slug: "weapons_defense", label: "Weapons/Defense" },
  { slug: "fossil_fuels", label: "Fossil Fuels" },
];

const ALL_ANTI = [...SECTORS, ...ESG];

type FormState = {
  income_range: string;
  liquidity_reserve: string;
  dependents: string;
  time_horizon: string;
  risk_willingness: number;
  risk_ability: string;
  investment_style: string;
  sizing_approach: string;
  preferred_sectors: string[];
  blind_spots: string;
  emotional_tendencies: string;
  personal_rules: string;
  anti_portfolio: string[];
  target_portfolio_size: string;
  income_goal: string;
  milestones: string;
};

const EMPTY: FormState = {
  income_range: "", liquidity_reserve: "", dependents: "",
  time_horizon: "", risk_willingness: 3, risk_ability: "",
  investment_style: "", sizing_approach: "", preferred_sectors: [],
  blind_spots: "", emotional_tendencies: "", personal_rules: "",
  anti_portfolio: [], target_portfolio_size: "", income_goal: "", milestones: "",
};

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-muted text-xs mb-1 block">{children}</label>;
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-input border border-input-border rounded-sm px-3 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
    >
      {children}
    </select>
  );
}

function Textarea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      className="w-full bg-input border border-input-border rounded-sm px-3 py-2 text-sm text-fg focus:outline-hidden focus:border-blue-500 resize-none"
    />
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-fg text-sm font-semibold">{title}</h2>
      {description && <p className="text-muted text-xs mt-0.5">{description}</p>}
    </div>
  );
}

function CheckboxGroup({
  options, selected, onChange,
}: { options: { slug: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void }) {
  const toggle = (slug: string) =>
    onChange(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug]);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.slug}
          type="button"
          onClick={() => toggle(o.slug)}
          className={`text-xs px-2.5 py-1 rounded border transition-colors ${
            selected.includes(o.slug)
              ? "bg-purple-500/20 border-purple-500/50 text-purple-300"
              : "bg-input border-input-border text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function InvestorProfilePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saved, setSaved] = useState(false);

  const { data: profile } = useQuery({ queryKey: ["investorProfile"], queryFn: getInvestorProfile });

  useEffect(() => {
    if (profile) {
      setForm({
        income_range: profile.income_range ?? "",
        liquidity_reserve: profile.liquidity_reserve ?? "",
        dependents: profile.dependents != null ? String(profile.dependents) : "",
        time_horizon: profile.time_horizon ?? "",
        risk_willingness: profile.risk_willingness ?? 3,
        risk_ability: profile.risk_ability ?? "",
        investment_style: profile.investment_style ?? "",
        sizing_approach: profile.sizing_approach ?? "",
        preferred_sectors: profile.preferred_sectors ?? [],
        blind_spots: profile.blind_spots ?? "",
        emotional_tendencies: profile.emotional_tendencies ?? "",
        personal_rules: profile.personal_rules ?? "",
        anti_portfolio: profile.anti_portfolio ?? [],
        target_portfolio_size: profile.target_portfolio_size ?? "",
        income_goal: profile.income_goal ?? "",
        milestones: profile.milestones ?? "",
      });
    }
  }, [profile]);

  const set = (k: keyof FormState) => (v: string | number | string[]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertInvestorProfile({
        income_range: form.income_range || null,
        liquidity_reserve: form.liquidity_reserve || null,
        dependents: form.dependents !== "" ? parseInt(form.dependents) : null,
        time_horizon: form.time_horizon || null,
        risk_willingness: form.risk_willingness || null,
        risk_ability: form.risk_ability || null,
        investment_style: form.investment_style || null,
        sizing_approach: form.sizing_approach || null,
        preferred_sectors: form.preferred_sectors.length ? form.preferred_sectors : null,
        blind_spots: form.blind_spots || null,
        emotional_tendencies: form.emotional_tendencies || null,
        personal_rules: form.personal_rules || null,
        anti_portfolio: form.anti_portfolio.length ? form.anti_portfolio : null,
        target_portfolio_size: form.target_portfolio_size || null,
        income_goal: form.income_goal || null,
        milestones: form.milestones || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["investorProfile"] });
      setSaved(true);
      setTimeout(() => router.push("/settings"), 800);
    },
  });

  return (
    <main className="px-4 py-4 sm:p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <a href="/settings" className="text-muted hover:text-fg-secondary text-sm">← Settings</a>
          <h1 className="text-lg font-semibold text-fg">Investor DNA</h1>
        </div>
        <p className="text-muted text-sm mb-8">
          All fields are optional. The more context you provide, the more personalized your AI portfolio insights will be.
        </p>

        <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }} className="space-y-8">
          {/* Section 1 */}
          <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
            <SectionHeader title="Operating Base" description="Your financial context shapes every recommendation." />
            <div>
              <Label>Annual income range</Label>
              <Select value={form.income_range} onChange={set("income_range")}>
                <option value="">— Select —</option>
                <option value="lt_50k">Less than $50k</option>
                <option value="50k_100k">$50k – $100k</option>
                <option value="100k_250k">$100k – $250k</option>
                <option value="250k_500k">$250k – $500k</option>
                <option value="gt_500k">Over $500k</option>
                <option value="undisclosed">Prefer not to say</option>
              </Select>
            </div>
            <div>
              <Label>{"Monthly liquidity reserve (e.g. \"3 months expenses\")"}</Label>
              <input
                type="text"
                value={form.liquidity_reserve}
                onChange={(e) => set("liquidity_reserve")(e.target.value)}
                placeholder="3 months expenses"
                className="w-full bg-input border border-input-border rounded-sm px-3 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
              />
            </div>
            <div>
              <Label>Financial dependents</Label>
              <input
                type="number"
                min={0}
                value={form.dependents}
                onChange={(e) => set("dependents")(e.target.value)}
                placeholder="0"
                className="w-32 bg-input border border-input-border rounded-sm px-3 py-1.5 text-sm text-fg focus:outline-hidden focus:border-blue-500"
              />
            </div>
          </div>

          {/* Section 2 */}
          <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
            <SectionHeader title="Capital Base" description="Your time horizon and risk profile." />
            <div>
              <Label>Investment time horizon</Label>
              <Select value={form.time_horizon} onChange={set("time_horizon")}>
                <option value="">— Select —</option>
                <option value="lt_1y">Less than 1 year</option>
                <option value="1_3y">1 – 3 years</option>
                <option value="3_7y">3 – 7 years</option>
                <option value="7_15y">7 – 15 years</option>
                <option value="gt_15y">15+ years</option>
              </Select>
            </div>
            <div>
              <Label>Risk willingness: {form.risk_willingness}/5</Label>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="text-muted text-xs">Conservative</span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={form.risk_willingness}
                  onChange={(e) => set("risk_willingness")(parseInt(e.target.value))}
                  className="flex-1 accent-purple-500"
                />
                <span className="text-muted text-xs">Aggressive</span>
              </div>
            </div>
            <div>
              <Label>Risk ability</Label>
              <Select value={form.risk_ability} onChange={set("risk_ability")}>
                <option value="">— Select —</option>
                <option value="low">Low — cannot afford significant losses</option>
                <option value="medium">Medium — can absorb moderate drawdowns</option>
                <option value="high">High — can tolerate large swings</option>
              </Select>
            </div>
          </div>

          {/* Section 3 */}
          <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
            <SectionHeader title="Investment Philosophy" description="How you approach building a portfolio." />
            <div>
              <Label>Investment style</Label>
              <div className="flex gap-2">
                {[["passive", "Passive (index/ETF-first)"], ["active", "Active (stock picking)"], ["hybrid", "Hybrid"]].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => set("investment_style")(v)}
                    className={`text-sm px-3 py-1.5 rounded-sm border transition-colors ${form.investment_style === v ? "bg-purple-500/20 border-purple-500/50 text-purple-300" : "bg-input border-input-border text-muted hover:text-fg"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Position sizing approach</Label>
              <div className="flex gap-2 flex-wrap">
                {[["equal_weight", "Equal weight"], ["conviction", "Conviction-based"], ["market_cap", "Market-cap weighted"]].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => set("sizing_approach")(v)}
                    className={`text-sm px-3 py-1.5 rounded-sm border transition-colors ${form.sizing_approach === v ? "bg-purple-500/20 border-purple-500/50 text-purple-300" : "bg-input border-input-border text-muted hover:text-fg"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Preferred sectors / themes</Label>
              <CheckboxGroup options={SECTORS} selected={form.preferred_sectors} onChange={set("preferred_sectors") as (v: string[]) => void} />
            </div>
          </div>

          {/* Section 4 */}
          <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
            <SectionHeader title="Behavioral Profile" description="Self-awareness is the edge most investors skip." />
            <div>
              <Label>Known blind spots</Label>
              <Textarea value={form.blind_spots} onChange={set("blind_spots") as (v: string) => void} placeholder="e.g. I tend to hold losers too long" />
            </div>
            <div>
              <Label>Emotional tendencies</Label>
              <Textarea value={form.emotional_tendencies} onChange={set("emotional_tendencies") as (v: string) => void} placeholder="e.g. FOMO buyer in bull markets" />
            </div>
            <div>
              <Label>Personal rules</Label>
              <Textarea value={form.personal_rules} onChange={set("personal_rules") as (v: string) => void} placeholder="e.g. Never buy without a stop-loss" />
            </div>
          </div>

          {/* Section 5 */}
          <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
            <SectionHeader title="Constraints and Goals" description="Hard limits and where you're headed." />
            <div>
              <Label>Anti-portfolio (never recommend these)</Label>
              <CheckboxGroup options={ALL_ANTI} selected={form.anti_portfolio} onChange={set("anti_portfolio") as (v: string[]) => void} />
            </div>
            <div>
              <Label>Target portfolio size</Label>
              <Select value={form.target_portfolio_size} onChange={set("target_portfolio_size")}>
                <option value="">— Select —</option>
                <option value="lt_50k">Less than $50k</option>
                <option value="50k_250k">$50k – $250k</option>
                <option value="250k_1m">$250k – $1M</option>
                <option value="1m_5m">$1M – $5M</option>
                <option value="gt_5m">Over $5M</option>
              </Select>
            </div>
            <div>
              <Label>Income goal</Label>
              <div className="flex gap-2 flex-wrap">
                {[["growth_only", "Growth only"], ["some_income", "Some income (5–20% yield)"], ["income_first", "Income-first (>20% yield)"]].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => set("income_goal")(v)}
                    className={`text-sm px-3 py-1.5 rounded-sm border transition-colors ${form.income_goal === v ? "bg-purple-500/20 border-purple-500/50 text-purple-300" : "bg-input border-input-border text-muted hover:text-fg"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Key milestones</Label>
              <Textarea value={form.milestones} onChange={set("milestones") as (v: string) => void} placeholder="e.g. Retire at 55 with $2M, fund college in 2031" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              type="submit"
              disabled={saveMutation.isPending || saved}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-fg text-sm rounded-lg font-medium transition-colors"
            >
              {saved ? "Saved ✓" : saveMutation.isPending ? "Saving…" : "Save Profile"}
            </button>
            <a href="/settings" className="text-muted hover:text-fg text-sm">Cancel</a>
            {saveMutation.isError && (
              <span className="text-red-400 text-xs">{(saveMutation.error as Error).message}</span>
            )}
          </div>
        </form>
      </main>
  );
}

"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TopNav } from "@/components/layout/TopNav";
import {
  listPortfolios,
  createPortfolio,
  deletePortfolio,
  uploadPortfolioSnapshot,
  getPortfolioCurrent,
  exportPortfolioCsv,
} from "@/lib/api";
import type { Portfolio } from "@/lib/types";
import { PortfolioSwitcher } from "@/components/portfolio/PortfolioSwitcher";
import { PortfolioHeader } from "@/components/portfolio/PortfolioHeader";
import { UploadDrawer } from "@/components/portfolio/UploadDrawer";
import { HoldingsTable } from "@/components/portfolio/HoldingsTable";

export default function PortfolioPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: portfolios = [], isLoading: loadingPortfolios } = useQuery({
    queryKey: ["portfolios"],
    queryFn: listPortfolios,
  });

  const { data: current, isLoading: loadingCurrent } = useQuery({
    queryKey: ["portfolio-current", selectedId],
    queryFn: () => getPortfolioCurrent(selectedId!),
    enabled: selectedId != null,
  });

  // Auto-select first portfolio on load
  useEffect(() => {
    if (selectedId === null && portfolios.length > 0) {
      setSelectedId(portfolios[0].id);
    }
  }, [portfolios, selectedId]);

  // Open upload drawer when selected portfolio has no snapshot yet
  useEffect(() => {
    if (selectedId != null && !loadingCurrent && current !== undefined && current.snapshot === null) {
      setUploadOpen(true);
    }
  }, [selectedId, current]);

  const createMutation = useMutation({
    mutationFn: (name: string) => createPortfolio(name),
    onSuccess: (p: Portfolio) => {
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      setSelectedId(p.id);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePortfolio(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      setSelectedId(null);
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadPortfolioSnapshot(selectedId!, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-current", selectedId] });
      setUploadOpen(false);
    },
  });

  const selectedPortfolio = portfolios.find((p) => p.id === selectedId) ?? null;

  async function handleExport() {
    if (!selectedId || !selectedPortfolio) return;
    const blob = await exportPortfolioCsv(selectedId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `portfolio-${selectedPortfolio.name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-navy-900">
      <TopNav />
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-lg font-semibold text-white">Portfolio</h1>

        <div className="flex items-center gap-4">
          <PortfolioSwitcher
            portfolios={portfolios}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCreate={(name) => createMutation.mutate(name)}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        </div>

        {selectedPortfolio && (
          <PortfolioHeader
            portfolio={selectedPortfolio}
            totals={current?.totals ?? null}
            snapshotDate={current?.snapshot?.uploaded_at ?? null}
            broker={current?.snapshot?.broker ?? null}
            onUploadClick={() => setUploadOpen(true)}
            onExportClick={handleExport}
          />
        )}

        <UploadDrawer
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUpload={(file) => uploadMutation.mutate(file)}
          uploading={uploadMutation.isPending}
        />

        {selectedId === null && portfolios.length === 0 && !loadingPortfolios && (
          <p className="text-slate-500 text-sm text-center py-10">
            No portfolios yet. Create one above to get started.
          </p>
        )}

        {selectedId && loadingCurrent && (
          <div className="text-slate-400 text-sm">Loading portfolio…</div>
        )}

        {selectedId && !loadingCurrent && current && (
          <HoldingsTable
            holdings={current.holdings}
            priceUnavailableReason={current.price_unavailable_reason}
          />
        )}
      </main>
    </div>
  );
}

import { describe, expect, it } from "vitest";
import { changeText, itemProblem, itemsStartingInRange, shortAddress, walletBalance, type NetWorthItem, type NetWorthReport } from "./netWorth";

describe("net worth helpers", () => {
  it("describes the change over the range", () => {
    const r = { display_currency: "USD", change: { since: "2025-11-05", amount: -1234.5, pct: -0.0412 } } as NetWorthReport;
    expect(changeText(r)).toBe("−$1,234.50 (−4.1%) since 2025-11-05");
    expect(changeText({ ...r, change: { since: "2025-11-05", amount: 500, pct: null } })).toBe("+$500.00 since 2025-11-05");
    expect(changeText({ ...r, change: null })).toBeNull();
  });

  it("formats wallets", () => {
    const w = { wallet_chain: "btc", balance: 0.12345678, wallet_address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" } as NetWorthItem;
    expect(walletBalance(w)).toBe("0.12345678 BTC");
    expect(walletBalance({ ...w, wallet_chain: null })).toBeNull();
    expect(shortAddress(w.wallet_address)).toBe("bc1qxy…0wlh");
  });

  it("checks the add form", () => {
    expect(itemProblem({ kind: "asset", category: "cash", name: " ", valueText: "1" })).toBe("Give it a name.");
    expect(itemProblem({ kind: "asset", category: "cash", name: "Savings", valueText: "" })).toMatch(/current value/);
    expect(itemProblem({ kind: "asset", category: "cash", name: "Savings", valueText: "-5" })).toMatch(/current value/);
    expect(itemProblem({ kind: "asset", category: "cash", name: "Savings", valueText: "1200.5" })).toBeNull();
    expect(itemProblem({ kind: "asset", category: "crypto_wallet", name: "W", wallet_chain: "eth", wallet_address: "0x12" })).toMatch(/40 hex/);
    expect(itemProblem({ kind: "asset", category: "crypto_wallet", name: "W", wallet_chain: "btc",
      wallet_address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" })).toBeNull();
  });

  it("names items that start inside the range", () => {
    const r = { start: "2025-11-05", items: [
      { name: "Wallet", first_date: "2026-11-05" }, { name: "House", first_date: "2025-06-01" },
      { name: "Loan", first_date: "2026-02-01" }] } as unknown as NetWorthReport;
    expect(itemsStartingInRange(r)).toBe("Steps where an item starts counting: Loan (2026-02-01), Wallet (2026-11-05). "
      + "Record an earlier value in its History to fill in the line.");
    expect(itemsStartingInRange({ ...r, items: [] })).toBeNull();
  });
});

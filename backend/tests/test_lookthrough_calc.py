"""Pure maths for roadmap 3.4: N-PORT parsing, company matching, exposure, overlap, concentration."""
from datetime import date

import pytest

from app.services import lookthrough_calc as lc

pytestmark = pytest.mark.unit

NPORT = """<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/nport">
  <headerData><filerInfo><seriesClassInfo><seriesId>S000001</seriesId></seriesClassInfo></filerInfo></headerData>
  <formData>
    <genInfo><repPdEnd>2026-12-31</repPdEnd><repPdDate>2026-06-30</repPdDate></genInfo>
    <invstOrSecs>
      <invstOrSec><name>NVIDIA Corp</name><cusip>67066G104</cusip>
        <identifiers><isin value="US67066G1040"/><ticker value="NVDA"/></identifiers>
        <pctVal>8.5</pctVal><assetCat>EC</assetCat></invstOrSec>
      <invstOrSec><name>Apple Inc</name><identifiers><isin value="US0378331005"/></identifiers>
        <pctVal>7.25</pctVal><assetCat>EC</assetCat></invstOrSec>
      <invstOrSec><name>Treasury Note</name><pctVal>5.0</pctVal><assetCat>DBT</assetCat></invstOrSec>
      <invstOrSec><name>Short Future</name><pctVal>-1.0</pctVal><assetCat>DE</assetCat></invstOrSec>
    </invstOrSecs>
  </formData>
</edgarSubmission>"""


def test_parse_nport_splits_equities_from_everything_else():
    out = lc.parse_nport(NPORT)
    assert out["series_id"] == "S000001" and out["as_of"] == date(2026, 6, 30)
    assert [(e["name"], e["ticker"]) for e in out["equities"]] == [("NVIDIA Corp", "NVDA"), ("Apple Inc", "")]
    assert out["equities"][0]["weight"] == pytest.approx(0.085)
    assert out["other_weight"] == pytest.approx(0.05)  # the short future never adds weight


@pytest.mark.parametrize("name,want", [
    ("NVIDIA CORP", "nvidia"), ("NVIDIA Corp /DE/", "nvidia"), ("Apple Inc.", "apple"),
    ("JPMORGAN CHASE & CO", "jpmorgan chase &"), ("Alphabet Inc Class A", "alphabet"),
])
def test_normalize_name(name, want):
    assert lc.normalize_name(name) == want


def test_share_classes_of_one_company_add_up_and_unknown_names_stay_by_name():
    rows = [{"name": "Alphabet Inc Class A", "ticker": "GOOGL", "weight": 0.02},
            {"name": "Alphabet Inc Class C", "ticker": "", "weight": 0.015},
            {"name": "Private Co Ltd", "ticker": "", "weight": 0.01}]
    out = lc.resolve_holdings(rows, {"GOOGL": 1652044}, {"alphabet": ("GOOGL", 1652044)})
    assert out[0]["key"] == "cik:1652044" and out[0]["weight"] == pytest.approx(0.035)
    assert out[1]["key"] == "n:private" and out[1]["ticker"] is None


def test_trim_keeps_the_largest_and_drops_dust():
    rows = [{"key": str(i), "weight": 0.01 - i * 1e-5} for i in range(700)] + [{"key": "dust", "weight": 1e-6}]
    out = lc.trim_holdings(rows)
    assert len(out) == lc.MAX_STORED_HOLDINGS and out[0]["key"] == "0"
    assert all(h["key"] != "dust" for h in out)


def _h(key, weight, ticker=None):
    return {"key": key, "ticker": ticker or key, "name": key, "weight": weight}


PROFILES = {
    "FA": {"kind": "fund", "name": "Fund A", "source": "sec_nport", "as_of": "2026-06-30",
           "holdings": [_h("NVDA", 0.10), _h("AAPL", 0.05)], "sectors": {"technology": 1.0}},
    "FB": {"kind": "fund", "name": "Fund B", "source": "yahoo_top10", "as_of": None,
           "holdings": [_h("NVDA", 0.20), _h("XOM", 0.10)], "sectors": {"technology": 0.5, "energy": 0.3}},
    "NVDA": {"kind": "stock", "name": "NVIDIA", "sector": "Technology"},
}


def test_xray_adds_direct_and_fund_exposure_and_reports_what_is_not_known():
    out = lc.xray({"NVDA": 0.2, "FA": 0.5, "FB": 0.3}, PROFILES, {"NVDA": "NVDA"})
    top = out["exposures"][0]
    assert top["ticker"] == "NVDA"
    assert top["direct"] == pytest.approx(0.2)
    assert top["total"] == pytest.approx(0.2 + 0.05 + 0.06)
    assert [v["fund"] for v in top["via"]] == ["FB", "FA"]  # largest route first
    # FA knows 15% of itself, FB 30%: the rest is uncovered, not spread across known names.
    assert out["uncovered_weight"] == pytest.approx(0.5 * 0.85 + 0.3 * 0.7)
    assert out["fund_weight"] == pytest.approx(0.8)
    assert {f["ticker"]: f["covered_weight"] for f in out["funds"]}["FB"] == pytest.approx(0.3)


def test_sectors_combine_direct_and_funds_and_name_the_unexplained_part():
    out = lc.xray({"NVDA": 0.2, "FB": 0.8}, PROFILES, {"NVDA": "NVDA"})
    s = {x["sector"]: x for x in out["sectors"]}
    assert s["Technology"]["direct"] == pytest.approx(0.2)
    assert s["Technology"]["via_funds"] == pytest.approx(0.4)
    assert s["Energy"]["total"] == pytest.approx(0.24)
    assert s["Not in a sector"]["total"] == pytest.approx(0.16)
    assert sum(x["total"] for x in out["sectors"]) == pytest.approx(1.0)


def test_overlap_matrix_is_the_sum_of_the_smaller_weights():
    out = lc.xray({"FA": 0.5, "FB": 0.5}, PROFILES, {})
    m = dict(zip(out["overlap"]["tickers"], out["overlap"]["matrix"]))
    assert m["FA"][0] == 1.0 and m["FA"][1] == pytest.approx(0.10)
    assert m["FB"][0] == pytest.approx(0.10)


def test_looking_through_shows_concentration_the_tickers_hide():
    out = lc.xray({"NVDA": 0.5, "FUND": 0.5}, {"FUND": {"kind": "fund", "holdings": [_h("NVDA", 1.0)], "sectors": {}}},
                  {"NVDA": "NVDA"})
    assert out["concentration"]["as_held"]["top1_weight"] == pytest.approx(0.5)
    assert out["concentration"]["look_through"]["top1_weight"] == pytest.approx(1.0)


def test_a_portfolio_of_stocks_has_no_funds_and_unknown_tickers_count_as_themselves():
    out = lc.xray({"AAA": 0.6, "BBB": 0.4}, {}, {})
    assert out["funds"] == [] and out["uncovered_weight"] == 0
    assert out["overlap"] == {"tickers": [], "matrix": []}
    assert [r["ticker"] for r in out["exposures"]] == ["AAA", "BBB"]
    assert out["sectors"][0]["sector"] == "Unclassified"


def test_exposure_sentence():
    row = {"ticker": "NVDA", "name": "NVIDIA", "direct": 0.02, "total": 0.094,
           "via": [{"fund": "A", "weight": 0.05}, {"fund": "B", "weight": 0.02}, {"fund": "C", "weight": 0.004}]}
    assert lc.exposure_sentence(row) == "You hold 9.4% NVDA: 2.0% directly and 7.4% through 3 funds."
    assert lc.exposure_sentence({**row, "direct": 0, "via": row["via"][:1], "total": 0.05}) == "You hold 5.0% NVDA through 1 fund."


def test_prompt_block_is_empty_without_funds():
    assert lc.prompt_block(lc.xray({"AAA": 1.0}, {}, {})) == ""
    block = lc.prompt_block(lc.xray({"NVDA": 0.2, "FA": 0.8}, PROFILES, {"NVDA": "NVDA"}))
    assert "ETF LOOK-THROUGH" in block and "NVDA" in block and "minimums" in block

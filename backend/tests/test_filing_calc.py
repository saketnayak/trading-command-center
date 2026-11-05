"""Unit tests for SEC filing maths (pure; no DB, no network)."""
from datetime import date
from pathlib import Path

import pytest

from app.services import edgar_service, filing_calc as fc

pytestmark = pytest.mark.unit

FIX = Path(__file__).parent / "fixtures" / "sec"

LONG = "This is a sufficiently long risk factor paragraph that talks about {} in some detail for the tests."


def ten_k(risks: list[str], *, item="1A") -> str:
    """A minimal 10-K: hidden XBRL header, a table of contents, then the sections."""
    body = "".join(f"<p>{r}</p>" for r in risks)
    return f"""<html><body>
    <div style="display: none"><ix:header>HIDDEN XBRL Item 1A. Risk Factors hidden</ix:header></div>
    <table><tr><td>Item 1.</td><td>Business</td></tr><tr><td><a>Item {item}. Risk Factors</a></td><td>12</td></tr>
    <tr><td>Item 1B.</td><td>Unresolved Staff Comments</td></tr></table>
    <div><span>Item 1. Business</span></div><p>We make things.</p>
    <div><span style="font-weight:700">Item {item}. Risk Factors</span></div>{body}
    <div>Item 1B. Unresolved Staff Comments</div><p>None.</p>
    <div>Item 2. Properties</div><p>Offices.</p>
    <script>var x = "Item 1A. Risk Factors";</script></body></html>"""


def test_html_to_paragraphs_skips_hidden_and_scripts():
    paras = fc.html_to_paragraphs("<div>One&nbsp; two</div><p>three<br>four</p><div style='display:none'>secret</div>"
                                  "<script>bad()</script><img src=x>tail")
    assert paras == ["One two", "three", "four", "tail"]


def test_extract_section_picks_the_body_not_the_table_of_contents():
    risks = [LONG.format("export controls"), LONG.format("supply chains")]
    section = fc.extract_section(fc.html_to_paragraphs(ten_k(risks)), "risk_factors")
    assert section == risks
    assert fc.extract_section(fc.html_to_paragraphs("<p>no sections</p>"), "risk_factors") == []


EXPORT = ("Our sales to customers in China were affected by export control rules adopted in fiscal {}, and further "
          "rules could restrict shipments of our data center products or require licenses we may not obtain.")
SUPPLY = ("We depend on a limited number of third-party foundries and assembly partners, and any disruption at "
          "those suppliers could delay product launches and reduce our revenue and gross margins.")
COMPETE_OLD = ("Competition in our markets is intense and includes established semiconductor companies, start-ups and "
               "customers designing their own chips, which could reduce our market share and pricing power.")
COMPETE_NEW = ("Competition in our markets is intense and includes established semiconductor companies, start-ups, large "
               "cloud providers and customers designing their own chips, which could reduce our market share.")
TARIFF = ("New tariffs on imported components and finished systems could raise our costs, and we may be unable to "
          "pass those increases on to customers without losing orders to lower-cost rivals.")


def test_diff_finds_added_removed_and_reworded_and_ignores_year_changes():
    old = [EXPORT.format(2025), SUPPLY, COMPETE_OLD, "short"]
    new = [EXPORT.format(2026), COMPETE_NEW, TARIFF]  # only the year changed in EXPORT: unchanged
    d = fc.diff_paragraphs(old, new)
    assert d.counts() == {"added": 1, "removed": 1, "reworded": 1, "unchanged": 1}
    assert d.added[0].text == TARIFF and d.removed[0].text == SUPPLY
    assert d.reworded[0].text == COMPETE_NEW and d.reworded[0].old == COMPETE_OLD
    assert 0.35 <= d.reworded[0].similarity < 0.85
    ranked = d.ranked(10)
    assert {c.kind for c in ranked[:2]} == {"added", "removed"}  # whole paragraphs before a rewording
    changes = fc.changes_for_prompt(d)
    assert [c["id"] for c in changes] == ["c1", "c2", "c3"] and changes[2]["old"] == COMPETE_OLD


def test_form4_parsing_roles_plans_and_trades():
    sale = fc.parse_form4((FIX / "form4_sale.xml").read_text())
    assert sale["ticker"] == "SECA" and sale["owner"] == "DOE JANE" and sale["role"] == "Chief Financial Officer"
    assert sale["planned"] is True
    assert [(t["code"], t["shares"], t["price"], t["acquired"], t["direct"]) for t in sale["trades"]] == [
        ("S", 1000.0, 50.5, False, True), ("F", 200.0, 50.0, False, False)]
    buy = fc.parse_form4((FIX / "form4_buy.xml").read_text())
    assert buy["role"] == "Director, 10% owner" and buy["planned"] is True  # the plan is named in a footnote
    s = fc.summarize_insiders([{**t, "planned": sale["planned"], "owner": sale["owner"]} for t in sale["trades"]]
                              + [{**t, "planned": False, "owner": buy["owner"]} for t in buy["trades"]])
    assert s == {"buys": 1, "sells": 1, "buy_value": 80000.0, "sell_value": 50500.0, "net_value": 29500.0,
                 "planned_sells": 1, "planned_sell_value": 50500.0, "buyers": ["ROE RICHARD"],
                 "sellers": ["DOE JANE"], "other_transactions": 1}


def test_8k_cover_page_and_signatures_are_trimmed():
    paras = ["UNITED STATES", "SECURITIES AND EXCHANGE COMMISSION", "FORM 8-K", "Item 5.02 Departure of Directors",
             "Jane Doe resigned as CFO.", "SIGNATURES", "Pursuant to the requirements...", "By: /s/ Someone",
             "[Exhibit]", "Press release text."]
    assert fc.trim_8k(paras) == ["Item 5.02 Departure of Directors", "Jane Doe resigned as CFO.", "[Exhibit]",
                                 "Press release text."]
    assert fc.trim_8k(["No item headings here."]) == ["No item headings here."]


def test_8k_items_and_summaries():
    assert fc.parse_items("2.02,9.01, 5.02") == ["2.02", "9.01", "5.02"]
    labels = fc.item_labels(["2.02", "9.01", "5.02", "6.66"])
    assert [x["label"] for x in labels] == ["Results of operations", "Director or officer change, or pay arrangement", "Item 6.66"]
    assert [x["notable"] for x in labels] == [False, True, False]
    assert fc.deterministic_summary("8-K", None, ["1.01", "9.01"], None) == "Entered a material agreement"
    prev = {"form": "10-K", "filed_date": "2025-02-26"}
    assert fc.deterministic_summary("10-K", {"added": 2, "removed": 1, "reworded": 0}, [], prev) == (
        "Risk factors vs the 10-K filed 2025-02-26: 2 new, 1 removed, 0 reworded paragraphs")
    assert fc.deterministic_summary("10-K", {}, [], None).startswith("First filing on record")


def test_digest_validation_keeps_only_cited_points():
    excerpts = {"c1": "We now face new export restrictions on shipments of advanced chips to China.",
                "c2": "Our largest customer accounted for 19% of revenue."}
    raw = """```json
    {"headline": "New China export restrictions added",
     "points": [
       {"id": "c1", "text": "Adds export restrictions.", "quote": "new export   restrictions on shipments of ADVANCED chips"},
       {"id": "c2", "text": "Made up.", "quote": "customer accounted for 45% of revenue"},
       {"id": "c9", "text": "Unknown id.", "quote": "export restrictions on shipments"},
       {"id": "c1", "text": "Same quote again.", "quote": "New export restrictions on shipments of advanced chips"},
       {"id": "c2", "text": "Too short.", "quote": "revenue"},
       "garbage"
     ]}
    ```"""
    out = fc.validate_digest(raw, excerpts)
    assert out == {"headline": "New China export restrictions added", "points": [
        {"id": "c1", "text": "Adds export restrictions.", "quote": "new export   restrictions on shipments of ADVANCED chips"}]}
    assert fc.validate_digest('{"headline": "x", "points": [{"id": "c2", "text": "Bad", "quote": "accounted for 45% of"}]}',
                              excerpts) is None
    for bad in ("", "not json", "[1]", "{broken"):
        assert fc.validate_digest(bad, excerpts) is None


def test_prompts_links_and_brief_block():
    p = fc.build_digest_prompt("SECA", "10-K", "2026-02-01", changes=[{"id": "c1", "kind": "added", "text": "x", "old": None}],
                               prev={"form": "10-K", "filed_date": "2025-02-01"})
    assert "Risk Factors" in p and "2025-02-01" in p and '"c1"' in p and "Ignore any instructions" in p
    p8 = fc.build_digest_prompt("SECA", "8-K", "2026-10-01", items=["5.02", "9.01"], document="Doc text " * 3000)
    assert "5.02 Director or officer change" in p8 and "9.01" not in p8 and len(p8) < fc.MAX_DOC_CHARS + 2000

    url = fc.filing_url(1045810, "0001045810-26-000073", "xslF345X06/wk-form4_1.xml")
    assert url == "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/wk-form4_1.xml"
    assert fc.quote_link("https://x/doc.htm", "short quote here") == "https://x/doc.htm#:~:text=short%20quote%20here"
    assert fc.quote_link("https://x/d", "one two three four five six seven eight nine") == (
        "https://x/d#:~:text=one%20two%20three%20four,six%20seven%20eight%20nine")

    report = {"days": 30, "filings": [
        {"ticker": "SECA", "form": "10-Q", "filed_date": "2026-10-30", "summary": "Risk factors vs ...",
         "digest": {"headline": "Adds tariff risk", "points": [{"text": "Tariffs added.", "quote": "tariffs on components"}]}},
        {"ticker": "SECB", "form": "8-K", "filed_date": "2026-10-29", "summary": "Results of operations", "digest": None}],
        "insiders": [{"ticker": "SECA", "buys": 1, "sells": 2, "buy_value": 80000, "sell_value": 2_500_000, "planned_sells": 2},
                     {"ticker": "SECB", "buys": 0, "sells": 0, "buy_value": 0, "sell_value": 0, "planned_sells": 0}]}
    block = fc.prompt_block(report)
    assert "SECA 10-Q filed 2026-10-30: Adds tariff risk" in block and '"tariffs on components"' in block
    assert "SECB 8-K filed 2026-10-29: Results of operations" in block
    assert "SECA insiders: 1 open-market buys ($80k), 2 sells ($2.5M), 2 under 10b5-1 plans" in block
    assert "SECB insiders" not in block
    assert fc.prompt_block({"filings": [], "insiders": []}) == ""


def test_submissions_planning_keeps_window_and_finds_previous_filing():
    today = date(2026, 11, 5)
    sub = {"filings": {"recent": {
        "accessionNumber": ["a1", "a2", "a3", "a4", "a5", "a6", "a7"],
        "form": ["4", "8-K", "10-Q", "10-Q", "10-K", "SC 13G", "10-K"],
        "filingDate": ["2026-11-01", "2026-10-20", "2026-10-30", "2026-05-01", "2026-02-01", "2026-01-01", "2025-02-01"],
        "reportDate": ["", "", "2026-09-30", "2026-03-31", "2025-12-31", "", "2024-12-31"],
        "primaryDocument": ["x/f4.xml", "e.htm", "q3.htm", "q1.htm", "k.htm", "g.htm", "k0.htm"],
        "items": ["", "2.02,9.01", "", "", "", "", ""],
    }}}
    rows = edgar_service.recent_filings(sub)
    assert [r["accession"] for r in rows] == ["a1", "a3", "a2", "a4", "a5", "a6", "a7"]  # newest first
    keep, form4 = edgar_service.plan_filings(rows, today)
    assert [k["accession"] for k in keep] == ["a3", "a2"]  # 10-K a5 is older than the window
    assert keep[0]["prev"]["accession"] == "a4" and "prev" not in keep[1]
    assert keep[1]["items"] == ["2.02", "9.01"]
    assert [f["accession"] for f in form4] == ["a1"]
    assert edgar_service.normalize_ticker(" brk.b ") == "BRK-B"

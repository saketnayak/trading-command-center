#!/usr/bin/env python3
"""Patches the installed TradingAgents library to add technical analyst support."""

import os
import re
import shutil
import site
import sys

def find_pkg() -> str:
    for sp in site.getsitepackages():
        p = os.path.join(sp, "tradingagents")
        if os.path.isdir(p):
            return p
    raise RuntimeError("tradingagents package not found in site-packages")

pkg = find_pkg()
print(f"Patching TradingAgents at: {pkg}")

# ── 1. Copy technical_analyst.py into the analysts directory ─────────────────
src = os.path.join(os.path.dirname(__file__), "technical_analyst.py")
dst = os.path.join(pkg, "agents/analysts/technical_analyst.py")
shutil.copy(src, dst)
print(f"  ✓ Copied technical_analyst.py → {dst}")

# ── 2. Patch agent_states.py — add technical_report field ────────────────────
states_path = os.path.join(pkg, "agents/utils/agent_states.py")
with open(states_path) as f:
    content = f.read()

if "technical_report" not in content:
    content = content.replace(
        '    fundamentals_report: str = Field(',
        (
            '    technical_report: str = Field(\n'
            '        default="",\n'
            '        title="Technical Report",\n'
            '        description="Technical analysis report produced by the Technical Analyst",\n'
            '    )\n'
            '    fundamentals_report: str = Field('
        ),
    )
    with open(states_path, "w") as f:
        f.write(content)
    print("  ✓ Patched agent_states.py — added technical_report field")
else:
    print("  · agent_states.py already patched")

# ── 3. Patch conditional_logic.py — add should_continue_technical ─────────────
cond_path = os.path.join(pkg, "graph/conditional_logic.py")
with open(cond_path) as f:
    content = f.read()

if "should_continue_technical" not in content:
    new_method = (
        '    def should_continue_technical(\n'
        '        self, state: AgentState\n'
        '    ) -> Literal["tools_technical", "Msg Clear Technical"]:\n'
        '        """Determine whether to continue technical analysis or clear messages."""\n'
        '        return "tools_technical" if state.messages[-1].tool_calls else "Msg Clear Technical"\n'
        '\n'
    )
    content = content.replace(
        "    def should_continue_debate(",
        new_method + "    def should_continue_debate(",
    )
    # Extend the Literal import to include the new strings
    content = content.replace(
        "from typing import Literal",
        "from typing import Literal",
    )
    with open(cond_path, "w") as f:
        f.write(content)
    print("  ✓ Patched conditional_logic.py — added should_continue_technical")
else:
    print("  · conditional_logic.py already patched")

# ── 4. Patch graph/setup.py — add technical to SUPPORTED_ANALYSTS and analyst_creators ───────────────
setup_path = os.path.join(pkg, "graph/setup.py")
with open(setup_path) as f:
    content = f.read()

if '"technical": create_technical_analyst' not in content:
    # Add import
    content = content.replace(
        "from tradingagents.agents import (",
        "from tradingagents.agents import (\n    create_technical_analyst,",
    )
    # Add to analyst_creators dict
    content = content.replace(
        '"fundamentals": create_fundamentals_analyst,',
        '"fundamentals": create_fundamentals_analyst,\n            "technical": create_technical_analyst,',
    )
    with open(setup_path, "w") as f:
        f.write(content)
    print("  ✓ Patched setup.py — added technical to analyst_creators")
else:
    print("  · setup.py analyst_creators already patched")

# SUPPORTED_ANALYSTS is a separate tuple constant used by validate_selected_analysts;
# it must be patched independently of analyst_creators.
with open(setup_path) as f:
    content = f.read()
_old_supported = 'SUPPORTED_ANALYSTS = ("market", "social", "news", "fundamentals")'
_new_supported = 'SUPPORTED_ANALYSTS = ("market", "social", "news", "fundamentals", "technical")'
if _old_supported in content:
    content = content.replace(_old_supported, _new_supported)
    with open(setup_path, "w") as f:
        f.write(content)
    print("  ✓ Patched setup.py — added technical to SUPPORTED_ANALYSTS")
else:
    print("  · setup.py SUPPORTED_ANALYSTS already patched")

# ── 5. Patch agents/__init__.py — export create_technical_analyst ─────────────
init_path = os.path.join(pkg, "agents/__init__.py")
with open(init_path) as f:
    content = f.read()

if "create_technical_analyst" not in content:
    content = content.replace(
        "from .analysts.social_media_analyst import create_social_media_analyst",
        (
            "from .analysts.social_media_analyst import create_social_media_analyst\n"
            "from .analysts.technical_analyst import create_technical_analyst"
        ),
    )
    content = content.replace(
        '    "create_social_media_analyst",',
        '    "create_social_media_analyst",\n    "create_technical_analyst",',
    )
    with open(init_path, "w") as f:
        f.write(content)
    print("  ✓ Patched agents/__init__.py — exported create_technical_analyst")
else:
    print("  · agents/__init__.py already patched")

# ── 6. Patch trading_graph.py — add "technical" to tool_nodes ────────────────
graph_path = os.path.join(pkg, "graph/trading_graph.py")
with open(graph_path) as f:
    content = f.read()

if '"technical": ToolNode' not in content:
    new_content = re.sub(
        r'("fundamentals":\s*ToolNode\(\[.*?\]\s*\))',
        r'\1\n            "technical": ToolNode([get_stock_data, get_indicators])',
        content,
        flags=re.DOTALL,
    )
    if new_content == content:
        print("  ✗ ERROR: trading_graph.py patch did not match — check library version")
        sys.exit(1)
    with open(graph_path, "w") as f:
        f.write(new_content)
    print("  ✓ Patched trading_graph.py — added technical ToolNode")
else:
    print("  · trading_graph.py already patched")

# ── 7. Patch technical_indicators_tools.py — fix list branch comma-splitting ──
indicators_path = os.path.join(pkg, "agents/utils/technical_indicators_tools.py")
with open(indicators_path) as f:
    content = f.read()

old_else = (
    "    else:\n"
    "        indicators = [ind.strip() for ind in indicator if ind and ind.strip()]"
)
new_else = (
    "    else:\n"
    "        indicators = []\n"
    "        for _ind in indicator:\n"
    "            if _ind and _ind.strip():\n"
    "                indicators.extend([i.strip() for i in _ind.split(',') if i.strip()])"
)

if "indicators.extend" not in content:
    new_content = content.replace(old_else, new_else)
    if new_content == content:
        print("  ✗ WARNING: technical_indicators_tools.py patch did not match — check library version")
    else:
        with open(indicators_path, "w") as f:
            f.write(new_content)
        print("  ✓ Patched technical_indicators_tools.py — fixed list branch comma-splitting")
else:
    print("  · technical_indicators_tools.py already patched")

print("All patches applied successfully.")

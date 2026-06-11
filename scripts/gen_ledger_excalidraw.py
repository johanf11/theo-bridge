#!/usr/bin/env python3
"""Generate an Excalidraw walkthrough of Theo's double-entry ledger transactions.

Each major posting (as actually implemented in the edge functions) is drawn as a
journal card. Debit/credit lines are colored, balanced per currency, and annotated
with the effect on each account given its normal balance.
Output: ~/Desktop/ledger-flows.excalidraw

NOTE: The committed diagram (docs/ledger-flows.excalidraw) has since been
hand-edited in Excalidraw (card positions, sizing). This script reproduces the
ORIGINAL auto-generated layout and is kept for reference / as a starting point if
the postings change — re-running it will NOT preserve the manual layout edits.
"""
import json, os, random, time

# ── Chart of accounts: code -> (type, currency, normal_balance) ──────────────
ACC = {
    "SPIH_BANK_HTG":                  ("ASSET",     "HTG",  "DR"),
    "CUSTOMER_HTG_PENDING":           ("LIABILITY", "HTG",  "CR"),
    "CUSTOMER_HTG_SETTLED":           ("LIABILITY", "HTG",  "CR"),
    "FX_CLEARING_HTG":                ("LIABILITY", "HTG",  "CR"),
    "FX_CLEARING_USDC":               ("LIABILITY", "USDC", "CR"),
    "DISTRIBUTOR_USDC":               ("ASSET",     "USDC", "DR"),
    "TREASURY_USDC":                  ("ASSET",     "USDC", "DR"),
    "BLEND_DEPOSITS_USDC":            ("ASSET",     "USDC", "DR"),
    "CUSTOMER_USDC_PAYABLE":          ("LIABILITY", "USDC", "CR"),
    "CUSTOMER_BLEND_PAYABLE":         ("LIABILITY", "USDC", "CR"),
    "FEE_REVENUE_USDC":               ("REVENUE",   "USDC", "CR"),
    "HTGC_ISSUED":                    ("LIABILITY", "HTG",  "CR"),
    "EXTERNAL_COUNTERPARTY_FLOW_USDC":("LIABILITY", "USDC", "CR"),
}

# ── Transactions: (kind, plain_english, [ (side, code, amount, currency), ... ]) ──
# side is "DR" or "CR". Amounts are an illustrative worked example.
TXNS = [
    ("SECTION", "ON-RAMP  ·  HTG cash  →  USDC in customer wallet", None),
    ("SPIH_CASH_IN", "HTG cash arrives at the SPIH partner bank", [
        ("DR", "SPIH_BANK_HTG",        1_300_000, "HTG"),
        ("CR", "CUSTOMER_HTG_PENDING", 1_300_000, "HTG"),
    ]),
    ("FX_CONVERSION", "Book the HTG→USDC conversion (rate 130, 2% fee)", [
        ("DR", "CUSTOMER_HTG_PENDING", 1_300_000, "HTG"),
        ("CR", "FX_CLEARING_HTG",      1_300_000, "HTG"),
        ("DR", "FX_CLEARING_USDC",        10_000, "USDC"),
        ("CR", "CUSTOMER_USDC_PAYABLE",    9_800, "USDC"),
        ("CR", "FEE_REVENUE_USDC",           200, "USDC"),
    ]),
    ("DISTRIBUTOR_AUTO_MINT", "Top up the hot wallet from treasury (if short)", [
        ("DR", "DISTRIBUTOR_USDC", 9_800, "USDC"),
        ("CR", "TREASURY_USDC",    9_800, "USDC"),
    ]),
    ("USDC_PAYOUT", "Release USDC from hot wallet to the customer", [
        ("DR", "CUSTOMER_USDC_PAYABLE", 9_800, "USDC"),
        ("CR", "DISTRIBUTOR_USDC",      9_800, "USDC"),
    ]),

    ("SECTION", "HTG-C  ·  deposit float & redemption", None),
    ("HTGC_MINT", "Deposit kept as HTG-C (1:1 float against bank)", [
        ("DR", "SPIH_BANK_HTG", 500_000, "HTG"),
        ("CR", "HTGC_ISSUED",   500_000, "HTG"),
    ]),
    ("HTGC_WITHDRAWAL", "Redeem HTG-C back to HTG cash (clawback-burn)", [
        ("DR", "HTGC_ISSUED",   500_000, "HTG"),
        ("CR", "SPIH_BANK_HTG", 500_000, "HTG"),
    ]),

    ("SECTION", "SWAPS  ·  two currencies in one balanced posting", None),
    ("htgc_to_usdc_swap", "HTG-C → USDC swap (gross 10k, fee 200, net 9.8k)", [
        ("DR", "SPIH_BANK_HTG",         1_300_000, "HTG"),
        ("CR", "FX_CLEARING_HTG",       1_300_000, "HTG"),
        ("DR", "CUSTOMER_USDC_PAYABLE",    10_000, "USDC"),
        ("CR", "DISTRIBUTOR_USDC",          9_800, "USDC"),
        ("CR", "FEE_REVENUE_USDC",            200, "USDC"),
    ]),
    ("usdc_to_htgc_swap", "USDC → HTG-C swap (gross 10k, fee 200, net 9.8k)", [
        ("DR", "TREASURY_USDC",         10_000, "USDC"),
        ("CR", "CUSTOMER_USDC_PAYABLE",  9_800, "USDC"),
        ("CR", "FEE_REVENUE_USDC",         200, "USDC"),
        ("DR", "FX_CLEARING_HTG",    1_274_000, "HTG"),
        ("CR", "SPIH_BANK_HTG",      1_274_000, "HTG"),
    ]),

    ("SECTION", "OUT  ·  external payout & yield sweep", None),
    ("PAYOUT_USDC", "Send USDC to an external counterparty", [
        ("DR", "CUSTOMER_USDC_PAYABLE",            5_000, "USDC"),
        ("CR", "EXTERNAL_COUNTERPARTY_FLOW_USDC",  5_000, "USDC"),
    ]),
    ("BLEND_DEPOSIT", "Sweep idle USDC into Blend for yield", [
        ("DR", "BLEND_DEPOSITS_USDC",    2_000, "USDC"),
        ("CR", "CUSTOMER_BLEND_PAYABLE", 2_000, "USDC"),
    ]),
]

# ── Colors ───────────────────────────────────────────────────────────────────
INK      = "#1a1a2e"
BLUE     = "#33359A"   # theo blue
DEBIT    = "#1971c2"   # debit lines
CREDIT   = "#2f9e44"   # credit lines
MID      = "#6b6b8a"
CARD_BG  = "#ffffff"
HTG_BG   = "#fff9e8"   # warm tint for HTG-heavy
USDC_BG  = "#eef0fb"   # theo-blue-soft
SEC_BG   = "#33359A"
LEG_BG   = "#f9f8f5"

elements = []
def _ids():
    return "".join(random.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(12))

def rect(x, y, w, h, bg, stroke=INK, sw=1, radius=12, group=None):
    elements.append({
        "id": _ids(), "type": "rectangle", "x": x, "y": y, "width": w, "height": h,
        "angle": 0, "strokeColor": stroke, "backgroundColor": bg, "fillStyle": "solid",
        "strokeWidth": sw, "strokeStyle": "solid", "roughness": 0, "opacity": 100,
        "groupIds": [group] if group else [], "frameId": None,
        "roundness": {"type": 3} if radius else None, "seed": random.randint(1, 2**31),
        "version": 1, "versionNonce": random.randint(1, 2**31), "isDeleted": False,
        "boundElements": [], "updated": int(time.time()*1000), "link": None, "locked": False,
    })

def text(x, y, s, size=14, color=INK, font=3, w=None, align="left", group=None):
    lines = s.split("\n")
    cw = size * 0.6 if font == 3 else size * 0.52
    width = w if w else max((len(l) for l in lines), default=1) * cw + 4
    height = len(lines) * size * 1.25
    elements.append({
        "id": _ids(), "type": "text", "x": x, "y": y, "width": width, "height": height,
        "angle": 0, "strokeColor": color, "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid", "roughness": 0,
        "opacity": 100, "groupIds": [group] if group else [], "frameId": None,
        "roundness": None, "seed": random.randint(1, 2**31), "version": 1,
        "versionNonce": random.randint(1, 2**31), "isDeleted": False, "boundElements": [],
        "updated": int(time.time()*1000), "link": None, "locked": False,
        "text": s, "fontSize": size, "fontFamily": font, "textAlign": align,
        "verticalAlign": "top", "baseline": int(height-4), "containerId": None,
        "originalText": s, "lineHeight": 1.25,
    })

def fmt(n):
    return f"{n:,}"

def effect(side, code):
    typ, cur, normal = ACC[code]
    inc = (side == normal)
    return ("↑" if inc else "↓"), typ.lower()

# ── Layout ───────────────────────────────────────────────────────────────────
CARD_W = 560
COL_X  = [40, 660]            # two columns
LINE_H = 24
PAD    = 14
TITLE_H = 46

# Legend / accounting rule box (top, full width)
lx, ly, lw = 40, 40, 1180
rect(lx, ly, lw, 150, LEG_BG, stroke=BLUE, sw=2)
text(lx+18, ly+14, "Theo double-entry ledger — how each transaction moves through normal balances", 18, BLUE, font=2)
text(lx+18, ly+46,
     "RULE OF NORMAL BALANCE        Every posting balances per currency:  Σ debits = Σ credits",
     14, INK, font=3)
text(lx+18, ly+72,
     "ASSET / EXPENSE   normal = DEBIT    →   DEBIT ↑ increases   ·   CREDIT ↓ decreases",
     14, DEBIT, font=3)
text(lx+18, ly+96,
     "LIABILITY / EQUITY / REVENUE   normal = CREDIT   →   CREDIT ↑ increases   ·   DEBIT ↓ decreases",
     14, CREDIT, font=3)
text(lx+18, ly+122,
     "Dr lines (blue) read first, Cr lines (green) indented below.  ↑/↓ shows the effect on that account.",
     13, MID, font=3)

def draw_card(x, y, kind, desc, entries):
    curs = {c for _, _, _, c in entries}
    bg = USDC_BG if curs == {"USDC"} else (HTG_BG if curs == {"HTG"} else "#f3f0fb")
    n = len(entries)
    card_h = TITLE_H + n * LINE_H + 18 + PAD
    g = _ids()
    rect(x, y, CARD_W, card_h, bg, stroke=INK, sw=1, group=g)
    text(x+14, y+10, kind, 15, INK, font=2, group=g)
    text(x+14, y+30, desc, 12, MID, font=3, group=g)
    ly2 = y + TITLE_H + 4
    for side, code, amt, cur in entries:
        arrow, typ = effect(side, code)
        color = DEBIT if side == "DR" else CREDIT
        label = "Dr" if side == "DR" else "  Cr"
        amts = f"{fmt(amt)} {cur}"
        line = f"{label:<4} {code:<31} {amts:>16}   {arrow} {typ}"
        text(x+16, ly2, line, 13, color, font=3, group=g)
        ly2 += LINE_H
    sums = {}
    for side, code, amt, cur in entries:
        sums.setdefault(cur, [0, 0])
        sums[cur][0 if side == "DR" else 1] += amt
    chk = "   ".join(f"{c}: Dr {fmt(d)} = Cr {fmt(cr)} ✓" for c, (d, cr) in sums.items())
    text(x+16, ly2+2, chk, 11, MID, font=3, group=g)
    return card_h

# Walk sections; each section = full-width banner, then its cards in 2 columns.
y = 230
pending = []  # cards buffered for the current section

def flush(pending, y):
    """Lay buffered cards in 2 columns; return new y below the tallest row."""
    i = 0
    while i < len(pending):
        row = pending[i:i+2]
        heights = []
        for j, (k, d, e) in enumerate(row):
            heights.append(draw_card(COL_X[j], y, k, d, e))
        y += max(heights) + 22
        i += 2
    return y

for kind, desc, entries in TXNS:
    if kind == "SECTION":
        if pending:
            y = flush(pending, y)
            pending = []
        rect(40, y, 1180, 34, SEC_BG, stroke=SEC_BG)
        text(54, y+8, desc, 15, "#ffffff", font=2)
        y += 34 + 14
        continue
    pending.append((kind, desc, entries))
if pending:
    y = flush(pending, y)

out = {
    "type": "excalidraw",
    "version": 2,
    "source": "https://theo-bridge/ledger-flows",
    "elements": elements,
    "appState": {"gridSize": None, "viewBackgroundColor": "#ffffff"},
    "files": {},
}

dest = os.path.expanduser("~/Desktop/ledger-flows.excalidraw")
with open(dest, "w") as f:
    json.dump(out, f, indent=2, ensure_ascii=False)
print(f"wrote {dest}  ({len(elements)} elements, {sum(1 for t in TXNS if t[0] not in ('SECTION',))} transactions)")

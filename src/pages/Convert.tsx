import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/theo/Layout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth, useRoles } from "@/lib/auth";
import { fetchHorizonBalances } from "@/lib/balance";
import { X, Plus, Building2, CheckCircle2, ArrowUpDown, Loader2, Info, Globe2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Tab = "htg" | "swap" | "off" | "wire";
type KybStatus = "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
type Profile = { kyb_status: KybStatus; stellar_wallet_address: string | null; fee_bps: number; corridor_bps: number };
type WalletOption = { id: string; label: string; stellar_address: string };
type BankAccount = { id: string; bank_name: string; account_name: string; account_number: string; routing_code: string | null; is_default: boolean };

const HAITI_BANKS = [
  "BNC (Banque Nationale de Crédit)",
  "Sogebank",
  "Unibank",
  "BH (Banque de l'Habitat)",
  "Capital Bank",
  "Scotiabank Haïti",
  "Citibank Haïti",
  "Fonkoze",
  "Other",
];

export default function Convert() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useRoles();

  const [tab, setTab] = useState<Tab>("htg");
  // Tab 1: Deposit HTG → mint HTG-C (1:1) OR auto-convert to USDC
  const [htgReceiveMode, setHtgReceiveMode] = useState<"htgc" | "usdc">("usdc");
  const [htgAmount, setHtgAmount] = useState("50,000");
  const [htgAmountRaw, setHtgAmountRaw] = useState(50000);
  const [htgBusy, setHtgBusy] = useState(false);
  // Two-field widget (HTG → USDC mode): mirrored USDC net side
  const [htgUsdcNetRaw, setHtgUsdcNetRaw] = useState(0);
  const [htgUsdcNetDisplay, setHtgUsdcNetDisplay] = useState("");
  const [htgLastEdited, setHtgLastEdited] = useState<"htg" | "usdc">("htg");
  const [htgFlipped, setHtgFlipped] = useState(false);
  // Tab 2: HTG-C ↔ USDC
  const [swapDir, setSwapDir] = useState<"htgc_to_usdc" | "usdc_to_htgc">("htgc_to_usdc");
  const [swapAmount, setSwapAmount] = useState("5,000");
  const [swapAmountRaw, setSwapAmountRaw] = useState(5000);
  const [swapBusy, setSwapBusy] = useState(false);
  const [walletBalances, setWalletBalances] = useState<{ usdc: number; htgc: number }>({ usdc: 0, htgc: 0 });
  const [balLoading, setBalLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [lifetimeSavings, setLifetimeSavings] = useState(0);
  const [spotRate, setSpotRate] = useState<number | null>(null);
  const [liveRate, setLiveRate] = useState<number | null>(null);
  const [rateSource, setRateSource] = useState<"brh" | "cache" | "seed">("seed");
  const [rateCapturedAt, setRateCapturedAt] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(true);
  const [usdcRaw, setUsdcRaw] = useState(10000);
  const [usdcDisplay, setUsdcDisplay] = useState("10,000");
  const [lockSecs, setLockSecs] = useState(15 * 60);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockedRef, setLockedRef] = useState("");
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>("");

  // ── Off-ramp state ──────────────────────────────────────────────────────
  const [offAmount, setOffAmount] = useState("5,000");
  const [offAmountRaw, setOffAmountRaw] = useState(5000);
  const [offSourceWallet, setOffSourceWallet] = useState<string>("");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBank, setSelectedBank] = useState<string>("");
  const [bankLoading, setBankLoading] = useState(false);
  const [showAddBank, setShowAddBank] = useState(false);
  const [offConfirm, setOffConfirm] = useState(false);
  const [offBusy, setOffBusy] = useState(false);
  const [offHtgcBalance, setOffHtgcBalance] = useState<number | null>(null);
  const [offHtgcLoading, setOffHtgcLoading] = useState(false);

  // ── International wire state ────────────────────────────────────────────
  const [wireSourceWallet, setWireSourceWallet] = useState<string>("");
  const [wireRecipientName, setWireRecipientName] = useState("");
  const [wireSwift, setWireSwift] = useState("");
  const [wireIban, setWireIban] = useState("");
  const [wireBankCity, setWireBankCity] = useState("");
  const [wireAmountRaw, setWireAmountRaw] = useState(0);
  const [wireAmountDisplay, setWireAmountDisplay] = useState("");
  const [wireBusy, setWireBusy] = useState(false);

  // Add bank form
  const [addBankName, setAddBankName] = useState("");
  const [addAccountName, setAddAccountName] = useState("");
  const [addAccountNumber, setAddAccountNumber] = useState("");
  const [addRoutingCode, setAddRoutingCode] = useState("");
  const [addBankBusy, setAddBankBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setProfileLoading(true);
    supabase.from("customers").select("id, kyb_status, stellar_wallet_address, fee_bps, corridor_bps").eq("user_id", user.id).maybeSingle().then(async ({ data }) => {
      if (cancelled) return;
      setProfile(data as Profile | null);
      setProfileLoading(false);

      if (data?.id) {
        const { data: ws } = await supabase
          .from("wallets")
          .select("id, label, stellar_address")
          .eq("customer_id", data.id)
          .order("created_at", { ascending: true });
        if (cancelled) return;
        const opts: WalletOption[] = (ws ?? []).map((w) => ({
          id: w.id,
          label: w.label ?? "Wallet",
          stellar_address: w.stellar_address,
        }));
        setWalletOptions(opts);
        if (opts.length > 0) {
          setSelectedWallet(opts[0].stellar_address);
          setOffSourceWallet(opts[0].id);
        } else {
          setSelectedWallet("");
        }

        // Load bank accounts
        setBankLoading(true);
        const { data: banks } = await supabase
          .from("bank_accounts")
          .select("id, bank_name, account_name, account_number, routing_code, is_default")
          .eq("customer_id", data.id)
          .order("is_default", { ascending: false });
        if (!cancelled) {
          const b = (banks ?? []) as BankAccount[];
          setBankAccounts(b);
          const def = b.find((x) => x.is_default) ?? b[0];
          if (def) setSelectedBank(def.id);
          setBankLoading(false);
        }


        // Lifetime savings: completed orders' usdc_amount × (5% − totalBps/10_000)
        const { data: lifetimeOrders } = await supabase
          .from("orders")
          .select("usdc_amount")
          .eq("customer_id", data.id)
          .eq("status", "COMPLETED");
        if (!cancelled) {
          const totalBpsLocal = (data.fee_bps ?? 130) + (data.corridor_bps ?? 70);
          const feeRate = totalBpsLocal / 10_000;
          const sum = (lifetimeOrders ?? []).reduce((s, o: any) => {
            const u = Number(o.usdc_amount ?? 0);
            return s + u * 0.05 - u * feeRate;
          }, 0);
          setLifetimeSavings(Math.max(0, sum));
        }
      }
    });
    // Fetch live BRH reference rate.
    // Falls back to latest rate_snapshots row if edge function isn't deployed yet.
    const applyRate = (spot: number, source: string, capturedAt?: string) => {
      if (cancelled) return;
      setSpotRate(spot);
      setLiveRate(spot);
      setRateSource(source as "brh" | "cache" | "seed");
      setRateCapturedAt(capturedAt ?? null);
      setRateLoading(false);
    };

    supabase.functions.invoke("fetch-brh-rate")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data?.rate) {
          applyRate(Number(data.rate), data.source ?? "brh", data.captured_at);
        } else {
          // Edge function not deployed yet — read directly from rate_snapshots
          supabase
            .from("rate_snapshots")
            .select("spot_rate, source, captured_at")
            .order("captured_at", { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data: snap }) => {
              applyRate(Number(snap?.spot_rate ?? 130), snap?.source ?? "cache", snap?.captured_at);
            });
        }
      })
      .catch(() => {
        if (cancelled) return;
        supabase
          .from("rate_snapshots")
          .select("spot_rate, source, captured_at")
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data: snap }) => {
            applyRate(Number(snap?.spot_rate ?? 130), snap?.source ?? "cache", snap?.captured_at);
          });
      });

    return () => { cancelled = true; };
  }, [user]);

  // Fetch live wallet balances whenever the selected wallet address changes
  useEffect(() => {
    if (!selectedWallet || !selectedWallet.startsWith("G")) {
      setWalletBalances({ usdc: 0, htgc: 0 });
      return;
    }
    let cancelled = false;
    setBalLoading(true);
    fetchHorizonBalances(selectedWallet).then((bals) => {
      if (!cancelled) { setWalletBalances(bals); setBalLoading(false); }
    });
    return () => { cancelled = true; };
  }, [selectedWallet]);

  // Fetch HTG-C balance for the off-ramp source wallet
  useEffect(() => {
    const wallet = walletOptions.find((w) => w.id === offSourceWallet);
    if (!wallet?.stellar_address?.startsWith("G")) {
      setOffHtgcBalance(null);
      return;
    }
    let cancelled = false;
    setOffHtgcLoading(true);
    fetchHorizonBalances(wallet.stellar_address).then((bals) => {
      if (!cancelled) { setOffHtgcBalance(bals.htgc); setOffHtgcLoading(false); }
    });
    return () => { cancelled = true; };
  }, [offSourceWallet, walletOptions, offBusy]);

  // No random ticker — rate is BRH official, only refreshes on page load.

  // Countdown
  useEffect(() => {
    const id = setInterval(() => setLockSecs((s) => (s <= 1 ? 15 * 60 : s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  // Sync the non-edited side when liveRate or fee bps change
  useEffect(() => {
    if (!liveRate || liveRate <= 0) return;
    const f = ((profile?.fee_bps ?? 130) + (profile?.corridor_bps ?? 70)) / 10_000;
    if (htgLastEdited === "htg") {
      const gross = htgAmountRaw / liveRate;
      const net = gross * (1 - f);
      setHtgUsdcNetRaw(net);
      setHtgUsdcNetDisplay(net > 0 ? net.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
    } else {
      const denom = 1 - f;
      const gross = denom > 0 ? htgUsdcNetRaw / denom : 0;
      const htg = gross * liveRate;
      setHtgAmountRaw(htg);
      setHtgAmount(htg > 0 ? Math.round(htg).toLocaleString("en-US") : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRate, profile?.fee_bps, profile?.corridor_bps]);


  const handleUsdcInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d]/g, "");
    const num = parseInt(raw, 10) || 0;
    setUsdcRaw(num);
    setUsdcDisplay(num ? num.toLocaleString("en-US") : "");
  };

  const htg = liveRate ? Math.round(usdcRaw * liveRate) : null;
  const timerLabel = `${Math.floor(lockSecs / 60)}:${String(lockSecs % 60).padStart(2, "0")}`;
  const canQuote = profile?.kyb_status === "APPROVED" && !profileLoading && !rateLoading;

  // Fee breakdown — bps applied to USDC notional
  const feeBps      = profile?.fee_bps      ?? 130; // Theo net margin
  const corridorBps = profile?.corridor_bps ?? 70;  // MoneyGram corridor
  const totalBps    = feeBps + corridorBps;
  const feeUSDC     = usdcRaw * (totalBps / 10_000);
  const fmtFee = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const [showFeeBreakdown, setShowFeeBreakdown] = useState(false);

  const submit = async () => {
    if (!canQuote) { toast.error("KYB approval required"); return; }
    if (usdcRaw < 1000 || usdcRaw > 52000) { toast.error("Enter an amount between 1,000 and 50,000 USDC"); return; }
    if (!selectedWallet) { toast.error("Please select a destination account"); return; }
    try {
      setBusy(true);
      const { data, error } = await supabase.functions.invoke("create-quote", {
        body: { usdc_amount: usdcRaw, destination_wallet_address: selectedWallet },
      });
      if (error || data?.error) { toast.error(data?.error || error?.message || "Quote failed"); return; }
      setLocked(true);
      setLockedRef(data.reference_number);
      toast.success(`Rate locked. Reference ${data.reference_number}`);
      navigate(`/orders/${data.quote_id}`);
    } finally {
      setBusy(false);
    }
  };

  const approveTestKyb = async () => {
    if (!user) return;
    const existing = profile?.stellar_wallet_address ?? "";
    const wallet = window.prompt(
      "Account ID for USDC release:",
      existing.startsWith("G") ? existing : "",
    );
    if (!wallet || !wallet.startsWith("G") || wallet.length < 50) {
      toast.error("Valid account ID required");
      return;
    }
    setBusy(true);
    const { data } = await supabase
      .from("customers")
      .update({ kyb_status: "APPROVED", stellar_wallet_address: wallet.trim() })
      .eq("user_id", user.id)
      .select("kyb_status, stellar_wallet_address")
      .maybeSingle();
    setBusy(false);
    setProfile(data as Profile | null);
    toast.success("KYB approved + wallet saved");
  };

  const handleOffAmountInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    const intPart = parts[0].replace(/^0+(?=\d)/, "");
    const decPart = parts.length > 1 ? parts.slice(1).join("").slice(0, 2) : null;
    const normalized = decPart !== null ? `${intPart || "0"}.${decPart}` : intPart;
    const num = parseFloat(normalized) || 0;
    setOffAmountRaw(num);
    const intFormatted = intPart ? Number(intPart).toLocaleString("en-US") : "";
    const display = decPart !== null ? `${intFormatted || "0"}.${decPart}` : intFormatted;
    setOffAmount(display);
  };

  const loadBankAccounts = async () => {
    const { data: c } = await supabase.from("customers").select("id").maybeSingle();
    if (!c) return;
    const { data: banks } = await supabase
      .from("bank_accounts")
      .select("id, bank_name, account_name, account_number, routing_code, is_default")
      .eq("customer_id", c.id)
      .order("is_default", { ascending: false });
    const b = (banks ?? []) as BankAccount[];
    setBankAccounts(b);
    const def = b.find((x) => x.is_default) ?? b[0];
    if (def) setSelectedBank(def.id);
  };

  const handleAddBank = async () => {
    if (!addBankName || !addAccountName || !addAccountNumber) {
      toast.error("Please fill in all required fields");
      return;
    }
    setAddBankBusy(true);
    const { data: c } = await supabase.from("customers").select("id").maybeSingle();
    if (!c) { toast.error("Customer not found"); setAddBankBusy(false); return; }

    const isFirst = bankAccounts.length === 0;
    const { data, error } = await supabase
      .from("bank_accounts")
      .insert({
        customer_id: c.id,
        bank_name: addBankName,
        account_name: addAccountName,
        account_number: addAccountNumber,
        routing_code: addRoutingCode || null,
        is_default: isFirst,
      })
      .select()
      .single();
    setAddBankBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Bank account added");
    setShowAddBank(false);
    setAddBankName(""); setAddAccountName(""); setAddAccountNumber(""); setAddRoutingCode("");
    await loadBankAccounts();
    if (data) setSelectedBank(data.id);
  };

  const handleWithdraw = async () => {
    const bank = bankAccounts.find((b) => b.id === selectedBank);
    if (!bank) { toast.error("Please select a destination bank account"); return; }
    if (offAmountRaw < 100) { toast.error("Minimum withdrawal is 100 HTG-C"); return; }
    const wallet = walletOptions.find((w) => w.id === offSourceWallet)
      ?? walletOptions.find((w) => w.stellar_address === selectedWallet)
      ?? walletOptions[0];
    if (!wallet) { toast.error("No wallet selected"); return; }
    setOffBusy(true);
    try {
      const { data: c } = await supabase.from("customers").select("id").maybeSingle();
      if (!c?.id) { toast.error("Customer not found"); return; }
      const { data, error } = await supabase.functions.invoke("withdraw-htgc", {
        body: {
          customerId: c.id,
          htgcAmount: offAmountRaw,
          sourceWalletAddress: wallet.stellar_address,
          destinationBankAccountId: selectedBank,
        },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Withdrawal failed");
        return;
      }
      setOffConfirm(false);
      toast.success("Withdrawal submitted — HTG-C burned on-chain. HTG arrives in 1–2 business days via SPIH.");
      navigate("/transactions");
    } finally {
      setOffBusy(false);
    }
  };

  const maskAccount = (num: string) =>
    num.length > 4 ? `**** ${num.slice(-4)}` : num;

  const tabStyle = (t: Tab): React.CSSProperties => ({
    padding: "9px 14px", fontSize: 13, fontWeight: 600,
    color: tab === t ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
    border: "none", background: "none", cursor: "pointer", fontFamily: "inherit",
    borderBottom: tab === t ? "2px solid hsl(var(--theo-blue))" : "2px solid transparent",
    marginBottom: -1, transition: "all 130ms", whiteSpace: "nowrap",
  });

  // Two-field widget math helpers (HTG → USDC mode)
  const fmtUsdcStr = (n: number) =>
    n > 0 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  const fmtHtgStr = (n: number) =>
    n > 0 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "";

  const handleHtgInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow digits and a single decimal point with up to 2 decimal places
    const cleaned = e.target.value.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    let intPart = parts[0].replace(/^0+(?=\d)/, "");
    let decPart = parts.length > 1 ? parts.slice(1).join("").slice(0, 2) : null;
    let normalized = decPart !== null ? `${intPart || "0"}.${decPart}` : intPart;
    let num = parseFloat(normalized) || 0;
    // Cap HTG input so its USDC equivalent never exceeds 50,000 USDC
    if (htgReceiveMode === "usdc" && liveRate && liveRate > 0) {
      const f = totalBps / 10_000;
      const denom = 1 - f;
      const maxGross = denom > 0 ? 50_000 / denom : 50_000;
      const maxHtg = maxGross * liveRate;
      if (num > maxHtg) {
        num = Math.floor(maxHtg);
        intPart = String(num);
        decPart = null;
      }
    }
    setHtgAmountRaw(num);
    const intFormatted = intPart ? Number(intPart).toLocaleString("en-US") : "";
    const display = decPart !== null ? `${intFormatted || "0"}.${decPart}` : intFormatted;
    setHtgAmount(display);
    setHtgLastEdited("htg");
    if (htgReceiveMode === "usdc" && liveRate && liveRate > 0) {
      const f = totalBps / 10_000;
      const gross = num / liveRate;
      const net = gross * (1 - f);
      setHtgUsdcNetRaw(net);
      setHtgUsdcNetDisplay(fmtUsdcStr(net));
    }
  };

  const handleHtgUsdcInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow digits and a single decimal point
    const cleaned = e.target.value.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    let intPart = parts[0].replace(/^0+(?=\d)/, "");
    let decPart = parts.length > 1 ? parts.slice(1).join("").slice(0, 2) : null;
    let normalized = decPart !== null ? `${intPart || "0"}.${decPart}` : intPart;
    let num = parseFloat(normalized) || 0;
    // Hard-cap net USDC at 50,000
    if (num > 50_000) {
      num = 50_000;
      intPart = "50000";
      decPart = null;
      normalized = "50000";
    }
    setHtgUsdcNetRaw(num);
    // Add thousand separators to the integer portion while preserving in-progress decimals
    const intFormatted = intPart ? Number(intPart).toLocaleString("en-US") : "";
    const display = decPart !== null ? `${intFormatted || "0"}.${decPart}` : intFormatted;
    setHtgUsdcNetDisplay(display);
    setHtgLastEdited("usdc");
    if (liveRate && liveRate > 0) {
      const f = totalBps / 10_000;
      const denom = 1 - f;
      const gross = denom > 0 ? num / denom : 0;
      const htg = gross * liveRate;
      setHtgAmountRaw(htg);
      setHtgAmount(fmtHtgStr(htg));
    }
  };


  const handleSwapInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/[^\d.]/g, "");
    const parts = cleaned.split(".");
    const intPart = parts[0].replace(/^0+(?=\d)/, "");
    const decPart = parts.length > 1 ? parts.slice(1).join("").slice(0, 2) : null;
    const normalized = decPart !== null ? `${intPart || "0"}.${decPart}` : intPart;
    const num = parseFloat(normalized) || 0;
    setSwapAmountRaw(num);
    const intFormatted = intPart ? Number(intPart).toLocaleString("en-US") : "";
    const display = decPart !== null ? `${intFormatted || "0"}.${decPart}` : intFormatted;
    setSwapAmount(display);
  };

  const handleHtgSubmit = async () => {
    if (htgAmountRaw < 1) { toast.error("Enter an amount"); return; }
    if (!selectedWallet) { toast.error("Select a destination account"); return; }

    if (htgReceiveMode === "usdc") {
      if (!canQuote) { toast.error("KYB approval required to convert to USDC"); return; }
      if (!liveRate) { toast.error("Rate unavailable, try again shortly"); return; }
      const f = totalBps / 10_000;
      const denom = 1 - f;
      const usdcGross = denom > 0 ? htgUsdcNetRaw / denom : 0;
      const usdcGrossRounded = Math.round(usdcGross * 1e7) / 1e7;
      if (usdcGrossRounded < 1000 || usdcGrossRounded > 52000) {
        toast.error("Enter an amount between 1,000 and 50,000 USDC");
        return;
      }
      setHtgBusy(true);
      try {
        const { data, error } = await supabase.functions.invoke("create-quote", {
          body: {
            order_kind: "usdc_conversion",
            usdc_amount: usdcGrossRounded,
            destination_wallet_address: selectedWallet,
          },
        });
        if (error || data?.error) {
          toast.error(data?.error || error?.message || "Failed to create quote");
          return;
        }
        toast.success(`Rate locked. Reference ${data.reference_number}`);
        navigate(`/orders/${data.quote_id}`);
      } finally {
        setHtgBusy(false);
      }
      return;
    }

    // HTG-C 1:1 mint path
    setHtgBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-quote", {
        body: {
          order_kind: "htgc_mint",
          htg_amount: htgAmountRaw,
          destination_wallet_address: selectedWallet,
        },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Failed to create deposit reference");
        return;
      }
      toast.success(`Deposit reference ${data.reference_number}`);
      navigate(`/orders/${data.quote_id}`);
    } finally {
      setHtgBusy(false);
    }
  };

  const handleSwapSubmit = async () => {
    if (swapAmountRaw < 1) { toast.error("Enter an amount"); return; }
    const usdcEquivalent = swapDir === "htgc_to_usdc"
      ? swapAmountRaw / (liveRate ?? 130)
      : swapAmountRaw;
    if (usdcEquivalent < 1000) {
      const minHtgc = Math.ceil(1000 * (liveRate ?? 130));
      toast.error("Minimum swap not met", {
        description: swapDir === "htgc_to_usdc"
          ? `Swaps require at least 1,000 USDC equivalent (~${minHtgc.toLocaleString("en-US")} HTG-C).`
          : "Swaps require at least 1,000 USDC.",
      });
      return;
    }
    const wallet = walletOptions.find((w) => w.stellar_address === selectedWallet) ?? walletOptions[0];
    if (!wallet) { toast.error("No wallet selected"); return; }
    setSwapBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("execute-swap", {
        body: { wallet_id: wallet.id, amount: swapAmountRaw, direction: swapDir },
      });
      if (error || data?.error) {
        if (data?.refunded) {
          toast.error("Swap couldn't complete — your funds were returned to your wallet.", {
            description: data?.detail ? String(data.detail).slice(0, 160) : undefined,
          });
        } else if (data?.refundFailed) {
          toast.error("Swap failed and funds are temporarily held. Theo support has been notified.", {
            description: "An operations team member will return your funds shortly.",
          });
        } else {
          toast.error(data?.error || error?.message || "Swap failed");
        }
        if (selectedWallet) fetchHorizonBalances(selectedWallet).then(setWalletBalances);
        return;
      }
      toast.success("Swap completed");
      if (selectedWallet) fetchHorizonBalances(selectedWallet).then(setWalletBalances);
      navigate(`/orders/${data.orderId}`);
    } finally {
      setSwapBusy(false);
    }
  };

  const dirToggle = (active: boolean, onClick: () => void, label: string) => (
    <button
      onClick={onClick}
      style={{
        padding: "4px 10px", fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: "pointer",
        border: active ? "none" : "1.5px solid hsl(var(--theo-light))",
        background: active ? "hsl(var(--theo-blue))" : "transparent",
        color: active ? "#fff" : "hsl(var(--theo-mid))",
        fontFamily: "inherit", transition: "all 130ms",
      }}
    >
      {label}
    </button>
  );

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 10, fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.10em",
    color: "hsl(var(--theo-mid))", marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", fontFamily: "inherit", fontSize: 14,
    padding: "10px 12px", borderRadius: 9,
    border: "1.5px solid hsl(var(--theo-light))",
    background: "#fff", color: "hsl(var(--theo-ink))",
    outline: "none", boxSizing: "border-box",
  };

  return (
    <AppLayout>
      <div className="mb-1">
        <div className="font-extrabold" style={{ fontSize: 22, color: "hsl(var(--theo-blue))", letterSpacing: "-0.02em" }}>
          On / Off Ramp
        </div>
        <div style={{ fontSize: 13, color: "hsl(var(--theo-mid))", marginTop: 2 }}>
          Deposit HTG, swap between currencies, or withdraw to a bank.
        </div>
      </div>
      <div className="mb-5" style={{ width: 28, height: 3, background: "hsl(var(--theo-gold))", borderRadius: 2, marginTop: 8 }} />

      <div className="grid gap-4" style={{ gridTemplateColumns: "3fr 2fr" }}>
        {/* Main form */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
          <div className="flex border-b border-border mb-4" style={{ overflowX: "auto" }}>
            <button style={tabStyle("htg")} onClick={() => setTab("htg")}>Deposit HTG</button>
            <button style={tabStyle("swap")} onClick={() => setTab("swap")}>Swap</button>
            <button style={tabStyle("off")} onClick={() => setTab("off")}>Withdraw to Bank</button>
            <button style={tabStyle("wire")} onClick={() => setTab("wire")}>Global Wire</button>
            
          </div>

          {/* ── Tab 1: Deposit HTG → mint HTG-C OR auto-convert to USDC ── */}
          {tab === "htg" && (
            <>
              {/* How it works banner */}
              <div className="rounded-xl mb-4 flex items-start gap-2.5" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))", padding: "12px 14px" }}>
                <Building2 className="shrink-0" style={{ width: 16, height: 16, color: "hsl(var(--theo-blue))", marginTop: 1 }} />
                <div style={{ fontSize: 12, color: "hsl(var(--theo-blue))", lineHeight: 1.6 }}>
                  {htgReceiveMode === "htgc"
                    ? <>Send HTG to Theo via <strong>SPIH</strong>. Once received, HTG-C is automatically minted 1:1 to your wallet on Stellar.</>
                    : <>Send HTG to Theo via <strong>SPIH</strong>. We auto-convert at the locked rate and deliver USDC to your wallet.</>}
                </div>
              </div>

              {/* Receive mode toggle */}
              <div style={{ marginBottom: 14 }}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label style={{ ...labelStyle, marginBottom: 0 }}>You receive</label>
                  <span
                    title={`Available ${htgReceiveMode === "usdc" ? "USDC" : "HTG-C"} in selected wallet`}
                    style={{
                      fontSize: 11, fontWeight: 600,
                      color: "hsl(var(--theo-blue))",
                      background: "hsl(var(--theo-blue-soft))",
                      border: "1px solid hsl(var(--theo-blue-chip))",
                      padding: "3px 8px", borderRadius: 999,
                    }}
                  >
                    Available: {(htgReceiveMode === "usdc" ? walletBalances.usdc : walletBalances.htgc).toLocaleString("en-US", { minimumFractionDigits: htgReceiveMode === "usdc" ? 2 : 0, maximumFractionDigits: htgReceiveMode === "usdc" ? 2 : 0 })} {htgReceiveMode === "usdc" ? "USDC" : "HTG-C"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {dirToggle(htgReceiveMode === "usdc", () => setHtgReceiveMode("usdc"), "USDC · auto-convert")}
                  {dirToggle(htgReceiveMode === "htgc", () => setHtgReceiveMode("htgc"), "HTG-C · 1:1 mint")}
                </div>
              </div>

              {/* KYB gate (USDC mode only) */}
              {htgReceiveMode === "usdc" && !canQuote && !profileLoading && (
                <div className="mb-4 rounded-xl p-4" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))" }}>
                  <div style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>
                    <strong>KYB approval required</strong> to convert directly to USDC.{" "}
                    {isAdmin && profile?.kyb_status !== "APPROVED" && (
                      <button onClick={approveTestKyb} disabled={busy} className="underline cursor-pointer border-none bg-transparent text-theo-cyan" style={{ fontFamily: "inherit", fontSize: 13, color: "hsl(var(--theo-cyan))" }}>
                        Approve test KYB
                      </button>
                    )}
                  </div>
                </div>
              )}

              {htgReceiveMode === "htgc" ? (
                /* Two-field HTG → HTG-C widget (1:1) */
                <div style={{ marginBottom: 14, position: "relative" }}>
                  <div className="rounded-xl" style={{ border: "1px solid hsl(var(--theo-blue-chip))", background: "white", overflow: "hidden" }}>
                    {/* You send · HTG */}
                    <div style={{ padding: "12px 14px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--theo-mid))", marginBottom: 6 }}>
                        You send
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={htgAmount}
                          onChange={handleHtgInput}
                          placeholder="0"
                          style={{
                            flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent",
                            fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em",
                            color: "hsl(var(--theo-blue))",
                            fontFamily: "inherit", padding: 0,
                          }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>HTG</span>
                      </div>
                    </div>

                    <div style={{ height: 1, background: "hsl(var(--theo-blue-chip))" }} />

                    {/* You receive · HTG-C (1:1) */}
                    <div style={{ padding: "12px 14px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--theo-mid))", marginBottom: 6 }}>
                        You receive
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={htgAmount}
                          onChange={handleHtgInput}
                          placeholder="0"
                          style={{
                            flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent",
                            fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em",
                            color: "hsl(var(--theo-mid))",
                            fontFamily: "inherit", padding: 0,
                          }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>HTG-C</span>
                      </div>
                    </div>
                  </div>

                  {/* Flip button — visual only */}
                  <button
                    type="button"
                    aria-disabled="true"
                    tabIndex={-1}
                    onClick={(e) => e.preventDefault()}
                    style={{
                      position: "absolute", top: "50%", left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: 32, height: 32, borderRadius: 999,
                      background: "white",
                      border: "1px solid hsl(var(--theo-blue-chip))",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "default", padding: 0,
                    }}
                  >
                    <ArrowUpDown style={{ width: 14, height: 14, color: "hsl(var(--theo-blue))" }} />
                  </button>
                </div>
              ) : (
                /* Coinbase-style two-field HTG ↔ USDC widget */
                <div style={{ marginBottom: 14, position: "relative" }}>
                  <div className="rounded-xl" style={{ border: "1px solid hsl(var(--theo-blue-chip))", background: "white", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    {/* You send · HTG */}
                    <div style={{ padding: "12px 14px", order: htgFlipped ? 2 : 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--theo-mid))", marginBottom: 6 }}>
                        {htgFlipped ? "You receive" : "You send"}
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={htgAmount}
                          onChange={handleHtgInput}
                          onFocus={() => setHtgLastEdited("htg")}
                          placeholder="0"
                          style={{
                            flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent",
                            fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em",
                            color: htgLastEdited === "htg" ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
                            fontFamily: "inherit", padding: 0,
                          }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>HTG</span>
                      </div>
                    </div>

                    <div style={{ height: 1, background: "hsl(var(--theo-blue-chip))", order: 1 }} />

                    {/* You receive · USDC */}
                    <div style={{ padding: "12px 14px", order: htgFlipped ? 0 : 2 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--theo-mid))", marginBottom: 6 }}>
                        {htgFlipped ? "You send" : "You receive"}
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={htgUsdcNetDisplay}
                          onChange={handleHtgUsdcInput}
                          onFocus={() => setHtgLastEdited("usdc")}
                          placeholder="0.00"
                          style={{
                            flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent",
                            fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em",
                            color: htgLastEdited === "usdc" ? "hsl(var(--theo-blue))" : "hsl(var(--theo-mid))",
                            fontFamily: "inherit", padding: 0,
                          }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>USDC</span>
                      </div>
                    </div>
                  </div>

                  {/* Flip button — swaps top/bottom visually */}
                  <button
                    type="button"
                    onClick={() => setHtgFlipped((f) => !f)}
                    aria-label="Flip fields"
                    style={{
                      position: "absolute", top: "50%", left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: 32, height: 32, borderRadius: 999,
                      background: "white",
                      border: "1px solid hsl(var(--theo-blue-chip))",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", padding: 0,
                    }}
                  >
                    <ArrowUpDown style={{ width: 14, height: 14, color: "hsl(var(--theo-blue))" }} />
                  </button>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Destination account</label>
                {walletOptions.length === 0 ? (
                  <div style={{ ...inputStyle, display: "flex", alignItems: "center", color: "hsl(var(--theo-mid))", fontSize: 13 }}>
                    No accounts yet — create one on the Balance page.
                  </div>
                ) : (
                  <select
                    value={selectedWallet}
                    onChange={(e) => setSelectedWallet(e.target.value)}
                    style={{ ...inputStyle, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                  >
                    {walletOptions.map((w) => (
                      <option key={w.id} value={w.stellar_address}>{w.label}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Quote box */}
              <div className="rounded-xl mb-4" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))", padding: "14px 16px" }}>
                <div className="flex justify-between mb-1.5">
                  <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>You send</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "hsl(var(--theo-blue))" }}>{htgAmount || "0"} HTG</span>
                </div>
                {htgReceiveMode === "htgc" ? (
                  <>
                    <div className="flex justify-between mb-1.5">
                      <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>You receive</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "hsl(var(--theo-blue))" }}>{htgAmount || "0"} HTG-C</span>
                    </div>
                    <div className="flex justify-between mb-1.5">
                      <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>Peg</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>1:1 · guaranteed</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>Settlement</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>Auto · same business day</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2.5 pt-2.5" style={{ borderTop: "1px solid hsl(var(--theo-blue-chip))" }}>
                      <div className="rounded-full" style={{ width: 6, height: 6, background: "#22c55e" }} />
                      <span style={{ fontSize: 11, color: "#15803d", fontWeight: 600 }}>
                        HTG-C is fully collateralised by HTG held in Theo's segregated bank account · quarterly audited attestations ·{" "}
                        <a
                          href="https://stellar.expert/explorer/testnet/asset/HTGC-GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT"
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "hsl(var(--theo-cyan))", textDecoration: "underline", fontWeight: 700 }}
                        >
                          verify on-chain ↗
                        </a>
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    {(() => {
                      const f = totalBps / 10_000;
                      const denom = 1 - f;
                      const grossUsdc = denom > 0 ? htgUsdcNetRaw / denom : 0;
                      const feeOnly = grossUsdc - htgUsdcNetRaw;
                      const feePct = (totalBps / 100).toFixed(2);
                      return (
                        <>
                          <div className="flex justify-between mb-1.5">
                            <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>Rate</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
                              {liveRate ? `${liveRate.toFixed(2)} HTG / USDC` : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between mb-1.5">
                            <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>Theo fee ({feePct}%)</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
                              {feeOnly > 0 ? `− $${feeOnly.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC` : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between mb-1.5">
                            <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>You receive net</span>
                            <span style={{ fontSize: 15, fontWeight: 800, color: "hsl(var(--theo-blue))" }}>
                              {htgUsdcNetRaw > 0 ? `$${htgUsdcNetRaw.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC` : "—"}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>Quote lock</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>15 minutes</span>
                          </div>
                        </>
                      );
                    })()}
                    <div className="flex items-center gap-1.5 mt-2.5 pt-2.5" style={{ borderTop: "1px solid hsl(var(--theo-blue-chip))" }}>
                      <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))" }} />
                      <span style={{ fontSize: 11, color: "hsl(var(--theo-blue))", fontWeight: 600 }}>
                        Max $50,000 USDC per order · fees withheld at settlement
                      </span>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={handleHtgSubmit}
                disabled={htgBusy || htgAmountRaw < 1}
                className="w-full font-bold text-white"
                style={{
                  background: htgBusy || htgAmountRaw < 1 ? "hsl(var(--theo-mid))" : "hsl(var(--theo-blue))",
                  borderRadius: 9, padding: "12px", fontSize: 14, border: "none",
                  cursor: htgBusy || htgAmountRaw < 1 ? "not-allowed" : "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {htgBusy
                  ? "Generating deposit instructions…"
                  : htgReceiveMode === "usdc" ? "Lock rate & get deposit reference →" : "Get deposit reference →"}
              </button>
            </>
          )}

          {/* ── Tab 2: Swap HTG-C ↔ USDC ──────────────────────────────── */}
          {tab === "swap" && (
            <>
              {/* KYB gate */}
              {!canQuote && !profileLoading && (
                <div className="mb-4 rounded-xl p-4" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))" }}>
                  <div style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>
                    <strong>KYB approval required</strong> to unlock swaps.{" "}
                    {isAdmin && profile?.kyb_status !== "APPROVED" && (
                      <button onClick={approveTestKyb} disabled={busy} className="underline cursor-pointer border-none bg-transparent text-theo-cyan" style={{ fontFamily: "inherit", fontSize: 13, color: "hsl(var(--theo-cyan))" }}>
                        Approve test KYB
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Direction toggle */}
              <div className="flex items-center gap-2 mb-4">
                {dirToggle(swapDir === "htgc_to_usdc", () => setSwapDir("htgc_to_usdc"), "HTG-C → USDC")}
                {dirToggle(swapDir === "usdc_to_htgc", () => setSwapDir("usdc_to_htgc"), "USDC → HTG-C")}
              </div>

              {(() => {
                const availBal = swapDir === "htgc_to_usdc" ? walletBalances.htgc : walletBalances.usdc;
                const currency = swapDir === "htgc_to_usdc" ? "HTG-C" : "USDC";
                const setQuick = (pct: number) => {
                  const n = Math.floor(availBal * pct);
                  setSwapAmountRaw(n);
                  setSwapAmount(n ? n.toLocaleString("en-US") : "");
                };
                return (
                  <div style={{ marginBottom: 14 }}>
                    {/* Label row with available balance */}
                    <div className="flex items-center justify-between mb-1.5">
                      <label style={{ ...labelStyle, marginBottom: 0 }}>{currency} to swap</label>
                      <span
                        title={`Available ${currency} in selected wallet`}
                        style={{
                          fontSize: 11, fontWeight: 600,
                          color: "hsl(var(--theo-blue))",
                          background: "hsl(var(--theo-blue-soft))",
                          border: "1px solid hsl(var(--theo-blue-chip))",
                          padding: "3px 8px", borderRadius: 999,
                        }}
                      >
                        {balLoading ? "..." : `Available: ${availBal > 0 ? availBal.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0"} ${currency}`}
                      </span>
                    </div>

                    {/* Input */}
                    <div style={{ position: "relative" }}>
                      <input
                        style={{ ...inputStyle, paddingRight: 64 }}
                        type="text" inputMode="decimal"
                        value={swapAmount}
                        onChange={handleSwapInput}
                        placeholder="0"
                      />
                      <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>
                        {currency}
                      </span>
                    </div>

                    {/* Quick-select chips */}
                    {availBal > 0 && (
                      <div className="flex gap-1.5 mt-2">
                        {([0.25, 0.5, 0.75, 1] as const).map((pct) => (
                          <button
                            key={pct}
                            onClick={() => setQuick(pct)}
                            style={{
                              flex: 1, fontSize: 11, fontWeight: 700, padding: "4px 0",
                              borderRadius: 6, border: "1.5px solid hsl(var(--theo-light))",
                              background: swapAmountRaw === Math.floor(availBal * pct) && swapAmountRaw > 0
                                ? "hsl(var(--theo-blue))" : "transparent",
                              color: swapAmountRaw === Math.floor(availBal * pct) && swapAmountRaw > 0
                                ? "#fff" : "hsl(var(--theo-mid))",
                              cursor: "pointer", fontFamily: "inherit", transition: "all 120ms",
                            }}
                          >
                            {pct === 1 ? "MAX" : `${pct * 100}%`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Account</label>
                {walletOptions.length === 0 ? (
                  <div style={{ ...inputStyle, display: "flex", alignItems: "center", color: "hsl(var(--theo-mid))", fontSize: 13 }}>
                    No accounts yet — create one on the Balance page.
                  </div>
                ) : (
                  <select
                    value={selectedWallet}
                    onChange={(e) => setSelectedWallet(e.target.value)}
                    style={{ ...inputStyle, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                  >
                    {walletOptions.map((w) => (
                      <option key={w.id} value={w.stellar_address}>{w.label}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Quote */}
              <div className="rounded-xl mb-4" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))", padding: "14px 16px" }}>
                <div className="flex justify-between mb-1.5">
                  <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>You send</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "hsl(var(--theo-blue))" }}>
                    {swapAmount || "0"} {swapDir === "htgc_to_usdc" ? "HTG-C" : "USDC"}
                  </span>
                </div>
                <div className="flex justify-between mb-1.5">
                  <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>You receive</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "hsl(var(--theo-blue))" }}>
                    {liveRate
                      ? swapDir === "htgc_to_usdc"
                        ? `$${(swapAmountRaw / liveRate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`
                        : `${Math.round(swapAmountRaw * liveRate).toLocaleString("en-US")} HTG-C`
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between mb-1.5">
                  <span style={{ fontSize: 12, color: "hsl(var(--theo-mid))" }}>Rate</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{liveRate != null ? liveRate.toFixed(2) : "—"} HTG-C/USDC</span>
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <button
                      onClick={() => setShowFeeBreakdown((v) => !v)}
                      style={{ fontSize: 12, color: "hsl(var(--theo-mid))", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 3 }}
                    >
                      Fee <span style={{ fontSize: 10 }}>{showFeeBreakdown ? "▲" : "▼"}</span>
                    </button>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>
                      {fmtFee(swapAmountRaw * (swapDir === "htgc_to_usdc" ? 1 / (liveRate ?? 130) : 1) * (totalBps / 10_000))}
                    </span>
                  </div>
                  {showFeeBreakdown && (
                    <div className="mt-2 rounded-lg" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid hsl(var(--theo-blue-chip))", padding: "8px 10px" }}>
                      <div className="flex justify-between mb-1">
                        <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>Corridor ({corridorBps / 100}%)</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{fmtFee(swapAmountRaw * (swapDir === "htgc_to_usdc" ? 1 / (liveRate ?? 130) : 1) * corridorBps / 10_000)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>Theo fee (2.0% all-in)</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--theo-blue))" }}>{fmtFee(swapAmountRaw * (swapDir === "htgc_to_usdc" ? 1 / (liveRate ?? 130) : 1) * totalBps / 10_000)}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between mt-2.5 pt-2.5" style={{ borderTop: "1px solid hsl(var(--theo-blue-chip))" }}>
                  <div className="flex items-center gap-1.5">
                    <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))", animation: "pulse 2s infinite" }} />
                    <span style={{ fontSize: 11, color: "hsl(var(--theo-cyan))", fontWeight: 600 }}>
                      Rate locked for <strong>{timerLabel}</strong>
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: "hsl(var(--theo-mid))" }}>BRH official</span>
                </div>
              </div>

              <button
                onClick={handleSwapSubmit}
                disabled={swapBusy || swapAmountRaw < 1 || !canQuote}
                className="w-full font-bold text-white"
                style={{
                  background: swapBusy || swapAmountRaw < 1 || !canQuote ? "hsl(var(--theo-mid))" : "hsl(var(--theo-blue))",
                  borderRadius: 9, padding: "12px", fontSize: 14, border: "none",
                  cursor: swapBusy || swapAmountRaw < 1 || !canQuote ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {swapBusy ? "Swapping…" : swapDir === "htgc_to_usdc" ? "Swap HTG-C → USDC →" : "Swap USDC → HTG-C →"}
              </button>
            </>
          )}

          {tab === "off" && (
            <>
              {/* Amount */}
              <div style={{ marginBottom: 14 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>HTG-C to redeem</label>
                  <span
                    style={{
                      display: "inline-block",
                      background: "hsl(var(--theo-light))",
                      color: "hsl(var(--theo-blue))",
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "3px 9px",
                      borderRadius: 999,
                      letterSpacing: "0.01em",
                    }}
                  >
                    Available: {offHtgcLoading || offHtgcBalance == null
                      ? "—"
                      : offHtgcBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} HTG-C
                  </span>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    style={{ ...inputStyle, paddingRight: 60 }}
                    type="text" inputMode="decimal"
                    value={offAmount}
                    onChange={handleOffAmountInput}
                    placeholder="0"
                  />
                  <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-mid))" }}>HTG-C</span>
                </div>
                {offHtgcBalance != null && offAmountRaw > offHtgcBalance ? (
                  <div style={{ fontSize: 11, color: "hsl(var(--destructive))", marginTop: 6, fontWeight: 600 }}>
                    Insufficient HTG-C balance.{" "}
                    <button
                      type="button"
                      onClick={() => setTab("swap")}
                      style={{
                        background: "none", border: "none", padding: 0, cursor: "pointer",
                        color: "hsl(var(--theo-cyan))", fontWeight: 700, textDecoration: "underline",
                        fontFamily: "inherit", fontSize: 11,
                      }}
                    >
                      Swap USDC → HTG-C first.
                    </button>
                  </div>
                ) : null}

                {offHtgcBalance != null && offHtgcBalance > 0 && (
                  <div className="flex gap-1.5 mt-2">
                    {([0.25, 0.5, 0.75, 1] as const).map((pct) => {
                      const target = Math.floor(offHtgcBalance * pct);
                      const active = offAmountRaw === target && offAmountRaw > 0;
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => {
                            setOffAmountRaw(target);
                            setOffAmount(target ? target.toLocaleString("en-US") : "");
                          }}
                          style={{
                            flex: 1, fontSize: 11, fontWeight: 700, padding: "4px 0",
                            borderRadius: 6, border: "1.5px solid hsl(var(--theo-light))",
                            background: active ? "hsl(var(--theo-blue))" : "transparent",
                            color: active ? "#fff" : "hsl(var(--theo-mid))",
                            cursor: "pointer", fontFamily: "inherit", transition: "all 120ms",
                          }}
                        >
                          {pct === 1 ? "MAX" : `${pct * 100}%`}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Source wallet */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Source account</label>
                <select
                  value={offSourceWallet}
                  onChange={(e) => setOffSourceWallet(e.target.value)}
                  style={{ ...inputStyle, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                >
                  {walletOptions.length === 0
                    ? <option>No accounts yet</option>
                    : walletOptions.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                </select>
              </div>

              {/* Destination bank account */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Destination bank account</label>
                {bankLoading ? (
                  <div style={{ ...inputStyle, color: "hsl(var(--theo-mid))", fontSize: 13 }}>Loading…</div>
                ) : bankAccounts.length === 0 ? (
                  <button
                    onClick={() => setShowAddBank(true)}
                    style={{ ...inputStyle, background: "hsl(var(--theo-blue-soft))", border: "1.5px dashed hsl(var(--theo-blue))", color: "hsl(var(--theo-blue))", fontWeight: 600, fontSize: 13, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Plus size={14} /> Add a bank account
                  </button>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      value={selectedBank}
                      onChange={(e) => setSelectedBank(e.target.value)}
                      style={{ ...inputStyle, flex: 1, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                    >
                      {bankAccounts.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bank_name} — {maskAccount(b.account_number)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setShowAddBank(true)}
                      title="Add bank account"
                      style={{ background: "hsl(var(--theo-blue-soft))", border: "1.5px solid hsl(var(--theo-blue-chip))", borderRadius: 9, padding: "0 11px", cursor: "pointer", color: "hsl(var(--theo-blue))", display: "flex", alignItems: "center" }}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Selected bank summary */}
              {selectedBank && (() => {
                const b = bankAccounts.find((x) => x.id === selectedBank);
                if (!b) return null;
                return (
                  <div className="rounded-xl mb-3" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))", padding: "10px 14px" }}>
                    <div className="flex items-center gap-2">
                      <Building2 size={13} color="hsl(var(--theo-blue))" />
                      <span style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{b.bank_name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 3 }}>
                      {b.account_name} · {maskAccount(b.account_number)}
                      {b.routing_code && ` · ${b.routing_code}`}
                    </div>
                  </div>
                );
              })()}

              {/* Settlement note */}
              <div className="rounded-xl mb-4" style={{ background: "hsl(var(--theo-gold-soft))", border: "1px solid #F0C000", padding: "12px 14px", fontSize: 12, color: "#7A5F00", lineHeight: 1.5 }}>
                <strong>How it works:</strong> Your HTG-C is burned on Stellar and an equivalent amount of HTG is sent to your bank via <strong>SPIH</strong>. Typically arrives in 1–2 business days.
              </div>

              {(() => {
                const overBalance = offHtgcBalance != null && offAmountRaw > offHtgcBalance;
                const disabled = !selectedBank || offAmountRaw < 100 || overBalance;
                return (
                  <button
                    onClick={() => setOffConfirm(true)}
                    disabled={disabled}
                    className="w-full font-bold text-white"
                    style={{
                      background: disabled ? "hsl(var(--theo-mid))" : "hsl(var(--theo-blue))",
                      borderRadius: 9, padding: "12px", fontSize: 14,
                      border: "none", cursor: disabled ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Withdraw to bank →
                  </button>
                );
              })()}
            </>
          )}

          {tab === "wire" && (() => {
            // Wire fee config:
            // - WIRE_FLAT_FEE: $50 flat correspondent-bank wire fee
            // - Variable fee 100 bps (1%) split as:
            //     • 50 bps → OwlTing (orchestrator)
            //     • 50 bps → Theo  (platform)
            // - Volume incentive: amounts > $50,000 reduce Theo's portion
            //   from 50 bps to 25 bps (total variable becomes 75 bps + $50 flat).
            const WIRE_FLAT_FEE = 50;
            const orchestratorBps = 50;
            const platformBps = wireAmountRaw > 50000 ? 25 : 50;
            const variableBps = orchestratorBps + platformBps;

            const selectedWireWallet = walletOptions.find((w) => w.id === wireSourceWallet);
            const wireUsdcBal = selectedWireWallet ? walletBalances.usdc : 0;

            const orchestratorFee = wireAmountRaw * (orchestratorBps / 10000);
            const platformFee = wireAmountRaw * (platformBps / 10000);
            const variableFee = orchestratorFee + platformFee;
            const totalCost = wireAmountRaw > 0 ? variableFee + WIRE_FLAT_FEE : 0;
            const totalDebit = wireAmountRaw + totalCost;
            const netDelivered = Math.max(0, wireAmountRaw); // recipient gets full principal in local currency
            const overBalance = totalDebit > wireUsdcBal;

            const allFilled =
              !!wireSourceWallet &&
              wireRecipientName.trim() &&
              wireSwift.trim() &&
              wireIban.trim() &&
              wireBankCity.trim() &&
              wireAmountRaw > 0;
            const disabled = wireBusy || !allFilled || overBalance;

            const handleWireSubmit = () => {
              const payload = {
                source_wallet: wireSourceWallet,
                recipient_name: wireRecipientName,
                swift: wireSwift,
                iban: wireIban,
                bank_city: wireBankCity,
                amount_usdc: wireAmountRaw,
                flat_fee_usdc: WIRE_FLAT_FEE,
                orchestrator_fee_usdc: orchestratorFee,
                platform_fee_usdc: platformFee,
                total_cost_usdc: totalCost,
                total_debit_usdc: totalDebit,
                rail: "owlpay-global",
              };
              console.log("[GlobalWire] payload", payload);
              setWireBusy(true);
              toast.success("Wire instruction sent to OwlPay orchestrator");
              setTimeout(() => setWireBusy(false), 1200);
            };

            const fmt = (n: number) =>
              n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            return (
              <>
                {/* High-visibility badge */}
                <div className="rounded-xl mb-4 flex items-start gap-2.5" style={{ background: "hsl(var(--theo-cyan) / 0.08)", border: "1.5px solid hsl(var(--theo-cyan))", padding: "12px 14px" }}>
                  <Globe2 className="shrink-0" style={{ width: 16, height: 16, color: "hsl(var(--theo-cyan))", marginTop: 1 }} />
                  <div style={{ fontSize: 12, color: "hsl(var(--theo-blue))", lineHeight: 1.6, fontWeight: 600 }}>
                    Global Orchestrator Wire <span style={{ opacity: 0.75, fontWeight: 500 }}>(Bypasses Local SPIH)</span>
                  </div>
                </div>

                {/* Source wallet */}
                <div style={{ marginBottom: 12 }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Source account <span style={{ color: "#C00" }}>*</span></label>
                    {selectedWireWallet && (
                      <span style={{ display: "inline-block", background: "hsl(var(--theo-blue-soft))", color: "hsl(var(--theo-blue))", border: "1px solid hsl(var(--theo-blue-chip))", fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999 }}>
                        Available: {fmt(wireUsdcBal)} USDC
                      </span>
                    )}
                  </div>
                  {walletOptions.length === 0 ? (
                    <div style={{ ...inputStyle, color: "hsl(var(--theo-mid))", fontSize: 13 }}>No accounts yet — create one on the Balance page.</div>
                  ) : (
                    <select
                      value={wireSourceWallet}
                      onChange={(e) => { setWireSourceWallet(e.target.value); setSelectedWallet(walletOptions.find(w=>w.id===e.target.value)?.stellar_address ?? ""); }}
                      style={{ ...inputStyle, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                    >
                      <option value="">Select account…</option>
                      {walletOptions.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                    </select>
                  )}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Recipient full name <span style={{ color: "#C00" }}>*</span></label>
                  <input style={inputStyle} value={wireRecipientName} onChange={(e) => setWireRecipientName(e.target.value)} placeholder="Jane Doe" />
                </div>

                <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 12 }}>
                  <div>
                    <label style={labelStyle}>Bank SWIFT / BIC <span style={{ color: "#C00" }}>*</span></label>
                    <input style={inputStyle} value={wireSwift} onChange={(e) => setWireSwift(e.target.value.toUpperCase())} placeholder="HSBCGB2L" />
                  </div>
                  <div>
                    <label style={labelStyle}>Bank city / country <span style={{ color: "#C00" }}>*</span></label>
                    <input style={inputStyle} value={wireBankCity} onChange={(e) => setWireBankCity(e.target.value)} placeholder="London, UK" />
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>International account number (IBAN) <span style={{ color: "#C00" }}>*</span></label>
                  <input style={inputStyle} value={wireIban} onChange={(e) => setWireIban(e.target.value.toUpperCase())} placeholder="GB29 NWBK 6016 1331 9268 19" />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Amount (USDC) <span style={{ color: "#C00" }}>*</span></label>
                  <input
                    style={inputStyle}
                    inputMode="decimal"
                    value={wireAmountDisplay}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^\d.]/g, "");
                      const parts = cleaned.split(".");
                      const intPart = parts[0].replace(/^0+(?=\d)/, "");
                      const decPart = parts.length > 1 ? parts.slice(1).join("").slice(0, 2) : null;
                      const normalized = decPart !== null ? `${intPart || "0"}.${decPart}` : intPart;
                      const num = parseFloat(normalized) || 0;
                      setWireAmountRaw(num);
                      const intFormatted = intPart ? Number(intPart).toLocaleString("en-US") : "";
                      setWireAmountDisplay(decPart !== null ? `${intFormatted || "0"}.${decPart}` : intFormatted);
                    }}
                    placeholder="0.00"
                  />
                  {overBalance && (
                    <div style={{ fontSize: 11, color: "hsl(var(--destructive))", marginTop: 6, fontWeight: 600 }}>
                      Insufficient USDC — you need {fmt(totalDebit)} USDC including fees.
                    </div>
                  )}
                  {wireAmountRaw > 50000 && (
                    <div style={{ fontSize: 11, color: "hsl(var(--theo-cyan))", marginTop: 6, fontWeight: 600 }}>
                      Volume incentive applied: Theo platform fee reduced to 0.25% (total 0.75% + $50 flat).
                    </div>
                  )}
                </div>

                {/* Transfer Summary */}
                <div className="rounded-xl mb-4 p-4" style={{ background: "hsl(var(--theo-cream))", border: "1px solid hsl(var(--theo-light))" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "hsl(var(--theo-cyan))", marginBottom: 10 }}>
                    Transfer Summary
                  </div>
                  <div className="flex justify-between" style={{ fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: "hsl(var(--theo-mid))" }}>Principal</span>
                    <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>${fmt(wireAmountRaw)} USDC</span>
                  </div>
                  <div className="flex justify-between" style={{ fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: "hsl(var(--theo-mid))" }}>Bank Wire Fee <span style={{ opacity: 0.7 }}>(Flat)</span></span>
                    <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>${fmt(WIRE_FLAT_FEE)} USDC</span>
                  </div>
                  <div className="flex justify-between" style={{ fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: "hsl(var(--theo-mid))" }}>Processing Fee <span style={{ opacity: 0.7 }}>({(variableBps / 100).toFixed(2)}%)</span></span>
                    <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>${fmt(variableFee)} USDC</span>
                  </div>
                  <div className="flex justify-between" style={{ fontSize: 13, marginTop: 8, paddingTop: 8, borderTop: "1px solid hsl(var(--theo-light))" }}>
                    <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>Total Deducted</span>
                    <span style={{ fontWeight: 800, color: "hsl(var(--theo-blue))" }}>${fmt(totalDebit)} USDC</span>
                  </div>
                  <div className="flex justify-between items-center" style={{ fontSize: 13, marginTop: 10, paddingTop: 10, borderTop: "1px dashed hsl(var(--theo-cyan))" }}>
                    <span style={{ fontWeight: 800, color: "hsl(var(--theo-blue))" }}>Net Delivery</span>
                    <span style={{ fontWeight: 800, color: "hsl(var(--theo-blue))" }}>
                      Recipient will receive <span style={{ color: "hsl(var(--theo-cyan))" }}>${fmt(netDelivered)}</span> in local currency
                    </span>
                  </div>
                </div>

                {/* Settlement note */}
                <div className="rounded-xl mb-4 flex items-start gap-2.5" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))", padding: "12px 14px" }}>
                  <Info className="shrink-0" style={{ width: 14, height: 14, color: "hsl(var(--theo-blue))", marginTop: 2 }} />
                  <div style={{ fontSize: 12, color: "hsl(var(--theo-blue))", lineHeight: 1.6 }}>
                    Standard settlement <strong>1–3 business days</strong>. Powered by regulated global liquidity providers.
                  </div>
                </div>

                <button
                  onClick={handleWireSubmit}
                  disabled={disabled}
                  className="w-full font-bold"
                  style={{
                    background: disabled ? "hsl(var(--theo-mid))" : "hsl(var(--theo-cyan))",
                    color: "#fff",
                    borderRadius: 9, padding: "12px", fontSize: 14, border: "none",
                    cursor: disabled ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {wireBusy ? "Initiating wire…" : "Confirm Wire →"}
                </button>
              </>
            );
          })()}

        </div>

        {/* Info sidebar */}
        <div className="flex flex-col gap-3">
          <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
            <div className="font-bold mb-3" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Corridor info</div>
            <p style={{ fontSize: 12, color: "hsl(var(--theo-mid))", lineHeight: 1.6, marginBottom: 12 }}>
              Theo onboards Haiti to USDC. All HTG payments route through SPIH, Haiti's interbank settlement network.
            </p>
            {[
              ["Avg. settlement", "< 2 min"],
              ["Network", "Theo"],
              ["Reserve model", "1:1 · Segregated"],
              ["Max per order", "$50,000 USDC"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between" style={{ fontSize: 12, marginBottom: 8 }}>
                <span style={{ color: "hsl(var(--theo-mid))" }}>{k}</span>
                <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{v}</span>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <div className="font-bold" style={{ fontSize: 13, color: "hsl(var(--theo-blue))" }}>Live rate</div>
              {rateSource === "brh" && (
                <a
                  href="https://www.brh.ht/taux-du-jour/"
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--theo-cyan))", textDecoration: "none", letterSpacing: "0.08em", textTransform: "uppercase" }}
                >
                  BRH ↗
                </a>
              )}
            </div>
            <div className="font-extrabold leading-none" style={{ fontSize: 28, letterSpacing: "-1px", color: "hsl(var(--theo-blue))" }}>
              {rateLoading ? "…" : liveRate != null ? liveRate.toFixed(4) : "—"}
            </div>
            <div style={{ fontSize: 11, color: "hsl(var(--theo-mid))", marginTop: 2 }}>HTG per USDC</div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="rounded-full" style={{ width: 6, height: 6, background: "hsl(var(--theo-cyan))", animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 11, color: "hsl(var(--theo-cyan))", fontWeight: 600 }}>
                {rateSource === "brh" ? "BRH · updates daily" : "Live · updates every 5s"}
              </span>
            </div>
            {rateCapturedAt && rateSource === "brh" && (
              <div style={{ fontSize: 10, color: "hsl(var(--theo-mid))", marginTop: 4, opacity: 0.7 }}>
                As of {new Date(rateCapturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}
          </div>

          <div className="rounded-xl p-5 shadow-xs" style={{ background: "#EFFBF3" }}>
            <div className="flex items-center gap-1 mb-2">
              <div className="font-bold uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "hsl(150 50% 25%)" }}>
                Lifetime Savings
              </div>
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="How is lifetime savings calculated?"
                      className="inline-flex items-center justify-center"
                      style={{ background: "transparent", border: "none", padding: 0, cursor: "help", color: "hsl(150 50% 25%)" }}
                    >
                      <Info className="h-3 w-3" style={{ strokeWidth: 2 }} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    We calculate this by comparing our low fees to the 5% average markup charged by traditional banks and wire services.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="font-extrabold leading-none" style={{ fontSize: 26, letterSpacing: "-1px", color: "hsl(150 70% 25%)" }}>
              ${lifetimeSavings.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(150 30% 30%)", marginTop: 6 }}>
              Compared to standard 5% market FX rates
            </div>
          </div>
        </div>
      </div>

      {/* ── Add Bank Account Modal ─────────────────────────────────────── */}
      {showAddBank && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid hsl(var(--theo-light))" }}>
              <div>
                <div className="font-bold" style={{ fontSize: 15, color: "hsl(var(--theo-blue))" }}>Add bank account</div>
                <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 1 }}>HTG withdrawals will be sent here via SPIH</div>
              </div>
              <button onClick={() => setShowAddBank(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "hsl(var(--theo-mid))", padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              {/* Bank name */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Bank <span style={{ color: "#C00" }}>*</span></label>
                <select
                  value={addBankName}
                  onChange={(e) => setAddBankName(e.target.value)}
                  style={{ ...inputStyle, appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 28, cursor: "pointer" }}
                >
                  <option value="">Select bank…</option>
                  {HAITI_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              {/* Account name */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Account holder name <span style={{ color: "#C00" }}>*</span></label>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="Full legal name on account"
                  value={addAccountName}
                  onChange={(e) => setAddAccountName(e.target.value)}
                />
              </div>

              {/* Account number */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Account number <span style={{ color: "#C00" }}>*</span></label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 0012345678"
                  value={addAccountNumber}
                  onChange={(e) => setAddAccountNumber(e.target.value.replace(/[^\d]/g, ""))}
                />
              </div>

              {/* Routing / BIC */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Routing / BIC code <span style={{ color: "hsl(var(--theo-mid))", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="e.g. BNCAHAHX"
                  value={addRoutingCode}
                  onChange={(e) => setAddRoutingCode(e.target.value.toUpperCase())}
                />
              </div>

              <div className="rounded-lg mb-4" style={{ background: "hsl(var(--theo-blue-soft))", border: "1px solid hsl(var(--theo-blue-chip))", padding: "10px 12px", fontSize: 11, color: "hsl(var(--theo-blue))", lineHeight: 1.6 }}>
                Your account details are stored securely and only used to process withdrawals you initiate.
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddBank(false)}
                  style={{ flex: 1, background: "transparent", border: "1.5px solid hsl(var(--theo-light))", color: "hsl(var(--theo-mid))", borderRadius: 9, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddBank}
                  disabled={addBankBusy || !addBankName || !addAccountName || !addAccountNumber}
                  style={{
                    flex: 2, background: !addBankName || !addAccountName || !addAccountNumber ? "hsl(var(--theo-mid))" : "hsl(var(--theo-blue))",
                    color: "#fff", border: "none", borderRadius: 9, padding: "10px", fontSize: 13,
                    fontWeight: 700, cursor: !addBankName || !addAccountName || !addAccountNumber ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {addBankBusy ? "Saving…" : "Save bank account"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Withdrawal Confirm Modal ────────────────────────────────────── */}
      {offConfirm && (() => {
        const bank = bankAccounts.find((b) => b.id === selectedBank);
        const wallet = walletOptions.find((w) => w.id === offSourceWallet);
        if (!bank) return null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden" }}>
              <div className="px-5 py-4" style={{ borderBottom: "1px solid hsl(var(--theo-light))" }}>
                <div className="font-bold" style={{ fontSize: 15, color: "hsl(var(--theo-blue))" }}>Confirm withdrawal</div>
                <div style={{ fontSize: 12, color: "hsl(var(--theo-mid))", marginTop: 1 }}>HTG-C will be burned · HTG sent to your bank</div>
              </div>

              <div className="p-5">
                {/* Summary rows */}
                {[
                  ["HTG-C to burn", `${offAmount} HTG-C`],
                  ["HTG you receive", `${offAmountRaw.toLocaleString("en-US")} HTG`],
                  ["From account", wallet?.label ?? "—"],
                  ["To bank", bank.bank_name],
                  ["Account", `${bank.account_name} · ${maskAccount(bank.account_number)}`],
                  ["Settlement", "1–2 business days via SPIH"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2.5" style={{ borderBottom: "1px solid hsl(var(--theo-light))", fontSize: 13 }}>
                    <span style={{ color: "hsl(var(--theo-mid))" }}>{k}</span>
                    <span style={{ fontWeight: 700, color: "hsl(var(--theo-blue))" }}>{v}</span>
                  </div>
                ))}

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => setOffConfirm(false)}
                    style={{ flex: 1, background: "transparent", border: "1.5px solid hsl(var(--theo-light))", color: "hsl(var(--theo-mid))", borderRadius: 9, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleWithdraw}
                    disabled={offBusy}
                    className="flex items-center justify-center gap-2"
                    style={{ flex: 2, background: offBusy ? "hsl(var(--theo-mid))" : "hsl(var(--theo-blue))", color: "#fff", border: "none", borderRadius: 9, padding: "10px", fontSize: 13, fontWeight: 700, cursor: offBusy ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                  >
                    {offBusy ? <><Loader2 size={14} className="animate-spin" /> Processing…</> : <><CheckCircle2 size={14} /> Confirm withdrawal</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </AppLayout>
  );
}

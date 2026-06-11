import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BlendPosition = {
  id: string;
  walletId: string;
  walletLabel: string;
  walletAddress: string | null;
  deposited: number;
  accrued: number;
  grossApy: number;
  netApy: number;
  feeBps: number;
  depositedAt: string;
  lastTxHash: string | null;
  lastSyncedAt: string | null;
  poolAddress: string;
};

export function useBlendPositions() {
  const [positions, setPositions] = useState<BlendPosition[]>([]);
  const [grossApy, setGrossApy] = useState(0.09);
  const [netApy, setNetApy] = useState(0.07);
  const [feeBps, setFeeBps] = useState(200);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("blend-positions", { method: "GET" });
    if (!error && data) {
      setPositions(data.positions ?? []);
      if (typeof data.grossApy === "number") setGrossApy(data.grossApy);
      if (typeof data.netApy === "number") setNetApy(data.netApy);
      if (typeof data.feeBps === "number") setFeeBps(data.feeBps);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Tick once a second so accrued yield visibly creeps up in the UI.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Recompute accrued client-side off the depositedAt timestamp so the UI animates
  // without re-fetching. Server is still source of truth at withdraw time.
  const livePositions = positions.map((p) => {
    const elapsedSec = (Date.now() - new Date(p.depositedAt).getTime()) / 1000;
    const years = elapsedSec / (365 * 24 * 3600);
    // Continuous compounding: A = P * e^(r*t); accrued = A - P
    const accrued = p.deposited * (Math.exp(p.netApy * years) - 1);
    return { ...p, accrued };
  });

  // Backwards-compat: `apy` = net APY shown to customers.
  return { positions: livePositions, apy: netApy, grossApy, netApy, feeBps, loading, refresh };
}

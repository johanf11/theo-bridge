import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BlendPosition = {
  id: string;
  walletId: string;
  walletLabel: string;
  walletAddress: string | null;
  deposited: number;
  lastTxHash: string | null;
  lastSyncedAt: string | null;
  poolAddress: string;
};

export function useBlendPositions() {
  const [positions, setPositions] = useState<BlendPosition[]>([]);
  const [apy, setApy] = useState(0.092);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("blend-positions", { method: "GET" });
    if (!error && data) {
      setPositions(data.positions ?? []);
      if (typeof data.apy === "number") setApy(data.apy);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { positions, apy, loading, refresh };
}

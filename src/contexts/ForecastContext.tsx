import {
  createContext, useContext, useState, useCallback, useEffect, ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';

// ── Index Types ───────────────────────────────────────────────────────────────
// INDEX 1: ForecastByCustomer — Map<UNC, Map<Customer, Map<DateISO, Qty>>>
export type ForecastByCustomerMap  = Map<string, Map<string, Map<string, number>>>;
// INDEX 2: ForecastAllCustomers  — Map<UNC, Map<DateISO, Qty>>
export type ForecastAllCustomersMap = Map<string, Map<string, number>>;

export interface ForecastVersion {
  id:             string;
  version_number: number;
  updated_by:     string;
  updated_at:     string;
  row_count:      number;
}

// ── O(1) lookup helper (exported for use in any module) ───────────────────────
// customer = "ALL CUS" or "" → reads from allCustomers index
// customer = specific name   → reads from byCustomer index
export function getForecastQty(
  byCustomer:   ForecastByCustomerMap,
  allCustomers: ForecastAllCustomersMap,
  unc:      string,
  customer: string,
  date:     string,
): number {
  const u = unc.toUpperCase();
  const c = customer.toUpperCase().trim();
  if (!c || c === 'ALL CUS' || c === 'ALL') {
    return allCustomers.get(u)?.get(date) ?? 0;
  }
  return byCustomer.get(u)?.get(c)?.get(date) ?? 0;
}

// ── Context ───────────────────────────────────────────────────────────────────
interface ForecastContextValue {
  byCustomer:   ForecastByCustomerMap;
  allCustomers: ForecastAllCustomersMap;
  currentVersion: ForecastVersion | null;
  /** O(1) lookup — use this in all rendering code */
  getQty: (unc: string, customer: string, date: string) => number;
  setForecast: (
    byCustomer:   ForecastByCustomerMap,
    allCustomers: ForecastAllCustomersMap,
    info: { updatedBy: string; rowCount: number },
  ) => Promise<{ error: string | null }>;
}

const ForecastContext = createContext<ForecastContextValue>({
  byCustomer:   new Map(),
  allCustomers: new Map(),
  currentVersion: null,
  getQty: () => 0,
  setForecast: async () => ({ error: null }),
});

export function ForecastProvider({ children }: { children: ReactNode }) {
  const [byCustomer,   setByCustomer]   = useState<ForecastByCustomerMap>(new Map());
  const [allCustomers, setAllCustomers] = useState<ForecastAllCustomersMap>(new Map());
  const [currentVersion, setCurrentVersion] = useState<ForecastVersion | null>(null);

  useEffect(() => {
    supabase.from('forecast_versions')
      .select('*').order('updated_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data?.[0]) setCurrentVersion(data[0] as ForecastVersion);
      });
  }, []);

  const getQty = useCallback(
    (unc: string, customer: string, date: string) =>
      getForecastQty(byCustomer, allCustomers, unc, customer, date),
    [byCustomer, allCustomers],
  );

  const setForecast = useCallback(async (
    newByCustomer:   ForecastByCustomerMap,
    newAllCustomers: ForecastAllCustomersMap,
    info: { updatedBy: string; rowCount: number },
  ): Promise<{ error: string | null }> => {
    // Update in-memory FIRST so all consumers re-render immediately
    setByCustomer(newByCustomer);
    setAllCustomers(newAllCustomers);

    // Save version metadata to DB (non-blocking for the consumer)
    try {
      const { data: latest } = await supabase
        .from('forecast_versions')
        .select('version_number')
        .order('version_number', { ascending: false })
        .limit(1);

      const nextVersion = (latest?.[0]?.version_number ?? 0) + 1;

      const { error } = await supabase.from('forecast_versions').insert({
        version_number: nextVersion,
        updated_by:    info.updatedBy,
        row_count:     info.rowCount,
      });

      if (error) return { error: error.message };

      setCurrentVersion({
        id: '',
        version_number: nextVersion,
        updated_by:     info.updatedBy,
        updated_at:     new Date().toISOString(),
        row_count:      info.rowCount,
      });
    } catch (err) {
      return { error: String(err) };
    }

    return { error: null };
  }, []);

  return (
    <ForecastContext.Provider value={{ byCustomer, allCustomers, currentVersion, getQty, setForecast }}>
      {children}
    </ForecastContext.Provider>
  );
}

export function useForecast() {
  return useContext(ForecastContext);
}

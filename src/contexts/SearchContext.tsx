import { createContext, useContext, useState } from "react";

interface SearchContextValue {
  query: string;
  setQuery: (q: string) => void;
}

const SearchContext = createContext<SearchContextValue>({ query: "", setQuery: () => {} });

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  return (
    <SearchContext.Provider value={{ query, setQuery }}>
      {children}
    </SearchContext.Provider>
  );
}

export const useSearch = () => useContext(SearchContext);

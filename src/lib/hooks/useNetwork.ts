import { useSearchParams } from "react-router-dom";

export function getNetwork(params: URLSearchParams) {
  // Default to testnet if no network parameter is specified
  return params.has("mainnet") ? "mainnet" : "testnet";
}

export function useNetwork(): { network: "mainnet" | "testnet" } {
  const [params] = useSearchParams();

  return {
    network: getNetwork(params),
  };
}

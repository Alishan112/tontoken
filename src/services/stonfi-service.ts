import { Address, beginCell, toNano, Cell } from "ton";
import { SendTransactionRequest, TonConnectUI } from "@tonconnect/ui-react";
import { CHAIN } from "@tonconnect/sdk";
import { getNetwork } from "lib/hooks/useNetwork";
import { getClient } from "lib/get-ton-client";
import { waitForSeqno } from "lib/utils";
import { makeGetCall, cellToAddress } from "lib/make-get-call";

/**
 * STON.fi REST API Base URLs
 */
const STONFI_API_MAINNET = "https://api.ston.fi";
const STONFI_API_TESTNET = "https://api-testnet.ston.fi";

/**
 * TON Address (for TON/Jetton pairs)
 */
const TON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";

/**
 * STON.fi Router Contract Addresses
 * NOTE: These addresses should be verified from STON.fi's official documentation
 * Mainnet router: Check STON.fi docs for latest address
 * Testnet router: Check STON.fi docs for latest address
 *
 * For now, using placeholder addresses. The deep link method (recommended) doesn't require these.
 * If using direct contract interaction, verify addresses from:
 * - https://docs.ston.fi/
 * - https://github.com/ston-fi
 */
// Router addresses - converting URL-safe format (_ and -) to standard format (+ and /) for Address.parse
const STONFI_ROUTER_MAINNET = "EQD0vdSA+NedR9uvbgN9EikRX/suesDxGeFg69XQMavfLqIoB";
const STONFI_ROUTER_TESTNET = "EQD0vdSA+NedR9uvbgN9EikRX/suesDxGeFg69XQMavfLqIoB";

/**
 * STON.fi Factory Contract Addresses
 * NOTE: Verify these addresses from STON.fi's official documentation
 */
const STONFI_FACTORY_MAINNET = "EQCkR1cGmnsE45N4K0otPl5EnxnRakmGqeJUNua5fkWhales";
const STONFI_FACTORY_TESTNET = "EQCkR1cGmnsE45N4K0otPl5EnxnRakmGqeJUNua5fkWhales";

export interface CreatePoolParams {
  tokenAddress: Address;
  tonAmount: string; // TON amount in human-readable format (e.g., "10")
  walletAddress: string;
}

export interface AddLiquidityParams {
  tokenAddress: Address;
  tonAmount: string;
  tokenAmount: string; // Token amount in human-readable format
  walletAddress: string;
}

export interface PoolInfo {
  address: string;
  token0_address: string;
  token1_address: string;
  reserve0: string;
  reserve1: string;
  lp_total_supply: string;
}

interface PoolsResponse {
  pools: PoolInfo[];
}

class StonFiService {
  private getApiBaseUrl(): string {
    const network = getNetwork(new URLSearchParams(window.location.search));
    return network === "testnet" ? STONFI_API_TESTNET : STONFI_API_MAINNET;
  }

  private getRouterAddress(): Address {
    const network = getNetwork(new URLSearchParams(window.location.search));
    const addressStr = network === "testnet" ? STONFI_ROUTER_TESTNET : STONFI_ROUTER_MAINNET;
    // Parse address - constants are in standard base64 format
    return Address.parse(addressStr);
  }

  /**
   * Check if a pool exists for the given token pair using STON.fi API
   */
  async checkPoolExists(tokenAddress: Address): Promise<boolean> {
    try {
      const pool = await this.getPoolInfo(tokenAddress);
      return pool !== null;
    } catch (error) {
      console.error("Error checking pool existence:", error);
      return false;
    }
  }

  /**
   * Get pool information for a token pair using STON.fi API
   * Uses the by_market endpoint: GET /v1/pools/by_market/{asset0}/{asset1}
   * This is the most reliable way to check if a pool exists without contract calls
   */
  async getPoolInfo(tokenAddress: Address): Promise<PoolInfo | null> {
    try {
      const apiUrl = this.getApiBaseUrl();
      const tonAddr = Address.parse(TON_ADDRESS);

      // Normalize addresses to URL-safe format for API
      const tonAddrStr = tonAddr.toFriendly({ urlSafe: true });
      const tokenAddrStr = tokenAddress.toFriendly({ urlSafe: true });

      // Use the by_market endpoint to query pool by token addresses
      // Try both orders: TON/token and token/TON
      let response = await fetch(`${apiUrl}/v1/pools/by_market/${tonAddrStr}/${tokenAddrStr}`);

      // If not found, try reverse order
      if (!response.ok && response.status === 404) {
        response = await fetch(`${apiUrl}/v1/pools/by_market/${tokenAddrStr}/${tonAddrStr}`);
      }

      if (!response.ok) {
        // Pool doesn't exist if 404 - this is expected for new pairs
        if (response.status === 404) {
          return null;
        }
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const poolInfo: PoolInfo = await response.json();
      return poolInfo;
    } catch (error) {
      // If API call fails, assume pool doesn't exist
      // This is fine - we're creating a new pair
      console.log("Pool doesn't exist yet - this is expected for new pairs");
      return null;
    }
  }

  /**
   * Get pool address for a token pair
   */
  async getPoolAddress(tokenAddress: Address): Promise<Address | null> {
    try {
      const poolInfo = await this.getPoolInfo(tokenAddress);
      if (!poolInfo || !poolInfo.address) {
        return null;
      }
      // API returns address - try parsing directly first
      try {
        let addres = Address.parse(poolInfo.address);
        console.log("aqweqweddres", addres);

        return addres;
      } catch (error) {
        // If parsing fails, try converting URL-safe to standard format
        const normalizedAddress = poolInfo.address.replace(/-/g, "+").replace(/_/g, "/");
        return Address.parse(normalizedAddress);
      }
    } catch (error) {
      console.error("Error getting pool address:", error);
      return null;
    }
  }

  /**
   * Create a new liquidity pool (if it doesn't exist) and add initial liquidity
   */
  async createPoolAndAddLiquidity(
    params: CreatePoolParams,
    tonConnectUI: TonConnectUI,
  ): Promise<string> {
    const tc = await getClient();
    const waiter = await waitForSeqno(
      tc.openWalletFromAddress({
        source: Address.parse(params.walletAddress),
      }),
    );

    const network = getNetwork(new URLSearchParams(window.location.search));
    const routerAddress = this.getRouterAddress();
    const tonAmountNano = toNano(params.tonAmount);

    // Build payload for add_liquidity
    // STON.fi router expects:
    // - op: 0x2593855f (add_liquidity)
    // - query_id: 0
    // - user_wallet_address: Address
    // - min_tokens: Coins (minimum tokens to receive)
    // - min_ton: Coins (minimum TON to receive)
    // - jetton_wallet_address: Address (token wallet address)

    // First, we need to get the user's jetton wallet address
    const jettonWalletAddress = await this.getJettonWalletAddress(
      params.tokenAddress,
      Address.parse(params.walletAddress),
    );

    const payload = beginCell()
      .storeUint(0x2593855f, 32) // add_liquidity op code
      .storeUint(0, 64) // query_id
      .storeAddress(Address.parse(params.walletAddress)) // user_wallet_address
      .storeCoins(toNano("0")) // min_tokens (slippage tolerance)
      .storeCoins(toNano("0")) // min_ton (slippage tolerance)
      .storeAddress(jettonWalletAddress) // jetton_wallet_address
      .endCell();

    const tx: SendTransactionRequest = {
      validUntil: Date.now() + 5 * 60 * 1000,
      network: network === "testnet" ? CHAIN.TESTNET : CHAIN.MAINNET,
      messages: [
        {
          address: routerAddress.toFriendly(),
          amount: tonAmountNano.toString(),
          stateInit: undefined,
          payload: payload.toBoc().toString("base64"),
        },
      ],
    };

    await tonConnectUI.sendTransaction(tx);
    await waiter();

    return routerAddress.toFriendly();
  }

  /**
   * Add liquidity to an existing pool
   */
  async addLiquidity(params: AddLiquidityParams, tonConnectUI: TonConnectUI): Promise<string> {
    return this.createPoolAndAddLiquidity(
      {
        tokenAddress: params.tokenAddress,
        tonAmount: params.tonAmount,
        walletAddress: params.walletAddress,
      },
      tonConnectUI,
    );
  }

  /**
   * Get jetton wallet address for a user
   */
  private async getJettonWalletAddress(
    jettonMaster: Address,
    userAddress: Address,
  ): Promise<Address> {
    const tc = await getClient();

    // Call get_wallet_address on jetton master
    const payload = beginCell().storeAddress(userAddress).endCell();

    try {
      const jettonWalletAddress = await makeGetCall(
        jettonMaster,
        "get_wallet_address",
        [payload],
        ([addressCell]) => cellToAddress(addressCell as Cell),
        tc,
      );

      return jettonWalletAddress;
    } catch (error) {
      console.error("Error getting jetton wallet address:", error);
      throw error;
    }
  }

  /**
   * Get STON.fi deep link URL for adding liquidity
   * This is an alternative method that redirects to STON.fi web interface
   */
  getStonFiDeepLink(tokenAddress: string, tonAmount?: string): string {
    const network = getNetwork(new URLSearchParams(window.location.search));
    const baseUrl = network === "testnet" ? "https://testnet.ston.fi" : "https://app.ston.fi";

    const params = new URLSearchParams({
      token: tokenAddress,
    });

    if (tonAmount) {
      params.append("tonAmount", tonAmount);
    }

    return `${baseUrl}/liquidity/add?${params.toString()}`;
  }
}

const stonFiService = new StonFiService();
export { stonFiService };

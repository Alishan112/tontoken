import { Address, toNano, fromNano } from "ton";
import { TonConnectUI } from "@tonconnect/ui-react";
import { CHAIN } from "@tonconnect/sdk";
import { getNetwork } from "lib/hooks/useNetwork";
import { StonApiClient } from "@ston-fi/api";
import { dexFactory } from "@ston-fi/sdk";
import { TonClient } from "@ton/ton";
import BN from "bn.js";

/**
 * STON.fi REST API Base URLs
 */
const STONFI_API_MAINNET = "https://api.ston.fi";
const STONFI_API_TESTNET = "https://api-testnet.ston.fi";

/**
 * TON Address (for TON/Jetton pairs)
 */
const TON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";

export interface CreatePoolParams {
  tokenAddress: Address;
  tonAmount: string; // TON amount in human-readable format (e.g., "10")
  walletAddress: string;
}

export interface LiquiditySimulation {
  provisionType: string;
  poolAddress: string;
  router?: {
    address: string;
    ptonMasterAddress: string;
  };
  tokenA: string;
  tokenB: string;
  tokenAUnits: string;
  tokenBUnits: string;
  lpAccountAddress: string;
  estimatedLpUnits: string;
  minLpUnits: string;
  priceImpact?: string;
}

class StonFiService {
  private apiClient: StonApiClient;
  private tonClient: TonClient | null = null;

  constructor() {
    const network = getNetwork(new URLSearchParams(window.location.search));
    const apiUrl = network === "testnet" ? STONFI_API_TESTNET : STONFI_API_MAINNET;
    this.apiClient = new StonApiClient({ baseUrl: apiUrl });
  }

  /**
   * Initialize TON client if needed
   * Note: API key is optional but recommended for higher rate limits
   * Get your free API key from: https://toncenter.com/my
   * Or use @orbs-network/ton-access for automatic endpoint selection
   */
  private getTonClient(): TonClient {
    if (!this.tonClient) {
      const apiKey = process.env.REACT_APP_TON_API_KEY || "";
      // API key is optional - TON Center works without it but with lower rate limits
      this.tonClient = new TonClient({
        endpoint: "https://toncenter.com/api/v2/jsonRPC",
        apiKey: apiKey || undefined, // Pass undefined if empty string
      });
    }
    return this.tonClient;
  }

  /**
   * Convert human-readable amount to base units (nanoTON or token smallest units)
   * Note: This is mainly for reference - we use toNano directly for TON
   */
  private toBaseUnits(amount: string, decimals: number): string {
    const amountBN = toNano(amount);
    // For tokens with different decimals, we need to adjust
    if (decimals !== 9) {
      const multiplier = new BN(10).pow(new BN(decimals - 9));
      return amountBN.mul(multiplier).toString();
    }
    return amountBN.toString();
  }

  /**
   * Convert base units to human-readable amount
   */
  private fromBaseUnits(amount: string, decimals: number): string {
    const amountBN = new BN(amount);
    if (decimals !== 9) {
      const divisor = new BN(10).pow(new BN(decimals - 9));
      return fromNano(amountBN.div(divisor));
    }
    return fromNano(amountBN);
  }

  /**
   * Get token metadata (decimals, etc.) from STON.fi API
   */
  private async getTokenMetadata(tokenAddress: Address): Promise<{ decimals: number } | null> {
    try {
      const apiUrl =
        getNetwork(new URLSearchParams(window.location.search)) === "testnet"
          ? STONFI_API_TESTNET
          : STONFI_API_MAINNET;
      const tokenAddrStr = tokenAddress.toFriendly({ urlSafe: true });

      const response = await fetch(`${apiUrl}/v1/assets/${tokenAddrStr}`);
      if (!response.ok) {
        return null;
      }

      const asset = await response.json();
      return {
        decimals: asset.meta?.decimals || 9, // Default to 9 if not found
      };
    } catch (error) {
      console.error("Error fetching token metadata:", error);
      return { decimals: 9 }; // Default to 9 decimals
    }
  }

  /**
   * Simulate liquidity provision using STON.fi API
   * This handles both new pool creation and existing pool liquidity addition
   * Following official STON.fi documentation: https://docs.ston.fi/developer-section/quickstart/liquidity
   */
  async simulateLiquidityProvision(
    tokenAddress: Address,
    tonAmount: string,
    walletAddress: string,
  ): Promise<LiquiditySimulation> {
    try {
      const tonAddr = Address.parse(TON_ADDRESS);
      const tokenAddrStr = tokenAddress.toFriendly({ urlSafe: true });
      const tonAddrStr = tonAddr.toFriendly({ urlSafe: true });

      // Get token metadata for correct decimals
      const tokenMeta = await this.getTokenMetadata(tokenAddress);
      const tokenDecimals = tokenMeta?.decimals || 9;

      // Convert TON amount to base units (nanoTON)
      const tonAmountUnits = toNano(tonAmount).toString();

      // First, try to find existing pool
      const apiUrl =
        getNetwork(new URLSearchParams(window.location.search)) === "testnet"
          ? STONFI_API_TESTNET
          : STONFI_API_MAINNET;

      let poolAddress: string | null = null;
      try {
        let response = await fetch(`${apiUrl}/v1/pools/by_market/${tonAddrStr}/${tokenAddrStr}`);
        if (!response.ok && response.status === 404) {
          response = await fetch(`${apiUrl}/v1/pools/by_market/${tokenAddrStr}/${tonAddrStr}`);
        }
        if (response.ok) {
          const poolInfo = await response.json();
          poolAddress = poolInfo.address;
        }
      } catch (error) {
        // Pool doesn't exist - will create new one
        console.log("Pool doesn't exist, will create new pool");
      }

      // Use appropriate provision type based on whether pool exists
      let simulation;
      if (poolAddress) {
        // Existing pool - use Arbitrary with poolAddress
        simulation = await this.apiClient.simulateLiquidityProvision({
          provisionType: "Arbitrary",
          poolAddress: poolAddress,
          tokenA: tonAddrStr,
          tokenB: tokenAddrStr,
          tokenAUnits: tonAmountUnits,
          tokenBUnits: "0", // API calculates this based on current price
          slippageTolerance: "0.01",
          walletAddress: walletAddress,
        });
      } else {
        // New pool - use Initial (creates new pool)
        simulation = await this.apiClient.simulateLiquidityProvision({
          provisionType: "Initial",
          tokenA: tonAddrStr,
          tokenB: tokenAddrStr,
          tokenAUnits: tonAmountUnits,
          tokenBUnits: "0", // API calculates initial ratio
          slippageTolerance: "0.01",
          walletAddress: walletAddress,
        });
      }

      return simulation as LiquiditySimulation;
    } catch (error) {
      console.error("Error simulating liquidity provision:", error);
      throw error;
    }
  }

  /**
   * Create a new liquidity pool (if it doesn't exist) and add initial liquidity
   * Uses official STON.fi SDK as per documentation
   */
  async createPoolAndAddLiquidity(
    params: CreatePoolParams,
    tonConnectUI: TonConnectUI,
  ): Promise<string> {
    try {
      const network = getNetwork(new URLSearchParams(window.location.search));
      const tonAddr = Address.parse(TON_ADDRESS);
      const tonAddrStr = tonAddr.toFriendly({ urlSafe: true });
      const tokenAddrStr = params.tokenAddress.toFriendly({ urlSafe: true });

      // Step 1: Simulate liquidity provision
      const simulation = await this.simulateLiquidityProvision(
        params.tokenAddress,
        params.tonAmount,
        params.walletAddress,
      );

      if (!simulation.router) {
        throw new Error("Router information not available from simulation");
      }

      // Step 2: Build transaction using SDK
      const tonClient = this.getTonClient();
      const routerInfo: any = simulation.router;
      const { Router, pTON } = dexFactory(routerInfo);
      const router = tonClient.open(Router.create(routerInfo.address));
      const pTon = pTON.create(routerInfo.ptonMasterAddress);

      const isTonAsset = (contractAddress: string) => contractAddress === tonAddrStr;

      // Helper function to build transaction for each token
      const buildTransaction = async (args: {
        sendAmount: string;
        sendTokenAddress: string;
        otherTokenAddress: string;
      }) => {
        const txParams = {
          userWalletAddress: params.walletAddress,
          minLpOut: simulation.minLpUnits,
          sendAmount: args.sendAmount,
          otherTokenAddress: isTonAsset(args.otherTokenAddress)
            ? pTon.address
            : args.otherTokenAddress,
        };

        // TON requires proxy contract, Jettons use direct transfer
        if (isTonAsset(args.sendTokenAddress)) {
          return await router.getProvideLiquidityTonTxParams({
            ...txParams,
            proxyTon: pTon,
          });
        } else {
          return await router.getProvideLiquidityJettonTxParams({
            ...txParams,
            sendTokenAddress: args.sendTokenAddress,
          });
        }
      };

      // Step 3: Generate transaction parameters for both tokens
      const txParams = await Promise.all([
        buildTransaction({
          sendAmount: simulation.tokenAUnits,
          sendTokenAddress: simulation.tokenA,
          otherTokenAddress: simulation.tokenB,
        }),
        buildTransaction({
          sendAmount: simulation.tokenBUnits,
          sendTokenAddress: simulation.tokenB,
          otherTokenAddress: simulation.tokenA,
        }),
      ]);

      // Step 4: Format transaction messages for TonConnect
      const messages = txParams.map((txParam) => ({
        address: txParam.to.toString(),
        amount: txParam.value.toString(),
        payload: txParam.body?.toBoc().toString("base64"),
      }));

      // Step 5: Send transaction via TonConnect
      await tonConnectUI.sendTransaction({
        validUntil: Date.now() + 5 * 60 * 1000, // 5 minutes
        network: network === "testnet" ? CHAIN.TESTNET : CHAIN.MAINNET,
        messages,
      });

      return simulation.poolAddress;
    } catch (error) {
      console.error("Error creating pool and adding liquidity:", error);
      throw error;
    }
  }

  /**
   * Add liquidity to an existing pool
   */
  async addLiquidity(params: CreatePoolParams, tonConnectUI: TonConnectUI): Promise<string> {
    return this.createPoolAndAddLiquidity(params, tonConnectUI);
  }

  /**
   * Check if a pool exists for the given token pair
   */
  async checkPoolExists(tokenAddress: Address): Promise<boolean> {
    try {
      // Try to simulate - if pool doesn't exist, simulation will still work
      // but we can check the provisionType or poolAddress
      const tonAddr = Address.parse(TON_ADDRESS);
      const tonAddrStr = tonAddr.toFriendly({ urlSafe: true });
      const tokenAddrStr = tokenAddress.toFriendly({ urlSafe: true });

      // Try to fetch pool info from API
      const apiUrl =
        getNetwork(new URLSearchParams(window.location.search)) === "testnet"
          ? STONFI_API_TESTNET
          : STONFI_API_MAINNET;

      let response = await fetch(`${apiUrl}/v1/pools/by_market/${tonAddrStr}/${tokenAddrStr}`);
      if (!response.ok && response.status === 404) {
        response = await fetch(`${apiUrl}/v1/pools/by_market/${tokenAddrStr}/${tonAddrStr}`);
      }

      return response.ok;
    } catch (error) {
      console.error("Error checking pool existence:", error);
      return false;
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

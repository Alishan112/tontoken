import { TonConnectUI } from "@tonconnect/ui-react";
import { CHAIN } from "@tonconnect/sdk";
import { getNetwork } from "lib/hooks/useNetwork";
import { StonApiClient } from "@ston-fi/api";
import { dexFactory } from "@ston-fi/sdk";
import { Address, toNano, fromNano, Cell } from "@ton/core";
import { TonClient } from "@ton/ton";
import BN from "bn.js";
import { getClient } from "lib/get-ton-client";
import { makeGetCall } from "lib/make-get-call";
import { readJettonMetadata } from "lib/jetton-minter";

/**
 * STON.fi REST API Base URLs
 */
const STONFI_API_MAINNET = "https://api.ston.fi";
const STONFI_API_TESTNET = "https://api-testnet.ston.fi";

/**
 * STON.fi RPC Endpoints
 */
const STONFI_RPC_MAINNET = "https://rpc.ston.fi";
const STONFI_RPC_TESTNET = "https://rpc-testnet.ston.fi";

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
   * Set it in .env file as: REACT_APP_TON_API_KEY=your_api_key_here
   */
  private getTonClient(): TonClient {
    if (!this.tonClient) {
      const apiKey = process.env.REACT_APP_TON_API_KEY;
      // TON JSON-RPC client for blockchain interactions
      // API key is optional - TON Center works without it but with lower rate limits
      this.tonClient = new TonClient({
        endpoint: "https://toncenter.com/api/v2/jsonRPC",
        apiKey: apiKey || undefined, // Pass undefined if empty string or not set
      });
    }
    return this.tonClient;
  }

  /**
   * Convert human-readable amount to base units (nanoTON or token smallest units)
   * Note: This is mainly for reference - we use toNano directly for TON
   */
  private toBaseUnits(amount: string, decimals: number): string {
    const amountBN = new BN(toNano(amount).toString());
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
      return fromNano(amountBN.div(divisor).toString());
    }
    return fromNano(amountBN.toString());
  }

  /**
   * Get token metadata (decimals, etc.) from STON.fi RPC or blockchain
   * Uses asset.query RPC method which can find tokens not in the main registry
   * Falls back to blockchain if token is not found
   */
  private async getTokenMetadata(tokenAddress: Address): Promise<{ decimals: number } | null> {
    try {
      const rpcUrl =
        getNetwork(new URLSearchParams(window.location.search)) === "testnet"
          ? STONFI_RPC_TESTNET
          : STONFI_RPC_MAINNET;
      const tokenAddrStr = tokenAddress.toString({ urlSafe: true });

      // Use STON.fi RPC asset.query method to find token metadata
      const rpcRequest = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "asset.query",
        params: {
          condition:
            "asset:wallet_has_balance | asset:default_symbol | !(asset:blacklisted | asset:liquidity:no)",
          search_terms: [tokenAddrStr],
          limit: 50,
        },
      };

      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(rpcRequest),
      });

      if (response.ok) {
        const rpcResponse = await response.json();

        if (rpcResponse.result?.assets && rpcResponse.result.assets.length > 0) {
          const asset = rpcResponse.result.assets.find(
            (a: any) => a.contract_address === tokenAddrStr,
          );

          if (asset?.meta) {
            return {
              decimals: asset.meta.decimals || 9,
            };
          }
        }
      }

      // If not found via RPC, try REST API as fallback
      const apiUrl =
        getNetwork(new URLSearchParams(window.location.search)) === "testnet"
          ? STONFI_API_TESTNET
          : STONFI_API_MAINNET;

      const restResponse = await fetch(`${apiUrl}/v1/assets/${tokenAddrStr}`);
      if (restResponse.ok) {
        const asset = await restResponse.json();
        return {
          decimals: asset.meta?.decimals || 9,
        };
      }

      // If not found in STON.fi (RPC or REST), fetch from blockchain
      console.warn(
        `Token ${tokenAddrStr} not found in STON.fi. Fetching metadata from blockchain...`,
      );
      return await this.getTokenMetadataFromBlockchain(tokenAddress);
    } catch (error) {
      console.error("Error fetching token metadata from STON.fi, trying blockchain:", error);
      // Fallback to blockchain fetch
      try {
        return await this.getTokenMetadataFromBlockchain(tokenAddress);
      } catch (blockchainError) {
        console.error("Error fetching token metadata from blockchain:", blockchainError);
        return { decimals: 9 }; // Final fallback
      }
    }
  }

  /**
   * Fetch token metadata directly from blockchain using get_jetton_data
   */
  private async getTokenMetadataFromBlockchain(
    tokenAddress: Address,
  ): Promise<{ decimals: number } | null> {
    try {
      const tonClient = await getClient();
      const minter = await makeGetCall(
        tokenAddress,
        "get_jetton_data",
        [],
        async ([totalSupply, __, adminCell, contentCell]) => {
          const metadata = await readJettonMetadata(contentCell as unknown as Cell);
          return metadata;
        },
        tonClient,
      );

      const decimals = minter.metadata?.decimals ? parseInt(minter.metadata.decimals) : 9; // Default to 9 if not found

      return { decimals };
    } catch (error) {
      console.error("Error fetching token metadata from blockchain:", error);
      return { decimals: 9 }; // Default fallback
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
      const tokenAddrStr = tokenAddress.toString({ urlSafe: true });
      const tonAddrStr = tonAddr.toString({ urlSafe: true });

      // Convert wallet address to proper format (bounceable, urlSafe)
      // STON.fi API expects addresses in bounceable format (EQ...)
      const walletAddrParsed = Address.parse(walletAddress);
      const walletAddrStr = walletAddrParsed.toString({ urlSafe: true, bounceable: true });

      // Validate minimum amount
      const tonAmountNum = parseFloat(tonAmount);
      const MIN_TON_AMOUNT_EXISTING = 0.1; // Minimum 0.1 TON for existing pools
      const MIN_TON_AMOUNT_NEW = 2.0; // Minimum 2 TON for new pool creation

      // First, check if pool exists to determine minimum
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

      // Validate based on pool type
      const isNewPool = !poolAddress;
      const minRequired = isNewPool ? MIN_TON_AMOUNT_NEW : MIN_TON_AMOUNT_EXISTING;

      if (tonAmountNum < minRequired) {
        const poolType = isNewPool ? "new pool creation" : "existing pool";
        throw new Error(
          `Amount too low: Minimum ${minRequired} TON required for ${poolType}. ` +
            `You provided ${tonAmount} TON. Please increase the amount and try again. ` +
            `\n\nNote: New pools require higher minimum amounts (typically 2-5 TON) compared to existing pools (0.1 TON).`,
        );
      }

      // Get token metadata for correct decimals
      const tokenMeta = await this.getTokenMetadata(tokenAddress);
      const tokenDecimals = tokenMeta?.decimals || 9;

      // Convert TON amount to base units (nanoTON)
      const tonAmountUnits = toNano(tonAmount).toString();

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
          walletAddress: walletAddrStr,
        });
      } else {
        // New pool - use Initial (creates new pool)
        // For Initial pools, STON.fi requires both token amounts to establish initial price
        // Using 1:1 value ratio (1 TON = 1 Token) as default
        // Note: User must have the corresponding tokens in their wallet
        const tokenAmountNum = parseFloat(tonAmount); // Use same amount for 1:1 ratio
        const tokenAmountUnits = toNano(tokenAmountNum.toString()).toString();

        console.log(
          `Creating Initial pool with: ${tonAmount} TON and ${tokenAmountNum} tokens (1:1 ratio)`,
        );
        console.log(`Token A (TON): ${tonAmountUnits}, Token B: ${tokenAmountUnits}`);

        try {
          simulation = await this.apiClient.simulateLiquidityProvision({
            provisionType: "Initial",
            tokenA: tonAddrStr,
            tokenB: tokenAddrStr,
            tokenAUnits: tonAmountUnits,
            tokenBUnits: tokenAmountUnits, // Provide token amount for Initial pools (1:1 ratio)
            slippageTolerance: "0.01",
            walletAddress: walletAddrStr,
          });
        } catch (initialError: any) {
          // If 1:1 ratio fails, try with token_b_units = 0 to let API calculate
          console.warn(
            "Initial pool with 1:1 ratio failed, trying with token_b_units=0:",
            initialError,
          );
          if (
            initialError?.message?.includes("1011") ||
            initialError?.response?.data?.message?.includes("1011")
          ) {
            // Re-throw with better message
            throw initialError;
          }
          // Try alternative approach
          simulation = await this.apiClient.simulateLiquidityProvision({
            provisionType: "Initial",
            tokenA: tonAddrStr,
            tokenB: tokenAddrStr,
            tokenAUnits: tonAmountUnits,
            tokenBUnits: "0", // Let API calculate
            slippageTolerance: "0.01",
            walletAddress: walletAddrStr,
          });
        }
      }

      return simulation as LiquiditySimulation;
    } catch (error: any) {
      console.error("Error simulating liquidity provision:", error);

      const errorMessage = error?.message || error?.response?.data?.message || "";
      const errorStatus = error?.response?.status || error?.status;

      // Check if error is due to amount too low
      const isAmountTooLow =
        errorMessage.includes("1011") ||
        errorMessage.includes("input amount is too low") ||
        errorMessage.includes("too low") ||
        errorMessage.includes("Amount too low");

      if (isAmountTooLow || error?.message?.includes("Amount too low")) {
        // Check if this is for a new pool (Initial) or existing pool
        const isInitialProvision =
          errorMessage.includes("Initial") ||
          error?.response?.config?.url?.includes("provision_type=Initial");

        if (isInitialProvision) {
          throw new Error(
            `Amount too low for new pool creation. ` +
              `STON.fi requires a minimum of 2-5 TON for creating new liquidity pools. ` +
              `You provided ${tonAmount} TON. ` +
              `\n\nPlease increase the amount to at least 2 TON (recommended: 5 TON or more) and try again.`,
          );
        } else {
          throw new Error(
            `Amount too low for liquidity provision. ` +
              `STON.fi requires a minimum amount. ` +
              `Please increase your TON amount and try again. ` +
              `\n\nRecommended: At least 2-5 TON for new pool creation, or 0.1 TON for existing pools.`,
          );
        }
      }

      // Check if error is due to unlisted token
      const isUnlistedToken =
        errorStatus === 400 &&
        (errorMessage.includes("Could not find asset") ||
          errorMessage.includes("1040") ||
          errorMessage.includes("not found"));

      if (isUnlistedToken) {
        // Provide clear guidance for unlisted tokens
        const network = getNetwork(new URLSearchParams(window.location.search));
        throw new Error(
          `Token is not registered in STON.fi's asset registry (Error: ${errorMessage}). ` +
            `\n\nSOLUTION: For unlisted tokens, please use the "Use STON.fi web interface" option ` +
            `(checkbox at the bottom of the form). This will redirect you to STON.fi's website ` +
            `where you can manually add your token and create the liquidity pool. ` +
            `\n\nAlternatively, you can register your token with STON.fi by: ` +
            `1) Going to app.ston.fi, 2) Searching for your token address, ` +
            `3) Following the prompts to import/add your token.`,
        );
      }

      // Other errors
      throw new Error(
        `Failed to simulate liquidity provision: ${errorMessage}. ` +
          `Please ensure: 1) The token address is correct (Jetton Master address), ` +
          `2) You have sufficient balance (minimum 0.1 TON recommended), ` +
          `3) The token is deployed on ${
            getNetwork(new URLSearchParams(window.location.search)) === "testnet"
              ? "testnet"
              : "mainnet"
          }.`,
      );
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
      const tonAddrStr = tonAddr.toString({ urlSafe: true });
      const tokenAddrStr = params.tokenAddress.toString({ urlSafe: true });

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
      const tonAddrStr = tonAddr.toString({ urlSafe: true });
      const tokenAddrStr = tokenAddress.toString({ urlSafe: true });

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

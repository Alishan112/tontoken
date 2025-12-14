import BN from "bn.js";
import { Address, beginCell, Cell, toNano } from "@ton/core";
import { ContractDeployer } from "./contract-deployer";

import { createDeployParams, waitForContractDeploy, waitForSeqno, sleep } from "./utils";
import { zeroAddress } from "./utils";
import {
  buildJettonOnchainMetadata,
  burn,
  mintBody,
  transfer,
  updateMetadataBody,
} from "./jetton-minter";
import { readJettonMetadata, changeAdminBody, JettonMetaDataKeys } from "./jetton-minter";
import { getClient } from "./get-ton-client";
import { cellToAddress, makeGetCall } from "./make-get-call";
import { SendTransactionRequest, TonConnectUI } from "@tonconnect/ui-react";
import { CHAIN } from "@tonconnect/sdk";
import { getNetwork } from "./hooks/useNetwork";

export const JETTON_DEPLOY_GAS = toNano(0.25);

export enum JettonDeployState {
  NOT_STARTED,
  BALANCE_CHECK,
  UPLOAD_IMAGE,
  UPLOAD_METADATA,
  AWAITING_MINTER_DEPLOY,
  AWAITING_JWALLET_DEPLOY,
  VERIFY_MINT,
  ALREADY_DEPLOYED,
  DONE,
}

export interface JettonDeployParams {
  onchainMetaData?: {
    name: string;
    symbol: string;
    description?: string;
    image?: string;
    decimals?: string;
  };
  offchainUri?: string;
  owner: Address;
  amountToMint: BN;
}

class JettonDeployController {
  async createJetton(
    params: JettonDeployParams,
    tonConnection: TonConnectUI,
    walletAddress: string,
  ): Promise<Address> {
    const contractDeployer = new ContractDeployer();
    const tc = await getClient();

    // params.onProgress?.(JettonDeployState.BALANCE_CHECK);
    const balance = await tc.getBalance(params.owner);
    const gasRequired = BigInt(JETTON_DEPLOY_GAS.toString());
    if (balance < gasRequired) throw new Error("Not enough balance in deployer wallet");
    const deployParams = createDeployParams(params, params.offchainUri);
    const contractAddr = contractDeployer.addressForContract(deployParams);

    const wasAlreadyDeployed = await tc.isContractDeployed(contractAddr);

    if (!wasAlreadyDeployed) {
      await contractDeployer.deployContract(deployParams, tonConnection);
      // params.onProgress?.(JettonDeployState.AWAITING_MINTER_DEPLOY);
      // Wait for contract to be deployed - this also gives time for the transaction to be confirmed
      await waitForContractDeploy(contractAddr, tc);

      // Wait for the initial mint transaction to be processed
      // The contract needs to process the deploy message (which includes the mint) before get methods work
      // Even though the contract is deployed, the mint transaction included in the deployment message
      // needs additional time to be fully processed by the contract
      await sleep(15000); // Wait 15 seconds to ensure mint transaction is processed
    }

    // Retry logic for get method calls in case contract isn't fully ready
    // Exit code 7 usually means contract isn't initialized yet or transaction not processed
    let ownerJWalletAddr: Address | undefined;
    let retries = 20; // Increased retries to 20 for more robustness
    let lastError: any;

    while (retries > 0) {
      try {
        // Verify contract is still deployed before calling get method
        const isDeployed = await tc.isContractDeployed(contractAddr);
        if (!isDeployed) {
          throw new Error("Contract is not deployed");
        }

        ownerJWalletAddr = await makeGetCall(
          contractAddr,
          "get_wallet_address",
          [beginCell().storeAddress(params.owner).endCell()],
          ([addr]) => (addr as Cell).beginParse().loadAddress()!,
          tc,
        );
        break;
      } catch (error: any) {
        lastError = error;
        retries--;
        if (retries === 0) {
          break;
        }
        // Wait longer between retries - contract needs time to initialize and process transactions
        // Exit code 7 often means the contract hasn't processed the initial transaction yet
        // Increase wait time to give the network more time to process
        await sleep(6000); // Increased wait time between retries
      }
    }

    if (!ownerJWalletAddr) {
      const errorMsg = lastError?.message || "Unknown error";
      throw new Error(
        `Failed to get owner jetton wallet address after multiple attempts. ` +
          `Contract address: ${contractAddr.toString()}. ` +
          `Error: ${errorMsg}. ` +
          `This usually means the contract hasn't finished processing the initial deployment transaction. ` +
          `Please wait a few more seconds and try refreshing the page, or check the transaction status on a TON explorer.`,
      );
    }

    // params.onProgress?.(JettonDeployState.AWAITING_JWALLET_DEPLOY);
    await waitForContractDeploy(ownerJWalletAddr, tc);

    // params.onProgress?.(
    //   JettonDeployState.VERIFY_MINT,
    //   undefined,
    //   contractAddr.toFriendly()
    // ); // TODO better way of emitting the contract?

    // params.onProgress?.(JettonDeployState.DONE);
    return contractAddr;
  }

  async burnAdmin(contractAddress: Address, tonConnection: TonConnectUI, walletAddress: string) {
    const tc = await getClient();
    const waiter = await waitForSeqno(null);

    const network = getNetwork(new URLSearchParams(window.location.search));
    const tx: SendTransactionRequest = {
      validUntil: Math.floor(Date.now() / 1000) + 5 * 60, // Convert to seconds (5 minutes)
      network: network === "testnet" ? CHAIN.TESTNET : CHAIN.MAINNET,
      messages: [
        {
          address: contractAddress.toString(),
          amount: toNano(0.01).toString(),
          stateInit: undefined,
          payload: changeAdminBody(zeroAddress()).toBoc().toString("base64"),
        },
      ],
    };

    await tonConnection.sendTransaction(tx);

    await waiter();
  }

  async mint(
    tonConnection: TonConnectUI,
    jettonMaster: Address,
    amount: BN,
    walletAddress: string,
  ) {
    const tc = await getClient();
    // Simplified: just create a waiter function since openWalletFromAddress doesn't exist in @ton/ton
    const waiter = await waitForSeqno(null);

    const network = getNetwork(new URLSearchParams(window.location.search));
    const tx: SendTransactionRequest = {
      validUntil: Math.floor(Date.now() / 1000) + 5 * 60, // Convert to seconds (5 minutes)
      network: network === "testnet" ? CHAIN.TESTNET : CHAIN.MAINNET,
      messages: [
        {
          address: jettonMaster.toString(),
          amount: toNano(0.04).toString(),
          stateInit: undefined,
          payload: mintBody(Address.parse(walletAddress), amount, toNano(0.02), 0)
            .toBoc()
            .toString("base64"),
        },
      ],
    };

    await tonConnection.sendTransaction(tx);
    await waiter();
  }

  async transfer(
    tonConnection: TonConnectUI,
    amount: BN,
    toAddress: string,
    fromAddress: string,
    ownerJettonWallet: string,
  ) {
    const tc = await getClient();

    const waiter = await waitForSeqno(null);

    const network = getNetwork(new URLSearchParams(window.location.search));
    const tx: SendTransactionRequest = {
      validUntil: Math.floor(Date.now() / 1000) + 5 * 60, // Convert to seconds (5 minutes)
      network: network === "testnet" ? CHAIN.TESTNET : CHAIN.MAINNET,
      messages: [
        {
          address: ownerJettonWallet,
          amount: toNano(0.05).toString(),
          stateInit: undefined,
          payload: transfer(Address.parse(toAddress), Address.parse(fromAddress), amount)
            .toBoc()
            .toString("base64"),
        },
      ],
    };

    await tonConnection.sendTransaction(tx);

    await waiter();
  }

  async burnJettons(
    tonConnection: TonConnectUI,
    amount: BN,
    jettonAddress: string,
    walletAddress: string,
  ) {
    const tc = await getClient();

    const waiter = await waitForSeqno(null);

    const network = getNetwork(new URLSearchParams(window.location.search));
    const tx: SendTransactionRequest = {
      validUntil: Math.floor(Date.now() / 1000) + 5 * 60, // Convert to seconds (5 minutes)
      network: network === "testnet" ? CHAIN.TESTNET : CHAIN.MAINNET,
      messages: [
        {
          address: jettonAddress,
          amount: toNano(0.031).toString(),
          stateInit: undefined,
          payload: burn(amount, Address.parse(walletAddress)).toBoc().toString("base64"),
        },
      ],
    };

    await tonConnection.sendTransaction(tx);

    await waiter();
  }

  async getJettonDetails(contractAddr: Address, owner: Address) {
    const tc = await getClient();
    const minter = await makeGetCall(
      contractAddr,
      "get_jetton_data",
      [],
      async ([totalSupply, __, adminCell, contentCell]) => ({
        ...(await readJettonMetadata(contentCell as unknown as Cell)),
        admin: cellToAddress(adminCell),
        totalSupply: totalSupply as BN,
      }),
      tc,
    );

    const jWalletAddress = await makeGetCall(
      contractAddr,
      "get_wallet_address",
      [beginCell().storeAddress(owner).endCell()],
      ([addressCell]) => cellToAddress(addressCell),
      tc,
    );

    const isDeployed = await tc.isContractDeployed(jWalletAddress);

    let jettonWallet;
    if (isDeployed) {
      jettonWallet = await makeGetCall(
        jWalletAddress,
        "get_wallet_data",
        [],
        ([amount, _, jettonMasterAddressCell]) => ({
          balance: amount as unknown as BN,
          jWalletAddress,
          jettonMasterAddress: cellToAddress(jettonMasterAddressCell),
        }),
        tc,
      );
    } else {
      jettonWallet = null;
    }

    return {
      minter,
      jettonWallet,
    };
  }

  async fixFaultyJetton(
    contractAddress: Address,
    data: {
      [s in JettonMetaDataKeys]?: string | undefined;
    },
    connection: TonConnectUI,
    walletAddress: string,
  ) {
    const tc = await getClient();
    // Simplified: just create a waiter function since openWalletFromAddress doesn't exist in @ton/ton
    const waiter = await waitForSeqno(null);
    const body = updateMetadataBody(buildJettonOnchainMetadata(data));
    const network = getNetwork(new URLSearchParams(window.location.search));
    const tx: SendTransactionRequest = {
      validUntil: Math.floor(Date.now() / 1000) + 5 * 60, // Convert to seconds (5 minutes)
      network: network === "testnet" ? CHAIN.TESTNET : CHAIN.MAINNET,
      messages: [
        {
          address: contractAddress.toString(),
          amount: toNano(0.01).toString(),
          stateInit: undefined,
          payload: body.toBoc().toString("base64"),
        },
      ],
    };

    await connection.sendTransaction(tx);

    await waiter();
  }

  async updateMetadata(
    contractAddress: Address,
    data: {
      [s in JettonMetaDataKeys]?: string | undefined;
    },
    connection: TonConnectUI,
    walletAddress: string,
  ) {
    const tc = await getClient();
    // Simplified: just create a waiter function since openWalletFromAddress doesn't exist in @ton/ton
    const waiter = await waitForSeqno(null);

    const network = getNetwork(new URLSearchParams(window.location.search));
    const tx: SendTransactionRequest = {
      validUntil: Math.floor(Date.now() / 1000) + 5 * 60, // Convert to seconds (5 minutes)
      network: network === "testnet" ? CHAIN.TESTNET : CHAIN.MAINNET,
      messages: [
        {
          address: contractAddress.toString(),
          amount: toNano(0.01).toString(),
          stateInit: undefined,
          payload: updateMetadataBody(buildJettonOnchainMetadata(data)).toBoc().toString("base64"),
        },
      ],
    };

    await connection.sendTransaction(tx);

    await waiter();
  }
}

const jettonDeployController = new JettonDeployController();
export { jettonDeployController };

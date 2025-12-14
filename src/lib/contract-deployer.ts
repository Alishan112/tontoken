import BN from "bn.js";
import { Address, Cell, contractAddress, beginCell, storeStateInit } from "@ton/core";
import { SendTransactionRequest, TonConnectUI } from "@tonconnect/ui-react";
import { CHAIN } from "@tonconnect/sdk";
import { getNetwork } from "./hooks/useNetwork";

interface ContractDeployDetails {
  deployer: Address;
  value: BN | bigint;
  code: Cell;
  data: Cell;
  message?: Cell;
  dryRun?: boolean;
}

export class ContractDeployer {
  addressForContract(params: ContractDeployDetails) {
    return contractAddress(0, {
      data: params.data,
      code: params.code,
    });
  }

  async deployContract(
    params: ContractDeployDetails,
    tonConnection: TonConnectUI,
  ): Promise<Address> {
    const _contractAddress = this.addressForContract(params);
    // Use storeStateInit to properly serialize StateInit like the old version
    const stateInitCell = beginCell()
      .store(
        storeStateInit({
          code: params.code,
          data: params.data,
        }),
      )
      .endCell();

    if (!params.dryRun) {
      const network = getNetwork(new URLSearchParams(window.location.search));
      const message: any = {
        address: _contractAddress.toString(),
        amount: (typeof params.value === "bigint"
          ? params.value
          : params.value.toString()
        ).toString(),
        stateInit: stateInitCell.toBoc().toString("base64"),
      };

      // Only include payload if message exists
      if (params.message) {
        message.payload = params.message.toBoc().toString("base64");
      }

      const tx: SendTransactionRequest = {
        validUntil: Math.floor(Date.now() / 1000) + 5 * 60, // Convert to seconds (5 minutes)
        network: network === "testnet" ? CHAIN.TESTNET : CHAIN.MAINNET,
        messages: [message],
      };

      try {
        await tonConnection.sendTransaction(tx);
      } catch (error) {
        console.error("TON Connect transaction error:", error);
        throw error;
      }
    }

    return _contractAddress;
  }
}

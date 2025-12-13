import BN from "bn.js";
import { Address, Cell, contractAddress, beginCell } from "@ton/core";
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
    const cell = beginCell()
      .storeUint(0, 1) // split_depth
      .storeUint(0, 1) // special
      .storeRef(params.code)
      .storeRef(params.data)
      .endCell();
    if (!params.dryRun) {
      const network = getNetwork(new URLSearchParams(window.location.search));
      const tx: SendTransactionRequest = {
        validUntil: Date.now() + 5 * 60 * 1000,
        network: network === "testnet" ? CHAIN.TESTNET : CHAIN.MAINNET,
        messages: [
          {
            address: _contractAddress.toString(),
            amount: (typeof params.value === "bigint"
              ? params.value
              : params.value.toString()
            ).toString(),
            stateInit: cell.toBoc().toString("base64"),
            payload: params.message?.toBoc().toString("base64"),
          },
        ],
      };

      await tonConnection.sendTransaction(tx);
    }

    return _contractAddress;
  }
}

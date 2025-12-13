import { Address, beginCell, toNano } from "@ton/core";
import { TonClient } from "@ton/ton";
import { JettonDeployParams, JETTON_DEPLOY_GAS } from "./deploy-controller";
import { initData, JETTON_MINTER_CODE, mintBody } from "./jetton-minter";

export async function sleep(time: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}

export function zeroAddress(): Address {
  return beginCell()
    .storeUint(2, 2)
    .storeUint(0, 1)
    .storeUint(0, 8)
    .storeUint(0, 256)
    .endCell()
    .beginParse()
    .loadAddress() as Address;
}

// Simplified waitForSeqno - just wait a fixed time since we're using TonConnect
// The old wallet API (openWalletFromAddress) doesn't exist in @ton/ton
export async function waitForSeqno(_wallet: any) {
  // Return a function that waits a reasonable time for transaction confirmation
  return async () => {
    await sleep(5000); // Wait 5 seconds for transaction to be processed
  };
}

export async function waitForContractDeploy(address: Address, client: TonClient) {
  let isDeployed = false;
  let maxTries = 25;
  while (!isDeployed && maxTries > 0) {
    maxTries--;
    isDeployed = await client.isContractDeployed(address);
    if (isDeployed) return;
    await sleep(3000);
  }
  throw new Error("Timeout");
}

export const createDeployParams = (params: JettonDeployParams, offchainUri?: string) => {
  const queryId = parseInt(process.env.REACT_APP_DEPLOY_QUERY_ID ?? "0");

  return {
    code: JETTON_MINTER_CODE,
    data: initData(params.owner, params.onchainMetaData, offchainUri),
    deployer: params.owner,
    value: JETTON_DEPLOY_GAS,
    message: mintBody(params.owner, params.amountToMint, toNano(0.2), queryId), // toNano returns bigint, mintBody accepts both
  };
};

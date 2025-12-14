import { Address, Cell, TupleItem } from "@ton/core";
import { TonClient, TupleReader } from "@ton/ton";
import BN from "bn.js";

function _prepareParams(params: any[] = []): TupleItem[] {
  return params.map((p): TupleItem => {
    if (p instanceof Cell) {
      return {
        type: "cell",
        cell: p,
      };
    } else if (p instanceof BN) {
      return {
        type: "int",
        value: BigInt(p.toString()),
      };
    } else if (typeof p === "bigint") {
      return {
        type: "int",
        value: p,
      };
    } else if (typeof p === "number") {
      return {
        type: "int",
        value: BigInt(p),
      };
    }

    throw new Error(`unknown type: ${typeof p}`);
  });
}

export type GetResponseValue = Cell | BN | null;

export function cellToAddress(s: GetResponseValue): Address {
  return (s as Cell).beginParse().loadAddress() as Address;
}

function _parseGetMethodCall(stack: TupleReader): GetResponseValue[] {
  const result: GetResponseValue[] = [];

  // Read all items from TupleReader sequentially
  // TupleReader provides methods to read different types
  while (stack.remaining > 0) {
    // Try reading as number first (most common case)
    try {
      const num = stack.readBigNumber();
      result.push(new BN(num.toString()));
    } catch {
      // Not a number, try cell
      try {
        const cell = stack.readCell();
        result.push(cell);
      } catch {
        // Not a cell either, might be null or unsupported
        // Skip null values or throw for unsupported types
        throw new Error(`unsupported tuple item type at position ${result.length}`);
      }
    }
  }

  return result;
}

export async function makeGetCall<T>(
  address: Address | undefined,
  name: string,
  params: any[],
  parser: (stack: GetResponseValue[]) => T,
  tonClient: TonClient,
) {
  try {
    const result = await tonClient.callGetMethod(address!, name, _prepareParams(params));
    return parser(_parseGetMethodCall(result.stack));
  } catch (error: any) {
    // Enhance error message with more context
    const errorMessage = error?.message || String(error);
    if (
      errorMessage.includes("exit_code") ||
      errorMessage.includes("exitCode") ||
      errorMessage.includes("exit code")
    ) {
      throw new Error(
        `Unable to execute get method '${name}' on contract ${address?.toString()}. ` +
          `Error: ${errorMessage}. ` +
          `Make sure the contract is deployed and the method parameters are correct.`,
      );
    }
    throw error;
  }
}

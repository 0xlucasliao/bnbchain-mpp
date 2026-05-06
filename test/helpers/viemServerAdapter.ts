import type { PublicClient } from "viem";
import type { ServerPublicClientAdapter } from "../../src/server/index.js";

export function publicClientToServerAdapter(client: PublicClient): ServerPublicClientAdapter {
  return {
    async getTransaction({ hash }) {
      const tx = await client.getTransaction({ hash });
      return {
        to: tx.to,
        value: tx.value,
      };
    },
    async getTransactionReceipt({ hash }) {
      const receipt = await client.getTransactionReceipt({ hash });
      return {
        status: receipt.status,
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
        })),
        blockNumber: receipt.blockNumber,
      };
    },
    async getBlockNumber() {
      return client.getBlockNumber();
    },
  };
}

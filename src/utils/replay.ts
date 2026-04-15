export interface TxMeta {
  from: string;
  to: string;
  amount: string;
  currency: string;
  chainId: number;
  consumedAt: number;
}

export interface ConsumedStore {
  has(txHash: string): Promise<boolean>;
  add(txHash: string, meta: TxMeta): Promise<void>;
}

export class InMemoryStore implements ConsumedStore {
  private readonly consumed = new Map<string, TxMeta>();

  async has(txHash: string): Promise<boolean> {
    return this.consumed.has(txHash.toLowerCase());
  }

  async add(txHash: string, meta: TxMeta): Promise<void> {
    this.consumed.set(txHash.toLowerCase(), meta);
  }
}

interface RedisLikeClient {
  set(
    key: string,
    value: string,
    options?: {
      EX?: number;
      NX?: boolean;
    },
  ): Promise<unknown>;
  exists(key: string): Promise<number>;
}

export class RedisStore implements ConsumedStore {
  constructor(
    private readonly client: RedisLikeClient,
    private readonly options: { prefix?: string; ttlSeconds?: number } = {},
  ) {}

  private key(txHash: string): string {
    return `${this.options.prefix ?? "bnb:mpp:consumed"}:${txHash.toLowerCase()}`;
  }

  async has(txHash: string): Promise<boolean> {
    const exists = await this.client.exists(this.key(txHash));
    return exists > 0;
  }

  async add(txHash: string, meta: TxMeta): Promise<void> {
    const key = this.key(txHash);
    const payload = JSON.stringify(meta);
    const ttlSeconds = this.options.ttlSeconds;
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, payload, { EX: ttlSeconds });
      return;
    }

    await this.client.set(key, payload);
  }
}

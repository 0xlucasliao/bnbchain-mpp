export class SimulationError extends Error {
  public readonly code = "SIMULATION_FAILED";

  public constructor(message: string) {
    super(message);
    this.name = "SimulationError";
  }
}

export type SimulationParams = {
  to: `0x${string}`;
  from?: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
};

export interface SimulationClientAdapter {
  call(args: {
    account?: unknown;
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
  }): Promise<unknown>;
}

export async function simulateCall(
  client: SimulationClientAdapter,
  params: SimulationParams,
): Promise<void> {
  try {
    await client.call({
      account: params.from,
      to: params.to,
      data: params.data,
      value: params.value,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown simulation error";
    throw new SimulationError(message);
  }
}

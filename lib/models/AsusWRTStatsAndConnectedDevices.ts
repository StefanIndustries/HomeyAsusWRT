import { AsusWRTConnectedClient } from "./AsusWRTConnectedClient";

export interface AsusWRTStatsAndConnectedDevices {
    CPUUsagePercentage: number,
    MemoryUsagePercentage: number,
    ConnectedClients: AsusWRTConnectedClient[]
}
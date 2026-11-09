import type { AsusConnectedDevice } from 'node-asuswrt/lib/models/asus-connected-device';
import type { AsusTrafficData } from 'node-asuswrt/lib/models/asus-traffic-data';

export interface ConnectedClientsSummary {
    total: number;
    wired: number;
    wireless: number;
    wireless24g: number;
    wireless5g: number;
    wireless6g: number;
}

/** Counts clients across the whole network (router and all access points), each MAC once. */
export function summarizeConnectedClients(devices: AsusConnectedDevice[]): ConnectedClientsSummary {
    const unique = new Map<string, AsusConnectedDevice>();
    for (const device of devices) {
        if (device && device.mac) {
            unique.set(device.mac.toUpperCase(), device);
        }
    }
    const summary: ConnectedClientsSummary = { total: 0, wired: 0, wireless: 0, wireless24g: 0, wireless5g: 0, wireless6g: 0 };
    for (const device of unique.values()) {
        summary.total++;
        switch (device.connectionMethod) {
            case '2g': summary.wireless24g++; summary.wireless++; break;
            case '5g': summary.wireless5g++; summary.wireless++; break;
            case '6g': summary.wireless6g++; summary.wireless++; break;
            default: summary.wired++;
        }
    }
    return summary;
}

export interface TrafficSample {
    /** Epoch milliseconds of the second counter read. */
    time: number;
    /** Mbit/s */
    download: number;
    /** Mbit/s */
    upload: number;
}

export interface TrafficSamplerOptions {
    intervalMs: number;
    windowMs: number;
    /** Stop polling the router when no widget asked for data for this long. */
    idleStopMs: number;
}

export interface SamplerTimers {
    setTimeout: (callback: () => void, ms: number) => unknown;
    clearTimeout: (handle: any) => void;
    now: () => number;
}

const BITS_PER_MIB = 1024 * 1024 * 8;

/**
 * Samples the router's WAN byte counters on demand and keeps the last `windowMs` of throughput.
 * Polling starts on the first `getSamples()` call and stops by itself once widgets stop asking.
 */
export class TrafficSampler {
    private samples: TrafficSample[] = [];
    private previous?: { time: number, data: AsusTrafficData };
    private timer: unknown;
    private running = false;
    private lastRequest = 0;
    private lastError?: string;

    constructor(
        private readonly read: () => Promise<AsusTrafficData>,
        private readonly timers: SamplerTimers,
        private readonly options: TrafficSamplerOptions = { intervalMs: 2000, windowMs: 30000, idleStopMs: 15000 }
    ) {}

    getSamples(): { samples: TrafficSample[], intervalMs: number, windowMs: number, error?: string } {
        this.lastRequest = this.timers.now();
        if (!this.running) {
            this.running = true;
            void this.tick();
        }
        const since = this.timers.now() - this.options.windowMs;
        return {
            samples: this.samples.filter(sample => sample.time >= since),
            intervalMs: this.options.intervalMs,
            windowMs: this.options.windowMs,
            error: this.lastError
        };
    }

    stop() {
        this.running = false;
        if (this.timer !== undefined) {
            this.timers.clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private async tick() {
        this.timer = undefined;
        if (!this.running) {
            return;
        }
        if (this.timers.now() - this.lastRequest > this.options.idleStopMs) {
            // Nobody is watching: stop and start fresh next time, so stale rates are not shown.
            this.stop();
            this.samples = [];
            this.previous = undefined;
            return;
        }
        try {
            const data = await this.read();
            const time = this.timers.now();
            this.addSample(time, data);
            this.lastError = undefined;
        } catch (err) {
            this.lastError = err instanceof Error ? err.message : String(err);
            this.previous = undefined;
        }
        if (this.running) {
            this.timer = this.timers.setTimeout(() => void this.tick(), this.options.intervalMs);
        }
    }

    private addSample(time: number, data: AsusTrafficData) {
        const previous = this.previous;
        this.previous = { time, data };
        if (!previous || time <= previous.time) {
            return;
        }
        const seconds = (time - previous.time) / 1000;
        const received = data.trafficReceived - previous.data.trafficReceived;
        const sent = data.trafficSent - previous.data.trafficSent;
        // Counters reset on reconnect/reboot; skip that interval instead of showing a negative spike.
        if (!(received >= 0 && sent >= 0)) {
            return;
        }
        this.samples.push({
            time,
            download: Math.round(received * BITS_PER_MIB / 1e6 / seconds * 100) / 100,
            upload: Math.round(sent * BITS_PER_MIB / 1e6 / seconds * 100) / 100
        });
        const keepFrom = time - this.options.windowMs;
        this.samples = this.samples.filter(sample => sample.time >= keepFrom);
    }
}

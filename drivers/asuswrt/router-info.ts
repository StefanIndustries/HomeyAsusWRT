import type { AsusEthernetPort, AsusTemperatures, AsusWirelessChannel } from 'node-asuswrt/lib/models/asus-router-info';
import type { AsusOoklaSpeedtestResult } from 'node-asuswrt/lib/models/asus-ookla-speedtest-result';

export interface DynamicCapabilityValue {
    id: string;
    title: { en: string, nl: string };
    value: number;
}

/**
 * Capabilities that are only added when the device reports them (e.g. a temperature sensor).
 * They are not part of the static capability lists, so they must not be removed as "unknown".
 */
export const DYNAMIC_CAPABILITY_PREFIXES = ['measure_temperature.', 'wifi_channel.'];

export function isDynamicCapability(id: string): boolean {
    return DYNAMIC_CAPABILITY_PREFIXES.some(prefix => id.startsWith(prefix));
}

const TEMPERATURES: { key: keyof AsusTemperatures, id: string, title: { en: string, nl: string } }[] = [
    { key: 'cpu', id: 'measure_temperature.cpu', title: { en: 'CPU temperature', nl: 'CPU temperatuur' } },
    { key: 'radio2g', id: 'measure_temperature.radio_2g', title: { en: '2.4 GHz temperature', nl: '2.4 GHz temperatuur' } },
    { key: 'radio5g', id: 'measure_temperature.radio_5g', title: { en: '5 GHz temperature', nl: '5 GHz temperatuur' } },
    { key: 'radio5g2', id: 'measure_temperature.radio_5g2', title: { en: '5 GHz-2 temperature', nl: '5 GHz-2 temperatuur' } },
    { key: 'radio6g', id: 'measure_temperature.radio_6g', title: { en: '6 GHz temperature', nl: '6 GHz temperatuur' } },
];

/** Only sensors the device actually reports; an empty list means no temperature capability is added. */
export function temperatureCapabilityValues(temperatures: AsusTemperatures): DynamicCapabilityValue[] {
    return TEMPERATURES
        .filter(t => typeof temperatures[t.key] === 'number' && Number.isFinite(temperatures[t.key]))
        .map(t => ({ id: t.id, title: t.title, value: temperatures[t.key] as number }));
}

/** One capability per radio with a known band and an active channel; a second 5 GHz radio gets its own id. */
export function wifiChannelCapabilityValues(channels: AsusWirelessChannel[]): DynamicCapabilityValue[] {
    const values: DynamicCapabilityValue[] = [];
    for (const radio of channels) {
        if (!radio.band || !radio.channel) {
            continue;
        }
        let suffix = radio.band === '2.4 GHz' ? '2_4ghz' : radio.band === '5 GHz' ? '5ghz' : '6ghz';
        let label = radio.band;
        if (values.some(value => value.id === `wifi_channel.${suffix}`)) {
            suffix += '_2';
            label += '-2';
        }
        values.push({
            id: `wifi_channel.${suffix}`,
            title: { en: `${label} channel`, nl: `${label} kanaal` },
            value: radio.channel
        });
    }
    return values;
}

export function ethernetPortChanges(previous: AsusEthernetPort[] | undefined, current: AsusEthernetPort[]): {
    connected: AsusEthernetPort[], disconnected: AsusEthernetPort[]
} {
    // The first read only establishes the baseline.
    if (!previous) {
        return { connected: [], disconnected: [] };
    }
    const wasConnected = (port: AsusEthernetPort) => previous.find(old => old.name === port.name)?.connected;
    return {
        connected: current.filter(port => port.connected && wasConnected(port) === false),
        disconnected: current.filter(port => !port.connected && wasConnected(port) === true)
    };
}

const round = (value: number) => Math.round(value * 100) / 100;

function mbps(phase: { bytes?: unknown, elapsed?: unknown } | undefined): number | undefined {
    const bytes = Number(phase?.bytes), elapsed = Number(phase?.elapsed);
    return bytes >= 0 && elapsed > 0 && Number.isFinite(bytes) && Number.isFinite(elapsed)
        ? round((bytes * 8) / (elapsed / 1000) / 1000000)
        : undefined;
}

/** Converts a router speedtest result into Flow tokens; rejects incomplete results instead of returning NaN. */
export function speedtestTokens(result: AsusOoklaSpeedtestResult | undefined): {
    download_speed: number, upload_speed: number, ping: number, packet_loss: number
} {
    const download = mbps(result?.download), upload = mbps(result?.upload);
    const ping = Number(result?.ping?.latency);
    if (download === undefined || upload === undefined || !Number.isFinite(ping)) {
        throw new Error('The router returned an incomplete speedtest result');
    }
    const packetLoss = Number(result?.packetLoss);
    return {
        download_speed: download,
        upload_speed: upload,
        ping: round(ping),
        // Ookla omits packet loss when it could not be measured.
        packet_loss: Number.isFinite(packetLoss) ? round(packetLoss) : 0
    };
}

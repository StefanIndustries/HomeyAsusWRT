const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const {
    temperatureCapabilityValues, wifiChannelCapabilityValues, ethernetPortChanges, speedtestTokens, isDynamicCapability
} = require('../.homeybuild/drivers/asuswrt/router-info');

test('no temperature capabilities for a device without sensors', () => {
    // RT-AX52 Pro reports no sensors at all.
    assert.deepEqual(temperatureCapabilityValues({}), []);
});

test('only reported temperatures become capabilities', () => {
    const values = temperatureCapabilityValues({ cpu: 49, radio2g: 54, radio5g: 58 });
    assert.deepEqual(values.map(v => [v.id, v.value]), [
        ['measure_temperature.cpu', 49], ['measure_temperature.radio_2g', 54], ['measure_temperature.radio_5g', 58]
    ]);
    // An AiMesh node with only a CPU sensor.
    assert.deepEqual(temperatureCapabilityValues({ cpu: 63.109 }).map(v => v.id), ['measure_temperature.cpu']);
    assert.deepEqual(temperatureCapabilityValues({ cpu: NaN }), []);
});

test('wifi channels skip unknown/inactive radios and number a second 5 GHz radio', () => {
    assert.deepEqual(wifiChannelCapabilityValues([
        { unit: 0, band: '2.4 GHz', channel: 11 }, { unit: 1, band: '5 GHz', channel: 128 },
        { unit: 2, band: '5 GHz', channel: 36 }, { unit: 3, band: undefined, channel: 5 }, { unit: 4, band: '6 GHz', channel: 0 }
    ]).map(v => [v.id, v.value, v.title.en]), [
        ['wifi_channel.2_4ghz', 11, '2.4 GHz channel'],
        ['wifi_channel.5ghz', 128, '5 GHz channel'],
        ['wifi_channel.5ghz_2', 36, '5 GHz-2 channel']
    ]);
});

test('dynamic capabilities are kept when syncing the static capability list', () => {
    assert.ok(isDynamicCapability('measure_temperature.cpu'));
    assert.ok(isDynamicCapability('wifi_channel.5ghz'));
    assert.ok(!isDynamicCapability('meter_cpu_usage'));
});

test('ethernet port changes need a baseline and report link transitions only', () => {
    const before = [{ name: 'LAN 1', connected: true, speedMbps: 1000 }, { name: 'LAN 2', connected: false, speedMbps: 0 }];
    const after = [{ name: 'LAN 1', connected: false, speedMbps: 0 }, { name: 'LAN 2', connected: true, speedMbps: 100 }, { name: 'LAN 3', connected: true, speedMbps: 1000 }];
    assert.deepEqual(ethernetPortChanges(undefined, after), { connected: [], disconnected: [] });
    const changes = ethernetPortChanges(before, after);
    assert.deepEqual(changes.connected.map(p => p.name), ['LAN 2']);
    assert.deepEqual(changes.disconnected.map(p => p.name), ['LAN 1']);
});

test('speedtest tokens are computed in Mbit/s and missing packet loss is 0', () => {
    assert.deepEqual(speedtestTokens({
        download: { bytes: 125000000, elapsed: 10000 }, upload: { bytes: 62500000, elapsed: 10000 }, ping: { latency: 12.345 }
    }), { download_speed: 100, upload_speed: 50, ping: 12.35, packet_loss: 0 });
});

test('incomplete speedtest results are rejected instead of producing NaN tokens', () => {
    for (const result of [undefined, {}, { download: { bytes: 1, elapsed: 0 }, upload: { bytes: 1, elapsed: 1 }, ping: { latency: 1 } },
        { download: { bytes: 1, elapsed: 1 }, upload: { bytes: 1, elapsed: 1 }, ping: {} }]) {
        assert.throws(() => speedtestTokens(result), /incomplete speedtest result/);
    }
});

test('new flow cards and capabilities have compose definitions', () => {
    const compose = join(__dirname, '../.homeycompose');
    for (const file of ['flow/triggers/ethernet-port-connected.json', 'flow/triggers/ethernet-port-disconnected.json',
        'flow/conditions/ethernet-port-is-connected.json', 'capabilities/firmware_version.json', 'capabilities/public_ip.json',
        'capabilities/meter_dhcp_leases.json', 'capabilities/wifi_channel.json']) {
        assert.ok(existsSync(join(compose, file)), file);
        JSON.parse(readFileSync(join(compose, file), 'utf8'));
    }
});

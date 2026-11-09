const assert = require('node:assert/strict');
const { test } = require('node:test');
const { summarizeConnectedClients, TrafficSampler } = require('../.homeybuild/drivers/asuswrt/network-widgets');

test('client summary counts the whole network once per MAC', () => {
    const summary = summarizeConnectedClients([
        { mac: 'aa:00:00:00:00:01', connectionMethod: 'wired' },
        { mac: 'AA:00:00:00:00:01', connectionMethod: 'wired' }, // same client reported by two nodes
        { mac: 'AA:00:00:00:00:02', connectionMethod: '2g' },
        { mac: 'AA:00:00:00:00:03', connectionMethod: '5g' },
        { mac: 'AA:00:00:00:00:04', connectionMethod: '6g' },
        { mac: '', connectionMethod: '5g' },
    ]);
    assert.deepEqual(summary, { total: 4, wired: 1, wireless: 3, wireless24g: 1, wireless5g: 1, wireless6g: 1 });
});

/** Manual clock and timer queue so the sampler can be driven step by step. */
function fakeTimers() {
    let now = 1_000_000;
    const queue = [];
    return {
        timers: {
            now: () => now,
            setTimeout: (callback, ms) => { const timer = { at: now + ms, callback }; queue.push(timer); return timer; },
            clearTimeout: timer => { const i = queue.indexOf(timer); if (i >= 0) queue.splice(i, 1); },
        },
        async advance(ms) {
            now += ms;
            for (let timer; (timer = queue.find(t => t.at <= now));) {
                queue.splice(queue.indexOf(timer), 1);
                await timer.callback();
                await new Promise(resolve => setImmediate(resolve));
            }
        },
        pending: () => queue.length,
        flush: () => new Promise(resolve => setImmediate(resolve)),
    };
}

const MIB = 1024 * 1024;

test('sampler converts MiB counters to Mbit/s and keeps a 30 second window', async () => {
    const clock = fakeTimers();
    let received = 0, sent = 0, reads = 0;
    const sampler = new TrafficSampler(async () => {
        reads++;
        received += (12.5e6 / MIB) * 2; // 12.5 MB/s = 100 Mbit/s for 2 seconds
        sent += (1.25e6 / MIB) * 2;     // 10 Mbit/s
        return { trafficReceived: received, trafficSent: sent };
    }, clock.timers, { intervalMs: 2000, windowMs: 30000, idleStopMs: 60000 });

    assert.deepEqual(sampler.getSamples().samples, []);
    await clock.flush();
    for (let i = 0; i < 20; i++) {
        sampler.getSamples();
        await clock.advance(2000);
    }
    const { samples } = sampler.getSamples();
    assert.equal(reads, 21);
    assert.equal(samples.at(-1).download, 100);
    assert.equal(samples.at(-1).upload, 10);
    assert.ok(samples.length <= 16, `window should hold ~15 samples, got ${samples.length}`);
    assert.ok(samples[0].time >= samples.at(-1).time - 30000);
    sampler.stop();
});

test('sampler skips counter resets and stops polling when no widget asks for data', async () => {
    const clock = fakeTimers();
    const values = [100, 110, 5, 15];
    let reads = 0;
    const sampler = new TrafficSampler(async () => {
        const value = values[Math.min(reads++, values.length - 1)];
        return { trafficReceived: value, trafficSent: value };
    }, clock.timers, { intervalMs: 2000, windowMs: 30000, idleStopMs: 5000 });

    // The widget polls every 2 seconds, which keeps the sampler running.
    sampler.getSamples();
    await clock.flush();
    await clock.advance(2000); // 110: +10 MiB
    sampler.getSamples();
    await clock.advance(2000); // 5: reset, skipped
    sampler.getSamples();
    await clock.advance(2000); // 15: +10 MiB
    assert.ok(sampler.getSamples().samples.every(sample => sample.download >= 0));
    assert.equal(sampler.getSamples().samples.length, 2);

    await clock.advance(6000); // idle longer than idleStopMs
    await clock.advance(2000);
    assert.equal(clock.pending(), 0, 'polling stops when idle');
    const readsWhenStopped = reads;
    await clock.advance(10000);
    assert.equal(reads, readsWhenStopped);
});

test('sampler reports router errors without crashing and recovers', async () => {
    const clock = fakeTimers();
    let fail = true, value = 0;
    const sampler = new TrafficSampler(async () => {
        if (fail) throw new Error('Router is unavailable');
        value += 1;
        return { trafficReceived: value, trafficSent: value };
    }, clock.timers, { intervalMs: 2000, windowMs: 30000, idleStopMs: 60000 });

    sampler.getSamples();
    await clock.flush();
    assert.equal(sampler.getSamples().error, 'Router is unavailable');
    fail = false;
    await clock.advance(2000);
    await clock.advance(2000);
    const result = sampler.getSamples();
    assert.equal(result.error, undefined);
    assert.equal(result.samples.length, 1);
    sampler.stop();
});

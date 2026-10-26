const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { registerGuestNetworkFlows } = require('../.homeybuild/drivers/asuswrt/guest-network-flows');

function setup(router) {
    const cards = new Map();
    const flow = { getActionCard(id) {
        const card = {
            registerRunListener(listener) { this.run = listener; return this; },
            registerArgumentAutocompleteListener(name, listener) { this.argument = name; this.autocomplete = listener; return this; }
        };
        cards.set(id, card);
        return card;
    }};
    registerGuestNetworkFlows(flow, () => router);
    return cards;
}

test('all three cards match their compose definitions and argument names', () => {
    const cards = setup({});
    assert.equal(cards.size, 3);
    for (const [id, card] of cards) {
        const definition = JSON.parse(readFileSync(join(__dirname, '../.homeycompose/flow/actions', `${id}.json`), 'utf8'));
        assert.equal(card.argument, definition.args.find(argument => argument.type === 'autocomplete').name);
        assert.ok(definition.title.en);
        if (id === 'enable-guest-network-for') {
            const duration = definition.args.find(argument => argument.name === 'minutes');
            assert.equal(duration.min, 1);
            assert.equal(duration.max, 43200);
        }
    }
});

test('autocomplete includes disabled networks and distinguishes identical SSIDs by band/slot', async () => {
    const cards = setup({ getGuestNetworks: async () => [
        { id: 'wl0.1', ssid: 'Visitors', band: '2.4 GHz', subunit: 1, enabled: true },
        { id: 'wl1.1', ssid: 'Visitors', band: '5 GHz', subunit: 1, enabled: false }
    ]});
    const card = cards.get('enable-guest-network');
    const results = await card.autocomplete('VISITORS');
    assert.equal(results.length, 2);
    assert.notEqual(results[0].name, results[1].name);
    assert.match(results[1].description, /Disabled/);
    assert.deepEqual((await card.autocomplete('wl1.1')).map(network => network.id), ['wl1.1']);
    assert.equal((await card.autocomplete('unknown')).length, 0);
});

test('actions convert minutes to seconds and use the selected stable ID', async () => {
    const calls = [];
    const cards = setup({ setGuestNetworkEnabled: async (...args) => { calls.push(args); return true; } });
    const network = { id: 'wl0.1' };
    assert.equal(await cards.get('enable-guest-network-for').run({ network, minutes: 240 }), true);
    await cards.get('enable-guest-network').run({ network });
    await cards.get('disable-guest-network').run({ network });
    assert.deepEqual(calls, [['wl0.1', true, 14400], ['wl0.1', true, 0], ['wl0.1', false, 0]]);
});

test('runtime rejects invalid tagged durations, including zero on the timed card', async () => {
    const cards = setup({ setGuestNetworkEnabled: async () => { assert.fail('must not call router'); } });
    for (const minutes of [undefined, '2', 0, -1, 1.5, NaN, Infinity, 43201]) {
        await assert.rejects(cards.get('enable-guest-network-for').run({ network: { id: 'wl0.1' }, minutes }), /whole number/);
    }
});

test('missing selection and unavailable routers fail instead of silently succeeding', async () => {
    const cards = setup(undefined);
    await assert.rejects(cards.get('enable-guest-network').run({}), /Select a guest/);
    await assert.rejects(cards.get('enable-guest-network').run({ network: { id: 'wl0.1' } }), /unavailable/);
    await assert.rejects(cards.get('disable-guest-network').autocomplete(''), /unavailable/);
});

test('empty discovery explains that a guest network must be configured on ASUS first', async () => {
    const cards = setup({ getGuestNetworks: async () => [] });
    await assert.rejects(cards.get('enable-guest-network').autocomplete(''), /configure one in the ASUS interface/);
});

test('router failures propagate to Flow', async () => {
    const cards = setup({ setGuestNetworkEnabled: async () => { throw new Error('Countdown not confirmed'); } });
    await assert.rejects(cards.get('enable-guest-network-for').run({ network: { id: 'wl0.1' }, minutes: 2 }), /Countdown not confirmed/);
    const unconfirmed = setup({ setGuestNetworkEnabled: async () => false });
    await assert.rejects(unconfirmed.get('disable-guest-network').run({ network: { id: 'wl0.1' } }), /did not confirm/);
});

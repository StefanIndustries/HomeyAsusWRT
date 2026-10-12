import type Homey from 'homey';
import type ManagerFlow from 'homey/manager/flow';
import type { AsusRouter } from 'node-asuswrt/lib/classes/asus-router';
import { MAX_GUEST_DURATION_SECONDS } from 'node-asuswrt/lib/models/asus-guest-network';

const MAX_GUEST_DURATION_MINUTES = MAX_GUEST_DURATION_SECONDS / 60;

/** Register network-wide actions against the app's existing authenticated router. */
export function registerGuestNetworkFlows(flow: ManagerFlow, getRouter: () => AsusRouter | undefined | null): void {
    const requireRouter = (): AsusRouter => {
        const router = getRouter();
        if (!router) {
            throw new Error('Router is unavailable; pair an ASUS router and check its connection');
        }
        return router;
    };

    const autocomplete = async (query: string): Promise<Homey.FlowCard.ArgumentAutocompleteResults> => {
        const networks = await requireRouter().getGuestNetworks();
        if (networks.length === 0) {
            throw new Error('No configured classic guest networks found; configure one in the ASUS interface first');
        }
        const searchFor = query.toLowerCase();
        return networks.map(network => ({
            name: `${network.ssid} — ${network.band} (Guest ${network.subunit})`,
            description: `${network.id} — ${network.enabled ? 'Enabled' : 'Disabled'}`,
            id: network.id
        })).filter(network => `${network.name} ${network.id}`.toLowerCase().includes(searchFor));
    };

    const run = async (network: { id: string } | undefined, enabled: boolean, minutes = 0): Promise<boolean> => {
        if (!network || typeof network.id !== 'string') {
            throw new Error('Select a guest network');
        }
        const success = await requireRouter().setGuestNetworkEnabled(network.id, enabled, minutes * 60);
        if (!success) {
            throw new Error('Router did not confirm the guest network change');
        }
        return true;
    };

    flow.getActionCard('enable-guest-network')
        .registerRunListener(async (args: { network: { id: string } }) => run(args.network, true))
        .registerArgumentAutocompleteListener('network', autocomplete);

    flow.getActionCard('enable-guest-network-for')
        .registerRunListener(async (args: { network: { id: string }, minutes: number }) => {
            // Validate at runtime as Flow tags can supply values outside the UI constraints.
            if (!Number.isInteger(args.minutes) || args.minutes < 1 || args.minutes > MAX_GUEST_DURATION_MINUTES) {
                throw new Error(`Duration must be a whole number of minutes between 1 and ${MAX_GUEST_DURATION_MINUTES} (30 days)`);
            }
            return run(args.network, true, args.minutes);
        })
        .registerArgumentAutocompleteListener('network', autocomplete);

    flow.getActionCard('disable-guest-network')
        .registerRunListener(async (args: { network: { id: string } }) => run(args.network, false))
        .registerArgumentAutocompleteListener('network', autocomplete);
}

import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import { AsusWRTDevice } from './device';
import { AsusConnectedDevice } from "node-asuswrt/lib/models/asus-connected-device";
import { AsusOptions } from "node-asuswrt/lib/asus-options";
import { AsusWrt } from "node-asuswrt";
import { AsusOoklaServer } from "node-asuswrt/lib/models/asus-ookla-server";
import { AsusVpnClient } from "node-asuswrt/lib/models/asus-vpn-client";
import { getConnectedDisconnectedToken, getMissingConnectedDevices, getNewConnectedDevices } from "./utils";
import { exec } from "node:child_process";

class AsusWRTDriver extends Homey.Driver {
    private pollingInterval = 60000;
    private isSelfSignedCertificate = false;
    private updateDevicesPollingIntervalId: any;
    private asusWrt: AsusWrt | undefined | null;
    private username: string = '';
    private password: string = '';
    private routerUrl: string = '';
    private connectedClients: AsusConnectedDevice[] = [];

    private triggerDeviceConnectedToNetwork!: (tokens: any) => void;
    private triggerDeviceDisconnectedFromNetwork!: (tokens: any) => void;

    public async updateStateOfDevices(executeTriggers: boolean = true) {
        let oldConnectedClients = this.connectedClients;
        if (!this.asusWrt) {
            return;
        }
        await this.asusWrt.updateConnectedDevices();

        for (const device of this.getDevices()) {
            const asusDevice = <AsusWRTDevice>device;
            await asusDevice.updateCapabilities(executeTriggers);
        }

        try {
            this.log(`updating connectedClients for entire network`);
            this.connectedClients = [];
            this.asusWrt.allClients.forEach(client => {
                this.connectedClients = this.connectedClients.concat(client.connectedDevices);
            });
            if (oldConnectedClients.length !== 0 || this.connectedClients.length !== 0) {
                if (executeTriggers) {
                    getMissingConnectedDevices(oldConnectedClients, this.connectedClients).forEach(missingDevice => this.triggerDeviceDisconnectedFromNetwork(getConnectedDisconnectedToken(missingDevice)));
                    getNewConnectedDevices(oldConnectedClients, this.connectedClients).forEach(newDevice => this.triggerDeviceConnectedToNetwork(getConnectedDisconnectedToken(newDevice)));
                }
            }
        } catch (err) {
            this.log(`failed to update connectedClients for entire network`, err);
        }
    }

    private registerFlowListeners() {
        // triggers
        const deviceConnectedToNetwork = this.homey.flow.getTriggerCard('device-connected-to-network');
        this.triggerDeviceConnectedToNetwork = (tokens) => {
            deviceConnectedToNetwork
                .trigger(tokens)
                .catch(this.error);
        };

        const deviceDisconnectedFromNetwork = this.homey.flow.getTriggerCard('device-disconnected-from-network');
        this.triggerDeviceDisconnectedFromNetwork = (tokens) => {
            deviceDisconnectedFromNetwork
                .trigger(tokens)
                .catch(this.error);
        };

        // conditions
        const conditionDeviceIsConnectedToAccessPoint = this.homey.flow.getConditionCard('device-is-connected-to-access-point');
        conditionDeviceIsConnectedToAccessPoint
            .registerRunListener((args: {
                device: AsusWRTDevice,
                client: { name: string, mac: string, description: string }
            }, state: any) => {
                if (args.device.getWiredClients().find(wclient => wclient.mac === args.client.mac)
                    || args.device.getWireless24GClients().find(wl2gclient => wl2gclient.mac === args.client.mac
                        || args.device.getWireless5GClients().find(wl5gclient => wl5gclient.mac === args.client.mac))) {
                    return true;
                } else {
                    return false;
                }
            })
            .registerArgumentAutocompleteListener('client', (query: string): Homey.FlowCard.ArgumentAutocompleteResults => {
                return this.deviceArgumentAutoCompleteListenerResults(query);
            });

        const conditionDeviceIsConnectedToNetwork = this.homey.flow.getConditionCard('device-is-connected-to-network');
        conditionDeviceIsConnectedToNetwork
            .registerRunListener((args: { client: { name: string, mac: string, description: string } }, state: any) => {
                if (this.connectedClients.find(device => device.mac === args.client.mac)) {
                    return true;
                } else {
                    return false;
                }
            })
            .registerArgumentAutocompleteListener('client', (query: string): Homey.FlowCard.ArgumentAutocompleteResults => {
                return this.deviceArgumentAutoCompleteListenerResults(query);
            });

        // actions
        const speedTest = this.homey.flow.getActionCard('speedtest');
        speedTest.registerRunListener(async (args: { server: AsusOoklaServer }) => {
            if (this.asusWrt && this.asusWrt.asusRouter) {
                const result = await this.asusWrt.asusRouter.runSpeedtest(args.server);
                return {
                    download_speed: ((result.download.bytes * 8) / (result.download.elapsed * 0.001)) / 1000000,
                    upload_speed: ((result.upload.bytes * 8) / (result.upload.elapsed * 0.001)) / 1000000,
                    ping: result.ping.latency,
                    packet_loss: result.packetLoss
                };
            }
        }).registerArgumentAutocompleteListener('server', async (query: string): Promise<Homey.FlowCard.ArgumentAutocompleteResults> => {
            const searchFor = query.toUpperCase();
            if (this.asusWrt && this.asusWrt.asusRouter) {
                const ooklaServers = await this.asusWrt.asusRouter.getOoklaServers();
                const serversInQuery = ooklaServers!.filter(server => {
                    return server.name.toUpperCase().includes(searchFor);
                });
                return [
                    ...serversInQuery
                ];
            }
            return [];
        });

        const enableVPNClient = this.homey.flow.getActionCard('enable-vpn-client');
        enableVPNClient.registerRunListener(async (args: { client: AsusVpnClient }) => {
            if (this.asusWrt && this.asusWrt.asusRouter) {
                await this.asusWrt.asusRouter.setActiveVpnClient(args.client);
            }
        }).registerArgumentAutocompleteListener('client', async (query: string): Promise<Homey.FlowCard.ArgumentAutocompleteResults> => {
            const searchFor = query.toUpperCase();
            if (this.asusWrt && this.asusWrt.asusRouter) {
                const vpnClients = <AsusVpnClient[]>await this.asusWrt?.asusRouter?.getVpnClients();
                const clientsInQuery = vpnClients!.filter(client => {
                    return client.description.toUpperCase().includes(searchFor);
                });
                return [
                    ...clientsInQuery.map(client => ({
                        name: client.description,
                        description: client.description,
                        protocol: client.protocol,
                        unit: client.unit,
                        username: client.username,
                        password: client.password
                    }))
                ];
            }
            return [];
        });

        const disableVPNClient = this.homey.flow.getActionCard('disable-vpn-client');
        disableVPNClient.registerRunListener(async () => {
            if (this.asusWrt && this.asusWrt.asusRouter) {
                await this.asusWrt.asusRouter.setActiveVpnClient();
            }
        });

        const rebootNetwork = this.homey.flow.getActionCard('reboot-network');
        rebootNetwork.registerRunListener(async () => {
            if (this.asusWrt && this.asusWrt.asusRouter) {
                await this.asusWrt.asusRouter.rebootNetwork();
            }
        });

        const rebootDevice = this.homey.flow.getActionCard('reboot-device');
        rebootDevice.registerRunListener(async (args: { device: AsusWRTDevice }) => {
            if (this.asusWrt) {
                await args.device.asusClient!.reboot();
            }
        });

        const turnOnLeds = this.homey.flow.getActionCard('set-leds');
        turnOnLeds.registerRunListener(async (args: { device: AsusWRTDevice, OnOrOff: string }) => {
            if (this.asusWrt) {
                await args.device.asusClient!.setLeds(args.OnOrOff === 'on');
            }
        });

        const wakeOnLan = this.homey.flow.getActionCard('wake-on-lan');
        wakeOnLan.registerRunListener(async (args: {
            wolclient: { name: string, mac: string, description: string }
        }) => {
            if (this.asusWrt && this.asusWrt.asusRouter) {
                await this.asusWrt.asusRouter.callWakeOnLan(args.wolclient);
            }
        })
            .registerArgumentAutocompleteListener('wolclient', async (query: string): Promise<Homey.FlowCard.ArgumentAutocompleteResults> => {
                const searchFor = query.toUpperCase();
                if (this.asusWrt && this.asusWrt.asusRouter) {
                    const wolClients = await this.asusWrt.asusRouter.getWakeOnLanDevices();
                    const devicesInQuery = wolClients!.filter(device => {
                        return device.name.toUpperCase().includes(searchFor) || device.mac.toUpperCase().includes(searchFor)
                    });
                    return [
                        ...devicesInQuery.map(device => ({name: device.name, mac: device.mac, description: device.mac}))
                    ];
                }
                return [];
            });
    }

    private deviceArgumentAutoCompleteListenerResults(query: string): Homey.FlowCard.ArgumentAutocompleteResults {
        const searchFor = query.toUpperCase();
        const devicesInQuery = this.connectedClients.filter(device => {
            return device.ip.toUpperCase().includes(searchFor) || device.name.toUpperCase().includes(searchFor) || device.nickName.toUpperCase().includes(searchFor) || device.vendor.toUpperCase().includes(searchFor)
        });
        return [
            ...devicesInQuery.map(device => ({name: device.name, mac: device.mac, description: device.mac})),
        ];
    }

    private fixMalformedUrl(url: string): string {
        const regex = /(http:\/+)+(http\/+)?/;

        if (regex.test(url)) {
            return url.replace(regex, 'http://');
        } else {
            return 'http://' + url;
        }
    }

    /**
     * onInit is called when the driver is initialized.
     */
    async onInit() {
        const legacyIp = this.homey.settings.get('ip');
        const url = this.homey.settings.get('url');

        this.routerUrl = this.fixMalformedUrl(url || (legacyIp.startsWith('http://') || legacyIp.startsWith('https://') ? legacyIp : `http://${legacyIp}`));

        this.homey.settings.set('url', this.routerUrl);
        this.homey.settings.unset('ip');

        this.username = this.homey.settings.get('username');
        this.password = this.homey.settings.get('password');
        this.pollingInterval = this.homey.settings.get('pollingInterval') || 60000;
        this.isSelfSignedCertificate = this.homey.settings.get('isSelfSignedCertificate') || false;
        if (this.routerUrl !== null && this.username !== null && this.password !== null) {
            const asusOptions: AsusOptions = {
                baseURL: this.routerUrl,
                username: this.username,
                password: this.password,
                isSelfSignedCertificate: this.isSelfSignedCertificate,
            };
            this.asusWrt = new AsusWrt(asusOptions);
        }

        if (this.asusWrt) {
            const clients = await this.asusWrt!.discoverClients();

            for (const device of this.getDevices()) {
                const router = <AsusWRTDevice>device;
                const routerMac = router.getData().mac;
                const asusClient = clients.find(client => client.mac === routerMac);
                if (asusClient) {
                    router.setAsusClient(asusClient);
                } else {
                    await router.setUnavailable('Device seems offline');
                }
            }

            await this.updateStateOfDevices(false);
        }

        this.registerFlowListeners();
        if (!this.updateDevicesPollingIntervalId) {
            this.updateDevicesPollingIntervalId = this.homey.setInterval(this.updateDevicePollingInterval, this.pollingInterval);
        }
        this.log('AsusWRTDriver has been initialized');
    }

    private updateDevicePollingInterval = async () => {
        try {
            await this.updateStateOfDevices();
        } catch (error) {
            this.log(error);
            this.homey.clearInterval(this.updateDevicesPollingIntervalId);
            this.updateDevicesPollingIntervalId = this.homey.setInterval(this.updateDevicePollingInterval, this.pollingInterval * 5);
            this.getDevices().forEach(device => device.setWarning('Something went wrong, trying again in 5 minutes'));
            return;
        }
        this.homey.clearInterval(this.updateDevicesPollingIntervalId);
        this.updateDevicesPollingIntervalId = this.homey.setInterval(this.updateDevicePollingInterval, this.pollingInterval);
    }

    async onUninit(): Promise<void> {
        if (this.updateDevicesPollingIntervalId) {
            this.homey.clearInterval(this.updateDevicesPollingIntervalId);
        }
        if (this.asusWrt) {
            this.asusWrt.dispose();
        }
    }

    async onPair(session: PairSession) {
        this.log('starting a new pair session');

        session.setHandler('showView', async (view) => {
            if (view === 'prepare_pairing') {
                if (this.asusWrt) {
                    const routers = await this.asusWrt.discoverClients();
                    if (routers.length > 0) {
                        await session.showView('list_devices');
                    } else {
                        await session.showView('router_url');
                    }
                } else {
                    await session.showView('router_url');
                }
            }
        });

        session.setHandler('router_url_confirmed', async (routerUrlFromView) => {
            this.log('pair: router_ip_confirmed');
            const urlRegex = /https?:\/\/(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::\d+)?(?:\/\S*)?|https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d+)?(?:\/[^\s]*)?/gi;
            if (urlRegex.test(routerUrlFromView)) {
                this.routerUrl = routerUrlFromView;
                return true;
            } else {
                this.log('invalid url provided');
                return false;
            }
        });

        session.setHandler('login', async (data: {
            username: string,
            password: string,
            ignoreCertificate: boolean,
        }) => {
            this.log('pair: login');
            this.username = data.username.trim();
            this.password = data.password;
            this.log('creating client');
            let routers = [];
            try {
                const asusOptions: AsusOptions = {
                    baseURL: this.routerUrl,
                    username: this.username,
                    password: this.password,
                    isSelfSignedCertificate: this.isSelfSignedCertificate,
                };
                const tempClient = new AsusWrt(asusOptions);
                routers = await tempClient.discoverClients();
                tempClient.dispose();
            } catch {
                return false;
            }
            if (routers.length === 0) {
                this.log('failed to login');
                return Promise.reject(Error('Failed to login'));
            } else {
                this.homey.settings.set("url", this.routerUrl);
                this.homey.settings.set("username", this.username);
                this.homey.settings.set("password", this.password);
                return true;
            }
        });

        session.setHandler('list_devices', async () => {
            this.log('pair: list_devices');
            const asusOptions: AsusOptions = {
                baseURL: this.routerUrl,
                username: this.username,
                password: this.password,
                isSelfSignedCertificate: this.isSelfSignedCertificate,
            };
            this.asusWrt = new AsusWrt(asusOptions);
            const asusClients = await this.asusWrt.discoverClients().catch(error => {
                session.showView('router_url');
                this.asusWrt?.dispose();
                return;
            })
            const foundDevices = asusClients!.map(device => {
                return {
                    name: `${device.deviceInfo.product_id} ${device.deviceInfo.alias}`,
                    data: {
                        mac: device.mac
                    },
                    store: {
                        operationMode: device.deviceInfo.config.backhalctrl ? 0 : 1
                    },
                    icon: this.getIcon(device.deviceInfo.product_id)
                }
            });
            return foundDevices;
        });
    }

    async onRepair(session: PairSession, device: any) {
        let newRouterUrl = '';
        let newUsername = '';
        let newPassword = '';

        this.log('starting repair');
        session.setHandler('router_url_confirmed', async (routerUrlFromView) => {
            this.log('pair: router_ip_confirmed');
            const urlRegex = /https?:\/\/(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::\d+)?(?:\/\S*)?|https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d+)?(?:\/[^\s]*)?/gi;
            if (urlRegex.test(routerUrlFromView)) {
                newRouterUrl = routerUrlFromView;
                return true;
            } else {
                this.log('invalid url provided');
                return false;
            }
        });

        session.setHandler('login', async (data: { username: string, password: string }) => {
            this.log('pair: login');
            newUsername = data.username.trim();
            newPassword = data.password;
            this.log('creating client');
            try {
                const asusOptions: AsusOptions = {
                    baseURL: newRouterUrl,
                    username: newUsername,
                    password: newPassword,
                    isSelfSignedCertificate: this.isSelfSignedCertificate,
                };
                let tempClient = new AsusWrt(asusOptions);
                const routers = await tempClient.discoverClients();
                tempClient.dispose();
                if (routers.length === 0) {
                    this.log('failed to login');
                    return Promise.reject(Error('Failed to login'));
                } else {
                    this.routerUrl = newRouterUrl;
                    this.username = newUsername;
                    this.password = newPassword;
                    this.homey.settings.set("url", this.routerUrl);
                    this.homey.settings.set("username", this.username);
                    this.homey.settings.set("password", this.password);
                    if (this.asusWrt) {
                        this.asusWrt.dispose();
                        const asusOptions: AsusOptions = {
                            baseURL: this.routerUrl,
                            username: this.username,
                            password: this.password,
                            isSelfSignedCertificate: this.isSelfSignedCertificate,
                        };
                        this.asusWrt = new AsusWrt(asusOptions);
                    }
                    return true;
                }
            } catch {
                return Promise.reject(Error('Failed to login'));
            }
        });
    }

    private getIcon(productId: string): string {
        const supportedIcons = [
            'RT-AC65P',
            'RT-AC85P',
            'RT-AC85U',
            'RT-AC86U',
            'RT-AC1900',
            'RT-AC2400',
            'RT-AC2600',
            'RT-AC2900',
            'RT-AC3100',
            'RT-AC3200',
            'RT-AC5300',
            'RT-AX89U',
            'RT-AX89X',
            'RT-AX95Q'
        ];
        if (supportedIcons.indexOf(productId) === -1) {
            return `default.svg`;
        } else {
            return `${productId}.svg`;
        }
    }
}

module.exports = AsusWRTDriver;

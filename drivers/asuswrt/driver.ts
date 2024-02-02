import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import { AsusWRT } from "node-asuswrt"
import { AsusWRTConnectedDevice } from 'node-asuswrt/lib/models/AsusWRTConnectedDevice';
import { AsusWRTOperationMode } from 'node-asuswrt/lib/models/AsusWRTOperationMode';
import { AsusWRTOptions } from 'node-asuswrt/lib/models/AsusWRTOptions';
import { AsusWRTRouter } from 'node-asuswrt/lib/models/AsusWRTRouter';
import { AsusWRTDevice } from './device';
import { getConnectedDisconnectedToken, getMissingConnectedDevices, getNewConnectedDevices, wait } from './utils';
import { AsusWRTOoklaServer } from 'node-asuswrt/lib/models/AsusWRTOoklaServer';
import { AsusWRTVPNClient } from 'node-asuswrt/lib/models/AsusWRTVPNClient';

class AsusWRTDriver extends Homey.Driver {

  private pollingInterval = 60000;
  private updateDevicesPollingIntervalId: any;
  private asusClient: AsusWRT | undefined | null;
  private username: string = '';
  private password: string = '';
  private routerIP: string = '';
  private connectedClients: AsusWRTConnectedDevice[] = [];

  private triggerDeviceConnectedToNetwork!: (tokens: any) => void;
  private triggerDeviceDisconnectedFromNetwork!: (tokens: any) => void;

  public async updateStateOfDevices() {
    let routers: AsusWRTRouter[] = [];
    let oldConnectedClients = this.connectedClients;
    if (this.asusClient) {
        routers = await this.asusClient!.getRouters();
    }

    for (const device of this.getDevices()) {
      const router = <AsusWRTDevice>device;
      const routerMac = router.getData().mac;
      const routerStatus = routers.find(client => client.mac === routerMac);
      routerStatus && routerStatus.online ? await router.setAvailable() : await router.setUnavailable('Device not online');
      if (!router.getAvailable()) {
        continue;
      }
      if (routerStatus?.firmwareVersion) {
        router.setFirmwareVersion(routerStatus.firmwareVersion, routerStatus.newFirmwareVersion ? routerStatus.newFirmwareVersion : '');
      }
      let successfullyUpdatedEverything = true;
      this.log(`updating connected device information for access point ${routerMac}`);
      Promise.all([this.asusClient!.getWiredClients(routerMac), this.asusClient!.getWirelessClients(routerMac, "2G"), this.asusClient!.getWirelessClients(routerMac, "5G")])
        .then(async (values) => {
          await router.setConnectedClients(values[0], values[1], values[2]);
        }).catch(err => {
          successfullyUpdatedEverything = false;
          this.log(`failed to update connected device information for access point ${routerMac}`, err);
        });

      try {
        this.log(`updating cpu memory load for access point ${routerMac}`);
        const load = await this.asusClient!.getCPUMemoryLoad(routerMac);
        await router.setLoad(load);
      } catch (err) {
        successfullyUpdatedEverything = false;
        this.log(err);
      }

      try {
        this.log(`updating uptime for access point ${routerMac}`);
        const uptimeSeconds = await this.asusClient!.getUptime(routerMac);
        await router.setUptimeDaysBySeconds(uptimeSeconds);
      } catch (err) {
        successfullyUpdatedEverything = false;
        this.log(err);
      }


      if (router.getStoreValue('operationMode') === AsusWRTOperationMode.Router) {
        this.log(`device is of type router, executing additional updates`);
        try {
          this.log(`updating wan status for access point ${routerMac}`);
          const WANStatus = await this.asusClient!.getWANStatus();
          await router.setWANStatus(WANStatus);
        } catch (err) {
          successfullyUpdatedEverything = false;
          this.log(err);
        }

        try {
          this.log(`updating traffic data for access point ${routerMac}`);
          const trafficDataFirst = await this.asusClient!.getTotalTrafficData();
          await wait(2000);
          const trafficDataSecond = await this.asusClient!.getTotalTrafficData();
          await router.setTrafficValues(trafficDataFirst, trafficDataSecond);
        } catch (err) {
          successfullyUpdatedEverything = false;
          this.log(err);
        }
      }

      if (!successfullyUpdatedEverything) {
        this.log(`failed to update some information for access point ${routerMac}`);
        router.setWarning('Failed to retrieve (some) device info, some functionality might not work');
      } else {
        this.log(`successfully updated all information for access point ${routerMac}`);
        router.setWarning(null);
      }
    }

    try {
      this.log(`updating connectedClients for entire network`);
      this.connectedClients = await this.asusClient!.getAllClients();
      getMissingConnectedDevices(oldConnectedClients, this.connectedClients).forEach(missingDevice => this.triggerDeviceDisconnectedFromNetwork(getConnectedDisconnectedToken(missingDevice)));
      getNewConnectedDevices(oldConnectedClients, this.connectedClients).forEach(newDevice => this.triggerDeviceConnectedToNetwork(getConnectedDisconnectedToken(newDevice)));
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
      .registerRunListener((args: { device: AsusWRTDevice, client: { name: string, mac: string, description: string } }, state: any) => {
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
    speedTest.registerRunListener(async (args: { server: AsusWRTOoklaServer }) => {
      if (this.asusClient) {
        const result = await this.asusClient.runOoklaSpeedtest(args.server);
        return {
          download_speed: ((result.download.bytes * 8) / (result.download.elapsed * 0.001)) / 1000000,
          upload_speed: ((result.upload.bytes * 8) / (result.upload.elapsed * 0.001)) / 1000000,
          ping: result.ping.latency,
          packet_loss: result.packetLoss
        };
      }
    }).registerArgumentAutocompleteListener('server', async (query: string): Promise<Homey.FlowCard.ArgumentAutocompleteResults> => {
      const searchFor = query.toUpperCase();
      const ooklaServers = await this.asusClient?.getOoklaServers();
      const serversInQuery = ooklaServers!.filter(server => {
        return server.name.toUpperCase().includes(searchFor);
      });
      return [
        ...serversInQuery
      ];
    });

    const enableVPNClient = this.homey.flow.getActionCard('enable-vpn-client');
    enableVPNClient.registerRunListener(async (args: { client: AsusWRTVPNClient }) => {
      if (this.asusClient) {
        await this.asusClient.setActiveVPNClient(args.client);
      }
    }).registerArgumentAutocompleteListener('client', async (query: string): Promise<Homey.FlowCard.ArgumentAutocompleteResults> => {
      const searchFor = query.toUpperCase();
      const vpnClients = <AsusWRTVPNClient[]> await this.asusClient?.getVPNClients();
      const clientsInQuery = vpnClients!.filter(client => {
        return client.description.toUpperCase().includes(searchFor);
      });
      return [
        ...clientsInQuery.map(client => ({ name: client.description, description: client.description, protocol: client.protocol, unit: client.unit, username: client.username, password: client.password }))
      ];
    });

    const disableVPNClient = this.homey.flow.getActionCard('disable-vpn-client');
    disableVPNClient.registerRunListener(async () => {
      if (this.asusClient) {
        await this.asusClient.disableVPNClient();
      }
    });

    const rebootNetwork = this.homey.flow.getActionCard('reboot-network');
    rebootNetwork.registerRunListener(async () => {
      if (this.asusClient) {
        await this.asusClient.rebootNetwork();
      }
    });

    const rebootDevice = this.homey.flow.getActionCard('reboot-device');
    rebootDevice.registerRunListener(async (args: { device: AsusWRTDevice }) => {
      if (this.asusClient) {
        await this.asusClient.rebootDevice(args.device.getData().mac);
      }
    });

    const turnOnLeds = this.homey.flow.getActionCard('set-leds');
    turnOnLeds.registerRunListener(async (args: { device: AsusWRTDevice, OnOrOff: string }) => {
      if (this.asusClient) {
        await this.asusClient.setLedsEnabled(args.device.getData().mac, args.OnOrOff === 'on' ? true : false);
      }
    });

    const wakeOnLan = this.homey.flow.getActionCard('wake-on-lan');
    wakeOnLan.registerRunListener(async (args: { wolclient: { name: string, mac: string, description: string } }) => {
      await this.asusClient?.wakeOnLan(args.wolclient.mac);
    })
      .registerArgumentAutocompleteListener('wolclient', async (query: string): Promise<Homey.FlowCard.ArgumentAutocompleteResults> => {
        const searchFor = query.toUpperCase();
        const wolClients = await this.asusClient?.getWakeOnLanList();
        const devicesInQuery = wolClients!.filter(device => {
          return device.name.toUpperCase().includes(searchFor) || device.mac.toUpperCase().includes(searchFor)
        });
        return [
          ...devicesInQuery.map(device => ({ name: device.name, mac: device.mac, description: device.mac }))
        ];
      });
  }

  private deviceArgumentAutoCompleteListenerResults(query: string): Homey.FlowCard.ArgumentAutocompleteResults {
    const searchFor = query.toUpperCase();
    const devicesInQuery = this.connectedClients.filter(device => {
      return device.ip.toUpperCase().includes(searchFor) || device.name.toUpperCase().includes(searchFor) || device.nickName.toUpperCase().includes(searchFor) || device.vendor.toUpperCase().includes(searchFor)
    });
    return [
      ...devicesInQuery.map(device => ({ name: device.name, mac: device.mac, description: device.mac })),
    ];
  }

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.routerIP = this.homey.settings.get('ip');
    this.username = this.homey.settings.get('username');
    this.password = this.homey.settings.get('password');
    this.pollingInterval = this.homey.settings.get('pollingInterval') || 60000;
    if (this.routerIP !== null && this.username !== null && this.password !== null) {
      const asusOptions: AsusWRTOptions = {
        BaseUrl: this.routerIP,
        Username: this.username,
        Password: this.password,
        InfoLogCallback: this.log,
        ErrorLogCallback: this.log
      };
      this.asusClient = new AsusWRT(asusOptions);
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
    if (this.asusClient) {
      this.asusClient.dispose();
    }
  }

  async onPair(session: PairSession) {
    this.log('starting a new pair session');

    session.setHandler('showView', async (view) => {
      if (view === 'prepare_pairing') {
        if (this.asusClient) {
          const routers = await this.asusClient.getRouters();
          if (routers.length > 0) {
            await session.showView('list_devices');
          } else {
            await session.showView('router_ip');
          }
        } else {
          await session.showView('router_ip');
        }
      }
    });

    session.setHandler('router_ip_confirmed', async (routerIPFromView) => {
      this.log('pair: router_ip_confirmed');
      const ipRegex = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
      if (ipRegex.test(routerIPFromView)) {
        this.routerIP = 'http://' + routerIPFromView;
        return true;
      } else {
        this.log('invalid ip provided');
        return false;
      }
    });

    session.setHandler('login', async (data: { username: string, password: string }) => {
      this.log('pair: login');
      this.username = data.username.trim();
      this.password = data.password;
      this.log('creating client');
      let routers = [];
      try {
        const asusOptions: AsusWRTOptions = {
          BaseUrl: this.routerIP,
          Username: this.username,
          Password: this.password,
          InfoLogCallback: this.log,
          ErrorLogCallback: this.log
        };
        const tempClient = new AsusWRT(asusOptions);
        routers = await tempClient.getRouters();
        tempClient.dispose();
      } catch {
        return false;
      }
      if (routers.length === 0) {
        this.log('failed to login');
        return Promise.reject(Error('Failed to login'));
      } else {
        this.homey.settings.set("ip", this.routerIP);
        this.homey.settings.set("username", this.username);
        this.homey.settings.set("password", this.password);
        return true;
      }
    });

    session.setHandler('list_devices', async () => {
      this.log('pair: list_devices');
      const asusOptions: AsusWRTOptions = {
        BaseUrl: this.routerIP,
        Username: this.username,
        Password: this.password,
        InfoLogCallback: this.log,
        ErrorLogCallback: this.log
      };
      this.asusClient = new AsusWRT(asusOptions);
      const routerAPDevices = await this.asusClient.getRouters().catch(error => {
        session.showView('router_ip');
        return;
      });
      const foundDevices = routerAPDevices!.map(device => {
        return {
          name: `${device.productId} ${device.alias}`,
          data: {
            mac: device.mac
          },
          store: {
            operationMode: device.operationMode
          },
          icon: this.getIcon(device.productId)
        }
      });
      return foundDevices;
    });
  }

  async onRepair(session: PairSession, device: any) {
    let newRouterIP = '';
    let newUsername = '';
    let newPassword = '';

    this.log('starting repair');
    session.setHandler('router_ip_confirmed', async (routerIPFromView) => {
      this.log('pair: router_ip_confirmed');
      const ipRegex = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
      if (ipRegex.test(routerIPFromView)) {
        newRouterIP = 'http://' + routerIPFromView;
        return true;
      } else {
        this.log('invalid ip provided');
        return false;
      }
    });

    session.setHandler('login', async (data: { username: string, password: string }) => {
      this.log('pair: login');
      newUsername = data.username.trim();
      newPassword = data.password;
      this.log('creating client');
      try {
        const asusOptions: AsusWRTOptions = {
          BaseUrl: newRouterIP,
          Username: newUsername,
          Password: newPassword,
          InfoLogCallback: this.log,
          ErrorLogCallback: this.log
        };
        let tempClient = new AsusWRT(asusOptions);
        const routers = await tempClient.getRouters();
        tempClient.dispose();
        if (routers.length === 0) {
          this.log('failed to login');
          return Promise.reject(Error('Failed to login'));
        } else {
          this.routerIP = newRouterIP;
          this.username = newUsername;
          this.password = newPassword;
          this.homey.settings.set("ip", this.routerIP);
          this.homey.settings.set("username", this.username);
          this.homey.settings.set("password", this.password);
          if (this.asusClient) {
            this.asusClient.dispose();
            const asusOptions: AsusWRTOptions = {
              BaseUrl: this.routerIP,
              Username: this.username,
              Password: this.password,
              InfoLogCallback: this.log,
              ErrorLogCallback: this.log
            };
            this.asusClient = new AsusWRT(asusOptions);
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

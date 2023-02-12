import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import { AsusWRT } from "node-asuswrt"
import { AsusWRTConnectedDevice } from 'node-asuswrt/lib/models/AsusWRTConnectedDevice';
import { AsusWRTOperationMode } from 'node-asuswrt/lib/models/AsusWRTOperationMode';
import { AsusWRTRouter } from 'node-asuswrt/lib/models/AsusWRTRouter';
import { AsusWRTDevice } from './device';
import { getConnectedDisconnectedToken, getMissingConnectedDevices, getNewConnectedDevices, wait } from './utils';

class AsusWRTDriver extends Homey.Driver {

  private updateDevicesPollingInterval: any;
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
      try {
        routers = await this.asusClient!.getRouters();
        this.connectedClients = await this.asusClient!.getAllClients();
      } catch {
        this.log('network not ready to receive requests');
        return;
      }
    }
    getMissingConnectedDevices(oldConnectedClients, this.connectedClients).forEach(missingDevice => this.triggerDeviceDisconnectedFromNetwork(getConnectedDisconnectedToken(missingDevice)));
    getNewConnectedDevices(oldConnectedClients, this.connectedClients).forEach(newDevice => this.triggerDeviceConnectedToNetwork(getConnectedDisconnectedToken(newDevice)));

    this.getDevices().forEach(async device => {
      const router = <AsusWRTDevice> device;
      const routerMac = router.getData().mac;
      const routerStatus = routers.find(client => client.mac === routerMac);
      routerStatus && routerStatus.online ? router.setAvailable() : router.setUnavailable();
      if (!router.getAvailable()) {
        return;
      }
      try {
        const newWiredClients = await this.asusClient!.getWiredClients(routerMac);
        const newWireless24GClients = await this.asusClient!.getWirelessClients(routerMac, "2G");
        const newWireless5GClients = await this.asusClient!.getWirelessClients(routerMac, "5G");
        await router.setConnectedClients(newWiredClients, newWireless24GClients, newWireless5GClients);
  
        const load = await this.asusClient!.getCPUMemoryLoad(routerMac);
        await router.setLoad(load);
  
        const uptimeSeconds = await this.asusClient!.getUptime(routerMac);
        await router.setUptimeDaysBySeconds(uptimeSeconds);
  
        if (router.getStoreValue('operationMode') === AsusWRTOperationMode.Router) {
          const WANStatus = await this.asusClient!.getWANStatus();
          await router.setWANStatus(WANStatus);
  
          const trafficDataFirst = await this.asusClient!.getTotalTrafficData();
          await wait(2000);
          const trafficDataSecond = await this.asusClient!.getTotalTrafficData();
          await router.setTrafficValues(trafficDataFirst, trafficDataSecond);
        }
      } catch {
        this.log('failed to update router state, setting router unavailable');
        router.setUnavailable();
      }
    });
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
      .registerRunListener((args: {device: AsusWRTDevice, client: { name: string, mac: string, description: string }}, state: any) => {
          if (args.device.getWiredClients().find(wclient => wclient.mac === args.client.mac)
            || args.device.getWireless24GClients().find(wl2gclient => wl2gclient.mac === args.client.mac
            || args.device.getWireless5GClients().find(wl5gclient => wl5gclient.mac === args.client.mac)))
          {
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
      .registerRunListener((args: {client: { name: string, mac: string, description: string }}, state: any) => {
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
    const rebootNetwork = this.homey.flow.getActionCard('reboot-network');
		rebootNetwork.registerRunListener(async () => {
      if (this.asusClient) {
        await this.asusClient.rebootNetwork();
      }
    });

    const turnOnLeds = this.homey.flow.getActionCard('set-leds');
    turnOnLeds.registerRunListener(async (args: {device: AsusWRTDevice, OnOrOff: string}) => {
      if (this.asusClient) {
        await this.asusClient.setLedsEnabled(args.device.getData().mac, args.OnOrOff === 'on' ? true : false);
      }
    });
  }

  private deviceArgumentAutoCompleteListenerResults(query: string): Homey.FlowCard.ArgumentAutocompleteResults {
    const searchFor = query.toUpperCase();
    const devicesInQuery = this.connectedClients.filter(device => {
      return device.ip.toUpperCase().includes(searchFor) || device.name.toUpperCase().includes(searchFor) || device.nickName.toUpperCase().includes(searchFor) || device.vendor.toUpperCase().includes(searchFor)
    });
    const results: Homey.FlowCard.ArgumentAutocompleteResults = [
      ...devicesInQuery.map(device => ({ name: device.ip, mac: device.mac, description: device.name })),
    ];
    return results;
  }

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.routerIP = this.homey.settings.get('ip');
    this.username = this.homey.settings.get('username');
    this.password = this.homey.settings.get('password');
    if (this.routerIP !== null && this.username !== null && this.password !== null) {
      this.asusClient = new AsusWRT(this.routerIP, this.username, this.password);
    }
    this.registerFlowListeners();
    if (!this.updateDevicesPollingInterval) {
      this.updateDevicesPollingInterval = this.homey.setInterval(async () => {
        await this.updateStateOfDevices();
      }, 60000);
    }
    this.log('AsusWRTDriver has been initialized');
  }

  async onUninit(): Promise<void> {
    if (this.updateDevicesPollingInterval) {
      this.homey.clearInterval(this.updateDevicesPollingInterval);
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

    session.setHandler('login', async (data: {username: string, password: string}) => {
      this.log('pair: login');
      this.username = data.username.trim();
      this.password = data.password;
      this.log('creating client');
      let routers = [];
      try {
        const tempClient = new AsusWRT(this.routerIP, this.username, this.password);
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
      this.asusClient = new AsusWRT(this.routerIP, this.username, this.password);
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

    session.setHandler('login', async (data: {username: string, password: string}) => {
      this.log('pair: login');
      newUsername = data.username.trim();
      newPassword = data.password;
      this.log('creating client');
      try {
        let tempClient = new AsusWRT(newRouterIP, newUsername, newPassword);
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
            this.asusClient = new AsusWRT(this.routerIP, this.username, this.password);
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
      'RT-AX89U',
      'RT-AX89X',
      'RT-AC68U',
      'RT-AC86U'
    ];
    if (supportedIcons.indexOf(productId) === -1) {
      return `default.svg`;
    } else {
      return `${productId}.svg`;
    }
  }
}

module.exports = AsusWRTDriver;

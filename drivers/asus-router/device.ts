import Homey, { FlowCardCondition } from 'homey';
import { AsusWRTClient } from '../../lib/AsusWRTClient';
import { AsusWRTApp } from '../../app';
import { CryptoClient } from '../../lib/CryptoClient';
import { AsusWRTConnectedClient } from '../../lib/models/AsusWRTConnectedClient';
import { ArgumentAutocompleteResults } from 'homey/lib/FlowCard';

export class AsusRouterDevice extends Homey.Device {

  private client!: AsusWRTClient;
  private lowPrioPollingIntervalID: any;
  private highPrioPollingIntervalID: any;
  private onlineDevices: AsusWRTConnectedClient[] = [];

  private triggerDeviceCameOnline!: (device: any, tokens: any, state: any) => void;
  private triggerDeviceWentOffline!: (device: any, tokens: any, state: any) => void;
  private triggerWANConnectionStatusChanged!: (device: any, tokens: any, state: any) => void;
  private triggerExternalIPChanged!: (device: any, tokens: any, state: any) => void;

  private conditionDeviceIsConnected!: FlowCardCondition;

  public async reboot() {
    const rebootStatus = await this.client.reboot();
    if (rebootStatus.run_service !== "reboot") {
      return Promise.reject("Reboot failed");
    }
  }

  public async setLEDs(ledValue: number) {
    const ledStatus = await this.client.setLEDs(ledValue);
    if (ledStatus.run_service !== "start_ctrl_led") {
      return Promise.reject("Setting leds failed");
    }
  }

  private async updateLowPrioCapabilities() {
    this.log('updateLowPrioCapabilities');
    await this.updateWANStatus();
    await this.updateMemoryUsage();
    await this.updateCPUUsage();
    await this.updateUptime();
  }

  private async updateHighPrioCapabilities() {
    this.log('updateHighPrioCapabilities');
    await this.updateOnlineDevices();
    await this.updateTrafficData();
  }

  private async updateWANStatus() {
    const wanData = await this.client.getWANStatus().catch(error => Promise.reject(error));
    const routerConnected = wanData.status && wanData.status === 1 ? true : false;
    if (this.getCapabilityValue('wan_connected') !== routerConnected) {
      this.triggerWANConnectionStatusChanged(this, {wan_connected: routerConnected}, {});
    }
    if (wanData.ipaddr && wanData.ipaddr !== '') {
      if (this.getCapabilityValue('external_ip') !== wanData.ipaddr) {
        this.triggerExternalIPChanged(this, {external_ip: wanData.ipaddr}, {});
      }
      this.setCapabilityValue('external_ip', wanData.ipaddr);
    }
    this.setCapabilityValue('wan_connected', routerConnected);
  }

  private async updateOnlineDevices() {
    const oldList = this.onlineDevices;
    this.onlineDevices = await this.client.getOnlineClients().catch(error => Promise.reject(error));
    this.onlineDevices.forEach(client => {
      if (oldList.length > 0) {
        if (!oldList.find(obj => {
          return obj.ip === client.ip && obj.mac === obj.mac;
        })) {
          const tokens = {
            name: client.name,
            ip: client.ip,
            mac: client.mac,
            nickname: client.nickName
          };
          this.triggerDeviceCameOnline(this, tokens, {});
        }
      }
    });

    if (oldList.length > 0) {
      oldList.forEach(oldClient => {
        if (!this.onlineDevices.find(obj => {
          return obj.ip === oldClient.ip && obj.mac === oldClient.mac;
        })) {
          const tokens = {
            name: oldClient.name,
            ip: oldClient.ip,
            mac: oldClient.mac,
            nickname: oldClient.nickName
          };
          this.triggerDeviceWentOffline(this, tokens, {});
        }
      });
    }
    this.setCapabilityValue('online_devices', this.onlineDevices.length);
  }

  private async updateMemoryUsage() {
    const memData = await this.client.getMemoryUsagePercentage().catch(error => Promise.reject(error));
    this.setCapabilityValue('mem_used', memData);
  }

  private async updateCPUUsage() {
    const cpuData = await this.client.getCPUUsagePercentage().catch(error => Promise.reject(error));
    this.setCapabilityValue('cpu_usage', cpuData);
  }

  private async updateUptime() {
    const uptimeData = await this.client.getUptime().catch(error => Promise.reject(error));
    this.setCapabilityValue('uptime_seconds', uptimeData);
  }

  private async updateTrafficData() {
    const trafficDataFirst = await this.client.getTotalTrafficData().catch(error => Promise.reject(error));
    await this.wait(2000);
    const trafficDataSecond = await this.client.getTotalTrafficData().catch(error => Promise.reject(error));
    this.setCapabilityValue('traffic_total_received', trafficDataSecond.trafficReceived);
    this.setCapabilityValue('traffic_total_sent', trafficDataSecond.trafficSent);
    this.setCapabilityValue('realtime_download', trafficDataSecond.trafficReceived - trafficDataFirst.trafficReceived);
    this.setCapabilityValue('realtime_upload', trafficDataSecond.trafficSent - trafficDataFirst.trafficSent);
  }

  private async wait(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  private startPolling() {
    this.stopPolling();
    this.lowPrioPollingIntervalID = this.homey.setInterval(async () => {
      await this.updateLowPrioCapabilities();
    }, 300000); // 5 minutes

    this.highPrioPollingIntervalID = this.homey.setInterval(async () => {
      await this.updateHighPrioCapabilities();
    }, 60000); // 1 minute
  }

  private stopPolling() {
    if (this.lowPrioPollingIntervalID) {
      this.homey.clearInterval(this.lowPrioPollingIntervalID);
    }
    if (this.highPrioPollingIntervalID) {
      this.homey.clearInterval(this.highPrioPollingIntervalID);
    }
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.registerTriggers();
    this.registerConditions();
    const cryptoClient = new CryptoClient(Homey.env.CRYPTO_KEY);
    this.client = new AsusWRTClient(this.getData().ip, cryptoClient.decrypt(this.getData().username), cryptoClient.decrypt(this.getData().password));
    await this.updateLowPrioCapabilities();
    await this.updateHighPrioCapabilities();
    this.startPolling();
    this.log('AsusRouterDevice has been initialized');
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('AsusRouterDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings: { }, newSettings: { }, changedKeys: { } }): Promise<string | void> {
    this.log('AsusRouterDevice settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('AsusRouterDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.stopPolling();
    this.log('AsusRouterDevice has been deleted');
  }

  private registerTriggers() {
    this.log('registerTriggers');
    const deviceCameOnline = this.homey.flow.getDeviceTriggerCard('device-came-online');
		this.triggerDeviceCameOnline = (device, tokens, state) => {
			deviceCameOnline
				.trigger(device, tokens, state)
				.catch(this.error);
		};

    const deviceWentOffline = this.homey.flow.getDeviceTriggerCard('device-went-offline');
    this.triggerDeviceWentOffline = (device, tokens, state) => {
      deviceWentOffline
        .trigger(device, tokens, state)
        .catch(this.error);
    }

    const wanConnectionStatusChanged = this.homey.flow.getDeviceTriggerCard('wan-connection-status-changed');
    this.triggerWANConnectionStatusChanged = (device, tokens, state) => {
      wanConnectionStatusChanged
        .trigger(device, tokens, state)
        .catch(this.error);
    }

    const externalIPChanged = this.homey.flow.getDeviceTriggerCard('external-ip-changed');
    this.triggerExternalIPChanged = (device, tokens, state) => {
      externalIPChanged
        .trigger(device, tokens, state)
        .catch(this.error);
    }
  }

  private registerConditions() {
    this.log('registerConditions');
    this.conditionDeviceIsConnected = this.homey.flow.getConditionCard('device-is-connected');
    this.conditionDeviceIsConnected
      .registerRunListener(async (args: any, state: any) => {
        await this.updateOnlineDevices();
        if (this.onlineDevices.find(device => device.ip === args.client.ip)) {
          return true;
        } else {
          return false;
        }
      })
      .registerArgumentAutocompleteListener('client', async (query: string): Promise<Homey.FlowCard.ArgumentAutocompleteResults> => {
        const searchFor = query.toUpperCase();
        const devicesInQuery = this.onlineDevices.filter(device => {
          return device.ip.toUpperCase().includes(searchFor) || device.name.toUpperCase().includes(searchFor) || device.nickName.toUpperCase().includes(searchFor);
        });
        const results: ArgumentAutocompleteResults = [
          ...devicesInQuery.map(device => ({name: device.name, ip: device.ip, description: device.ip}))
        ]
        return results;
      });
  }
}

module.exports = AsusRouterDevice;

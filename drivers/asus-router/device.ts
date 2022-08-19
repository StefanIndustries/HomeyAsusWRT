import Homey, { FlowCardCondition } from 'homey';
import { ArgumentAutocompleteResults } from 'homey/lib/FlowCard';
import { AsusWRTClient } from '../../lib/AsusWRTClient';
import { AsusWRTApp } from '../../app';
import { CryptoClient } from '../../lib/CryptoClient';
import { AsusWRTConnectedClient } from '../../lib/models/AsusWRTConnectedClient';
import { AsusWRTOperationMode } from '../../lib/models/AsusWRTOperationMode';

export class AsusRouterDevice extends Homey.Device {

  private client!: AsusWRTClient;
  private onlineDevicesPollingInterval: any;
  private updateTrafficDataPollingInterval: any;
  private wanStatusPollingInterval: any;
  private memoryUsagePollingInterval: any;
  private cpuUsagePollingInterval: any;
  private uptimePollingInterval: any;
  private onlineDevices: AsusWRTConnectedClient[] = [];

  private triggerDeviceCameOnline!: (device: any, tokens: any, state: any) => void;
  private triggerDeviceWentOffline!: (device: any, tokens: any, state: any) => void;
  private triggerWANConnectionStatusChanged!: (device: any, tokens: any, state: any) => void;
  private triggerExternalIPChanged!: (device: any, tokens: any, state: any) => void;

  private conditionDeviceIsConnected!: FlowCardCondition;

  public async reboot() {
    const rebootStatus = await this.client.reboot();
    if (rebootStatus.run_service !== 'reboot') {
      return Promise.reject('Reboot failed');
    }
  }

  public async setLEDs(ledValue: number) {
    const ledStatus = await this.client.setLEDs(ledValue);
    if (ledStatus.run_service !== 'start_ctrl_led') {
      return Promise.reject('Setting leds failed');
    }
  }

  private async updateRouterCapabilities() {
    this.log('Force updating router capabilities');
    await this.updateWANStatus();
    await this.updateMemoryUsage();
    await this.updateCPUUsage();
    await this.updateUptime();
    await this.updateOnlineDevices();
    await this.updateTrafficData();
  }

  private async updateAccessPointCapabilities() {
    this.log('Force updating router capabilities');
    await this.updateMemoryUsage();
    await this.updateCPUUsage();
    await this.updateUptime();
    await this.updateOnlineDevices();
  }

  private async updateWANStatus() {
    this.log('updatingWanStatus');
    const wanData = await this.client.getWANStatus().catch(error => Promise.reject(error));
    const routerConnected = !!(wanData.status && wanData.status === 1);
    if (this.getCapabilityValue('alarm_wan_disconnected') !== !routerConnected) {
      this.triggerWANConnectionStatusChanged(this, { wan_connected: routerConnected }, {});
    }
    if (wanData.ipaddr && wanData.ipaddr !== '') {
      if (this.getCapabilityValue('external_ip') !== wanData.ipaddr) {
        this.triggerExternalIPChanged(this, { external_ip: wanData.ipaddr }, {});
      }
      this.setCapabilityValue('external_ip', wanData.ipaddr);
    }
    this.setCapabilityValue('alarm_wan_disconnected', !routerConnected);
  }

  private async updateOnlineDevices() {
    this.log('updatingOnlineDevices');
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
            nickname: client.nickName,
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
            nickname: oldClient.nickName,
          };
          this.triggerDeviceWentOffline(this, tokens, {});
        }
      });
    }
    this.setCapabilityValue('meter_online_devices', this.onlineDevices.length);
  }

  private async updateMemoryUsage() {
    this.log('updatingMemoryUsage');
    const memData = await this.client.getMemoryUsagePercentage().catch(error => Promise.reject(error));
    this.setCapabilityValue('meter_mem_used', memData);
  }

  private async updateCPUUsage() {
    this.log('updatingCPUUsage');
    const cpuData = await this.client.getCPUUsagePercentage().catch(error => Promise.reject(error));
    this.setCapabilityValue('meter_cpu_usage', cpuData);
  }

  private async updateUptime() {
    this.log('updatingUptime');
    const uptimeData = await this.client.getUptime().catch(error => Promise.reject(error));
    this.setCapabilityValue('uptime_seconds', uptimeData);
  }

  private async updateTrafficData() {
    this.log('updatingTrafficData');
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
    this.log('Starting Polling Intervals');
    const settings = this.getSettings();
    this.onlineDevicesPollingInterval = this.homey.setInterval(async () => {
      await this.updateOnlineDevices();
    }, settings.online_devices_polling_interval * 1000);

    if (this.getStore().operationMode !== AsusWRTOperationMode.AccessPoint) {
      this.updateTrafficDataPollingInterval = this.homey.setInterval(async () => {
        await this.updateTrafficData();
      }, settings.traffic_data_polling_interval * 1000);

      this.wanStatusPollingInterval = this.homey.setInterval(async () => {
        await this.updateWANStatus();
      }, settings.wan_status_polling_interval * 1000);
    }

    this.memoryUsagePollingInterval = this.homey.setInterval(async () => {
      await this.updateMemoryUsage();
    }, settings.memory_usage_polling_interval * 1000);

    this.cpuUsagePollingInterval = this.homey.setInterval(async () => {
      await this.updateCPUUsage();
    }, settings.cpu_usage_polling_interval * 1000);

    this.uptimePollingInterval = this.homey.setInterval(async () => {
      await this.updateUptime();
    }, settings.uptime_polling_interval * 1000);
  }

  private stopPolling() {
    this.log('Stopping Polling Intervals');
    if (this.onlineDevicesPollingInterval) {
      this.homey.clearInterval(this.onlineDevicesPollingInterval);
    }
    if (this.updateTrafficDataPollingInterval) {
      this.homey.clearInterval(this.updateTrafficDataPollingInterval);
    }
    if (this.wanStatusPollingInterval) {
      this.homey.clearInterval(this.wanStatusPollingInterval);
    }
    if (this.memoryUsagePollingInterval) {
      this.homey.clearInterval(this.memoryUsagePollingInterval);
    }
    if (this.cpuUsagePollingInterval) {
      this.homey.clearInterval(this.cpuUsagePollingInterval);
    }
    if (this.uptimePollingInterval) {
      this.homey.clearInterval(this.uptimePollingInterval);
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

    let { operationMode } = this.getStore();
    if (!operationMode) {
      const wanData = await this.client.getWANStatus();
      operationMode = wanData.status && wanData.status === 1 ? AsusWRTOperationMode.Router : AsusWRTOperationMode.AccessPoint;
      const capabilities = this.getCapabilities();
      capabilities.forEach(cap => {
        if (['cpu_usage', 'mem_used', 'online_devices', 'wan_connected'].indexOf(cap) > 0) {
          this.removeCapability(cap);
        }
      });

      capabilities.forEach(cap => {
        if (['meter_cpu_usage', 'meter_mem_used', 'meter_online_devices', 'alarm_wan_disconnected'].indexOf(cap) === -1) {
          this.addCapability(cap);
        }
      });
      this.setStoreValue('operationMode', operationMode);
    }

    const capabilities = this.getCapabilities();
    switch (operationMode) {
      case AsusWRTOperationMode.Router:
        await this.updateRouterCapabilities();
        break;
      case AsusWRTOperationMode.AccessPoint:
        capabilities.forEach(cap => {
          if (['realtime_download', 'realtime_upload', 'external_ip', 'alarm_wan_disconnected', 'traffic_total_received', 'traffic_total_sent'].indexOf(cap) > 0) {
            this.removeCapability(cap);
          }
        });
        await this.updateAccessPointCapabilities();
        break;
      default:
        await this.updateRouterCapabilities();
        break;
    }
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
  async onSettings(event: { oldSettings: { }, newSettings: any, changedKeys: { } }): Promise<string | void> {
    this.log('AsusRouterDevice settings where changed');
    this.stopPolling();
    this.startPolling();
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
    };

    const wanConnectionStatusChanged = this.homey.flow.getDeviceTriggerCard('wan-connection-status-changed');
    this.triggerWANConnectionStatusChanged = (device, tokens, state) => {
      wanConnectionStatusChanged
        .trigger(device, tokens, state)
        .catch(this.error);
    };

    const externalIPChanged = this.homey.flow.getDeviceTriggerCard('external-ip-changed');
    this.triggerExternalIPChanged = (device, tokens, state) => {
      externalIPChanged
        .trigger(device, tokens, state)
        .catch(this.error);
    };
  }

  private registerConditions() {
    this.log('registerConditions');
    this.conditionDeviceIsConnected = this.homey.flow.getConditionCard('device-is-connected');
    this.conditionDeviceIsConnected
      .registerRunListener(async (args: any, state: any) => {
        await this.updateOnlineDevices();
        if (this.onlineDevices.find(device => device.ip === args.client.ip)) {
          return true;
        }
        return false;
      })
      .registerArgumentAutocompleteListener('client', async (query: string): Promise<Homey.FlowCard.ArgumentAutocompleteResults> => {
        const searchFor = query.toUpperCase();
        const devicesInQuery = this.onlineDevices.filter(device => {
          return device.ip.toUpperCase().includes(searchFor) || device.name.toUpperCase().includes(searchFor) || device.nickName.toUpperCase().includes(searchFor);
        });
        const results: ArgumentAutocompleteResults = [
          ...devicesInQuery.map(device => ({ name: device.name, ip: device.ip, description: device.ip })),
        ];
        return results;
      });
  }

}

module.exports = AsusRouterDevice;

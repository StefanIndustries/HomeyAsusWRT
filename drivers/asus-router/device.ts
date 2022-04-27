import Homey from 'homey';
import { AsusWRTClient } from '../../lib/AsusWRTClient';
import { AsusWRTApp } from '../../app';
import { CryptoClient } from '../../lib/CryptoClient';

class AsusRouterDevice extends Homey.Device {

  private client!: AsusWRTClient;
  private lowPrioPollingIntervalID: any;
  private highPrioPollingIntervalID: any;
  private onlineDevices: any[] = [];
  private app!: AsusWRTApp;

  private async updateLowPrioCapabilities() {
    await this.updateWANStatus();
    await this.updateMemoryUsage();
    await this.updateCPUUsage();
    await this.updateUptime();
  }

  private async updateHighPrioCapabilities() {
    await this.updateOnlineDevices();
    await this.updateTrafficData();
  }

  private async updateWANStatus() {
    const wanData = await this.client.getWANStatus();
    const routerConnected = wanData.status && wanData.status === 1 ? true : false;
    if (this.getCapabilityValue('wan_connected') !== routerConnected) {
      this.app.triggerWANConnectionStatusChanged(this, {wan_connected: routerConnected}, {});
    }
    if (this.getCapabilityValue('external_ip') !== wanData.ipaddr) {
      this.app.triggerExternalIPChanged(this, {external_ip: wanData.ipaddr}, {});
    }
    this.setCapabilityValue('wan_connected', routerConnected);
    this.setCapabilityValue('external_ip', wanData.ipaddr);
  }

  private async updateOnlineDevices() {
    const oldList = this.onlineDevices;
    this.onlineDevices = await this.client.getOnlineClients();
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
          this.app.triggerDeviceCameOnline(this, tokens, {});
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
          this.app.triggerDeviceWentOffline(this, tokens, {});
        }
      });
    }
    this.setCapabilityValue('online_devices', this.onlineDevices.length);
  }

  private async updateMemoryUsage() {
    const memData = await this.client.getMemoryUsagePercentage();
    this.setCapabilityValue('mem_used', memData);
  }

  private async updateCPUUsage() {
    const cpuData = await this.client.getCPUUsagePercentage();
    this.setCapabilityValue('cpu_usage', cpuData);
  }

  private async updateUptime() {
    const uptimeData = await this.client.getUptime();
    this.setCapabilityValue('uptime_seconds', uptimeData);
  }

  private async updateTrafficData() {
    const trafficDataFirst = await this.client.getTotalTrafficData();
    await this.wait(2000);
    const trafficDataSecond = await this.client.getTotalTrafficData();
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
    this.app = <AsusWRTApp>this.homey.app;
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
}

module.exports = AsusRouterDevice;

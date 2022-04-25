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
    await this.updateMemoryUsage();
    await this.updateCPUUsage();
  }

  private async updateHighPrioCapabilities() {
    await this.updateOnlineDevices();
  }

  private async updateOnlineDevices() {
    const oldList = this.onlineDevices;
    this.onlineDevices = [];
    const clientListData = await this.client.appGet('get_clientlist()');
    for (const c in clientListData['get_clientlist']) {
      if (c.length === 17 && "isOnline" in clientListData['get_clientlist'][c] && clientListData['get_clientlist'][c]['isOnline'] == '1') {
        const client = clientListData['get_clientlist'][c];
        this.onlineDevices.push({
          ip: client.ip,
          mac: client.mac,
          name: client.name,
          nickName: client.nickName
        });
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
      }
    }
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
    const memData = await this.client.appGet('memory_usage()', 'memory_usage');
    const totalMemory = parseInt(memData.mem_total);
    const memUsed = parseInt(memData.mem_used);
    const percentageUsed = (100 / totalMemory) * memUsed;
    this.setCapabilityValue('mem_used', percentageUsed);
  }

  private async updateCPUUsage() {
    const cpuData = await this.client.appGet('cpu_usage()', 'cpu_usage');
    let totalAvailable = 0;
    let totalUsed = 0;
    for (let i = 1; i < 16; i++) {
      totalAvailable += this.addNumberValueIfExists(cpuData, `cpu${i}_total`);
    }
    for (let i = 1; i < 16; i++) {
      totalUsed += this.addNumberValueIfExists(cpuData, `cpu${i}_usage`);
    }
    const percentageUsed = (100 / totalAvailable) * totalUsed;
    this.setCapabilityValue('cpu_usage', percentageUsed);
  }

  private addNumberValueIfExists(object: any, property: string): number {
    if (object[property]) {
      return parseInt(object[property]);
    }
    return 0;
  }

  private startPolling() {
    this.stopPolling();
    this.lowPrioPollingIntervalID = this.homey.setInterval(async () => {
      await this.updateLowPrioCapabilities();
    }, 300000); // 5 minutes

    this.highPrioPollingIntervalID = this.homey.setInterval(async () => {
      await this.updateHighPrioCapabilities();
    }, 60000) // 1 minute
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

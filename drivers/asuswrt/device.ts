import Homey from 'homey';
import { AsusWRTOperationMode } from 'node-asuswrt/lib/models/AsusWRTOperationMode';
import { AsusWRTConnectedClient } from '../../lib/models/AsusWRTConnectedClient';

export class AsusWRTDevice extends Homey.Device {

  private wiredClients: AsusWRTConnectedClient[] = [];
  private wireless24GClients: AsusWRTConnectedClient[] = [];
  private wireless5GClients: AsusWRTConnectedClient[] = [];

  public setConnectedClients(wiredClients: AsusWRTConnectedClient[], wireless24GClients: AsusWRTConnectedClient[], wireless5GClients: AsusWRTConnectedClient[]) {
    this.wiredClients = wiredClients;
    this.wireless24GClients = wireless24GClients;
    this.wireless5GClients = wireless5GClients;
  }

  public getWiredClients(): AsusWRTConnectedClient[] {
    return this.wiredClients;
  }
  public getWireless24GClients(): AsusWRTConnectedClient[] {
    return this.wireless24GClients;
  }
  public getWireless5GClients(): AsusWRTConnectedClient[] {
    return this.wireless5GClients;
  }

  static routerCapabilities = [
    'alarm_wan_disconnected',
    'external_ip',
    'meter_cpu_usage',
    'meter_mem_used',
    'meter_online_devices',
    'realtime_download',
    'realtime_upload',
    'traffic_total_received',
    'traffic_total_sent',
    'uptime_days',
  ];

  static accessPointCapabilities = [
    'meter_cpu_usage',
    'meter_mem_used',
    'meter_online_devices',
    'uptime_days',
  ];

  private async wait(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  private async setCapabilities(operationMode: AsusWRTOperationMode) {
    const capabilityList = operationMode === AsusWRTOperationMode.Router ? AsusWRTDevice.routerCapabilities : AsusWRTDevice.accessPointCapabilities;
    capabilityList.forEach(async cap => {
      if (!this.hasCapability(cap)) {
        await this.wait(5000);
        await this.addCapability(cap);
        if (!this.hasCapability(cap)) {
          await this.wait(10000);
          await this.addCapability(cap);
        }
      }
    });
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    await this.setCapabilities(this.getStoreValue('operationMode'));
    this.log('AsusWRTDevice has been initialized');
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    await this.setCapabilities(this.getStoreValue('operationMode'));
    this.log('AsusWRTDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings: {}, newSettings: {}, changedKeys: [] }): Promise<string|void> {
    this.log('AsusWRTDevice settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('AsusWRTDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('AsusWRTDevice has been deleted');
  }

}

module.exports = AsusWRTDevice;

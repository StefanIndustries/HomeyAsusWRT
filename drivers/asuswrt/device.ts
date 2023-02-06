import Homey from 'homey';
import { AsusWRTOperationMode } from 'node-asuswrt/lib/models/AsusWRTOperationMode';

export class AsusWRTDevice extends Homey.Device {

  static routerCapabilities = [
    'alarm_wan_disconnected',
    'external_ip',
    'meter_cpu_usage',
    'meter_mem_used',
    'meter_online_devices',
    'traffic_total_received',
    'traffic_total_sent',
  ];

  static accessPointCapabilities = [
    'meter_cpu_usage',
    'meter_mem_used',
    'meter_online_devices',
  ];

  private async wait(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  private async setCapabilities(operationMode: AsusWRTOperationMode) {
    const capabilityList = operationMode === AsusWRTOperationMode.Router ? AsusWRTDevice.routerCapabilities : AsusWRTDevice.accessPointCapabilities;
    capabilityList.forEach(async cap => {
      this.log(`test capability: ${cap} set for device`);
      if (!this.hasCapability(cap)) {
        await this.wait(1000);
        this.log(`capability: ${cap} for device missing, adding now.`);
        await this.addCapability(cap);
        if (!this.hasCapability(cap)) {
          await this.wait(10000);
          this.log(`capability: ${cap} for device still missing, adding now.`);
          await this.addCapability(cap);
        }
      } else
      {
        this.log(`capability: ${cap} already available for device.`)
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

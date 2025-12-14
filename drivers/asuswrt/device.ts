import Homey from 'homey';
import { AccessPointCapabilities, RouterCapabilities } from './capabilities';
import { getConnectedDisconnectedToken, getMissingConnectedDevices, getNewConnectedDevices, wait } from './utils';
import { AsusConnectedDevice } from "node-asuswrt/lib/models/asus-connected-device";
import { AsusCpuMemLoad } from "node-asuswrt/lib/models/asus-cpu-mem-load";
import { AsusWanLinkStatus } from "node-asuswrt/lib/models/asus-wan-link-status";
import { AsusTrafficData } from "node-asuswrt/lib/models/asus-traffic-data";
import { AsusClient } from "node-asuswrt/lib/classes/asus-client";
import { AsusRouter } from "node-asuswrt/lib/classes/asus-router";

export class AsusWRTDevice extends Homey.Device {
  public asusClient: AsusClient | undefined;
  public deviceIsReady = false;

  private triggerNewFirmwareAvailable!: (tokens: any) => void;
  private triggerExternalIPChanged!: (device: any, tokens: any, state: any) => void;
  private triggerWanTypeChanged!: (device: any, tokens: any, state: any) => void;
  private triggerWANConnectionStatusChanged!: (device: any, tokens: any, state: any) => void;

  private triggerDeviceConnected!: (tokens: any) => void;
  private trigger24GDeviceConnected!: (tokens: any) => void;
  private trigger5GDeviceConnected!: (tokens: any) => void;
  private trigger6GDeviceConnected!: (tokens: any) => void;
  private triggerWiredDeviceConnected!: (tokens: any) => void;

  private triggerDeviceDisconnected!: (tokens: any) => void;
  private trigger24GDeviceDisconnected!: (tokens: any) => void;
  private trigger5GDeviceDisconnected!: (tokens: any) => void;
  private trigger6GDeviceDisconnected!: (tokens: any) => void;
  private triggerWiredDeviceDisconnected!: (tokens: any) => void;

  private firmwareVersion: string = '';
  private newVersion: string = '';

  private wiredClients: AsusConnectedDevice[] = [];
  private wireless24GClients: AsusConnectedDevice[] = [];
  private wireless5GClients: AsusConnectedDevice[] = [];
  private wireless6GClients: AsusConnectedDevice[] = [];

  public async updateCapabilities(executeTriggers: boolean = true) {
    const routerMac = this.getData().mac;
    this.asusClient ? await this.setAvailable() : await this.setUnavailable('Device not online');
    if (!this.getAvailable() || !this.asusClient) {
      return;
    }
    let successfullyUpdatedEverything = true;
    let errorOnDataPoints: string[] = [];
    this.log(`updating connected device information for access point ${routerMac}`);

    if (executeTriggers) {
      if (this.asusClient.deviceInfo.fwver) {
        await this.setFirmwareVersion(this.asusClient.deviceInfo.fwver, this.asusClient.deviceInfo.newfwver)
      }
    }

    const wiredDevices = this.asusClient.connectedDevices.filter(cd => cd.connectionMethod == 'wired');
    const twoGDevices = this.asusClient.connectedDevices.filter(cd => cd.connectionMethod == '2g');
    const fiveGDevices = this.asusClient.connectedDevices.filter(cd => cd.connectionMethod == '5g');
    const sixGDevices = this.asusClient.connectedDevices.filter(cd => cd.connectionMethod == '6g');
    try {
      await this.setConnectedClients(wiredDevices, twoGDevices, fiveGDevices, sixGDevices, executeTriggers);
    } catch(err) {
      successfullyUpdatedEverything = false;
      errorOnDataPoints.push('Connected clients');
      this.log(`failed to update connected device information for access point ${routerMac}`, err);
    }

    try {
      this.log(`updating cpu memory load for access point ${routerMac}`);
      const load = await this.asusClient.getCPUMemoryLoad();
      await this.setLoad(load);
    } catch (err) {
      successfullyUpdatedEverything = false;
      errorOnDataPoints.push('CPU Memory');
      this.log(err);
    }

    try {
      this.log(`updating uptime for access point ${routerMac}`);
      const uptimeSeconds = await this.asusClient.getUptimeSeconds();
      await this.setUptimeDaysBySeconds(uptimeSeconds);
    } catch (err) {
      successfullyUpdatedEverything = false;
      errorOnDataPoints.push('Uptime');
      this.log(err);
    }

    if (this.getStoreValue('operationMode') === 0) {
      const router = this.asusClient as AsusRouter;
      this.log(`device is of type router, executing additional updates`);
      try {
        this.log(`updating wan status for access point ${routerMac}`);
        const WANStatus = await router.getWANStatus();
        await this.setWANStatus(WANStatus, executeTriggers);
      } catch (err) {
        successfullyUpdatedEverything = false;
        errorOnDataPoints.push('WAN Status');
        this.log(err);
      }

      try {
        this.log(`updating traffic data for access point ${routerMac}`);
        const trafficDataFirst = await router.getTotalTrafficData();
        await wait(2000);
        const trafficDataSecond = await router.getTotalTrafficData();
        await this.setTrafficValues(trafficDataFirst, trafficDataSecond);
      } catch (err) {
        successfullyUpdatedEverything = false;
        errorOnDataPoints.push('Traffic data');
        this.log(err);
      }
    }

    if (!successfullyUpdatedEverything) {
      this.log(`failed to update some information for access point ${routerMac}`);
      await this.setWarning(`Failed to retrieve ${errorOnDataPoints.join(', ')} device info, some functionality might not work`);
    } else {
      this.log(`successfully updated all information for access point ${routerMac}`);
      await this.setWarning(null);
    }
  }

  public setAsusClient(client: AsusClient) {
    this.asusClient = client;
  }

  public getWiredClients(): AsusConnectedDevice[] {
    return this.wiredClients;
  }
  public getWireless24GClients(): AsusConnectedDevice[] {
    return this.wireless24GClients;
  }
  public getWireless5GClients(): AsusConnectedDevice[] {
    return this.wireless5GClients;
  }
  public getWireless6GClients(): AsusConnectedDevice[] {
    return this.wireless6GClients;
  }

  public async setConnectedClients(wiredClients: AsusConnectedDevice[], wireless24GClients: AsusConnectedDevice[], wireless5GClients: AsusConnectedDevice[], wireless6GClients: AsusConnectedDevice[], executeTriggers: boolean = true) {
    const oldWiredClients = this.wiredClients;
    const oldWireless24GClients = this.wireless24GClients;
    const oldWireless5GClients = this.wireless5GClients;
    const oldWireless6GClients = this.wireless6GClients;

    this.wiredClients = wiredClients;
    this.wireless24GClients = wireless24GClients;
    this.wireless5GClients = wireless5GClients;
    this.wireless6GClients = wireless6GClients;

    if (executeTriggers) {
      // trigger any device
      getMissingConnectedDevices(oldWiredClients.concat(oldWireless24GClients, oldWireless5GClients, oldWireless6GClients), wiredClients.concat(wireless24GClients, wireless5GClients, wireless6GClients)).forEach(missingDevice => this.triggerDeviceDisconnected(getConnectedDisconnectedToken(missingDevice)));
      getNewConnectedDevices(oldWiredClients.concat(oldWireless24GClients, oldWireless5GClients, oldWireless6GClients), wiredClients.concat(wireless24GClients, wireless5GClients, wireless6GClients)).forEach(newDevice => this.triggerDeviceConnected(getConnectedDisconnectedToken(newDevice)));

      // trigger wired device
      getMissingConnectedDevices(oldWiredClients, wiredClients).forEach(missingDevice => this.triggerWiredDeviceDisconnected(getConnectedDisconnectedToken(missingDevice)));
      getNewConnectedDevices(oldWiredClients, wiredClients).forEach(newDevice => this.triggerWiredDeviceConnected(getConnectedDisconnectedToken(newDevice)));

      // trigger 2.4ghz device
      getMissingConnectedDevices(oldWireless24GClients, wireless24GClients).forEach(missingDevice => this.trigger24GDeviceDisconnected(getConnectedDisconnectedToken(missingDevice)));
      getNewConnectedDevices(oldWireless24GClients, wireless24GClients).forEach(newDevice => this.trigger24GDeviceConnected(getConnectedDisconnectedToken(newDevice)));

      // trigger 5ghz device
      getMissingConnectedDevices(oldWireless5GClients, wireless5GClients).forEach(missingDevice => this.trigger5GDeviceDisconnected(getConnectedDisconnectedToken(missingDevice)));
      getNewConnectedDevices(oldWireless5GClients, wireless5GClients).forEach(newDevice => this.trigger5GDeviceConnected(getConnectedDisconnectedToken(newDevice)));

      // trigger 6ghz device
      getMissingConnectedDevices(oldWireless6GClients, wireless6GClients).forEach(missingDevice => this.trigger6GDeviceDisconnected(getConnectedDisconnectedToken(missingDevice)));
      getNewConnectedDevices(oldWireless6GClients, wireless6GClients).forEach(newDevice => this.trigger6GDeviceConnected(getConnectedDisconnectedToken(newDevice)));
   }
    
    if (this.hasCapability('meter_online_devices')) {
      await this.setCapabilityValue('meter_online_devices', this.wiredClients.length + this.wireless24GClients.length + this.wireless5GClients.length);
    }
  }

  public async setFirmwareVersion(currentVersion: string, newVersion: string) {
    if (this.firmwareVersion !== '' && newVersion !== '' && this.newVersion !== newVersion) {
      this.triggerNewFirmwareAvailable({"version": newVersion});
    }
    this.firmwareVersion = currentVersion;
    this.newVersion = newVersion;
  }

  public async setLoad(load: AsusCpuMemLoad) {
    if (this.hasCapability('meter_cpu_usage')) {
      await this.setCapabilityValue('meter_cpu_usage', load.CPUUsagePercentage);
    }
    if (this.hasCapability('meter_mem_used')) {
      await this.setCapabilityValue('meter_mem_used', load.MemoryUsagePercentage);
    }
  }

  public async setUptimeDaysBySeconds(uptimeSeconds: number) {
    if (this.hasCapability('uptime_days')) {
      await this.setCapabilityValue('uptime_days', uptimeSeconds * 0.0000115741);
    }
  }

  public async setWANStatus(WANStatus: AsusWanLinkStatus, executeTriggers: boolean = true) {
    if (this.hasCapability('external_ip')) {
      if (this.getCapabilityValue('external_ip') !== WANStatus.ipaddr) {
        if (executeTriggers && this.triggerExternalIPChanged) {
          this.triggerExternalIPChanged(this, { external_ip: WANStatus.ipaddr }, {});
        }
      }
      await this.setCapabilityValue('external_ip', WANStatus.ipaddr);
    }
    if (this.hasCapability('alarm_wan_disconnected')) {
      const routerConnected = !!(WANStatus.status && WANStatus.status === 1);
      if (this.getCapabilityValue('alarm_wan_disconnected') !== routerConnected) {
        if (executeTriggers && this.triggerWANConnectionStatusChanged) {
          this.triggerWANConnectionStatusChanged(this, { wan_connected: routerConnected }, {});
        }
      }
      await this.setCapabilityValue('alarm_wan_disconnected', WANStatus.status && WANStatus.status !== 1 ? true : false);
    }

    if (this.hasCapability('wan_type')) {
      if (this.getCapabilityValue('wan_type') !== WANStatus.type) {
        if (executeTriggers && this.triggerWanTypeChanged) {
          this.triggerWanTypeChanged(this, { wan_type: WANStatus.type }, {});
        }
      }
      await this.setCapabilityValue('wan_type', WANStatus.type);
    }
  }

  public async setTrafficValues(trafficDataFirst: AsusTrafficData, trafficDataSecond: AsusTrafficData) {
    if (this.hasCapability('traffic_total_received')) {
      await this.setCapabilityValue('traffic_total_received', trafficDataSecond.trafficReceived);
    }
    if (this.hasCapability('traffic_total_sent')) {
      await this.setCapabilityValue('traffic_total_sent', trafficDataSecond.trafficSent);
    }
    if (this.hasCapability('realtime_download')) {
      await this.setCapabilityValue('realtime_download', trafficDataSecond.trafficReceived - trafficDataFirst.trafficReceived);
    }
    if (this.hasCapability('realtime_upload')) {
      await this.setCapabilityValue('realtime_upload', trafficDataSecond.trafficSent - trafficDataFirst.trafficSent);
    }
  }

  private async setCapabilities() {
    const capabilityList = this.getStoreValue('operationMode') === 0 ? RouterCapabilities : AccessPointCapabilities;
    for (const cap of capabilityList) {
      if (!this.hasCapability(cap)) {
        await this.addCapability(cap);
        await wait(5000);
      }
    }
    const currentCapabilities = this.getCapabilities();
    for (const currentCap of currentCapabilities) {
      if (!capabilityList.includes(currentCap)) {
        await this.removeCapability(currentCap);
        await wait(5000);
      }
    }
  }

  private registerFlowListeners() {
    // triggers
    const newFirmware = this.homey.flow.getDeviceTriggerCard('new-firmware-available');
    this.triggerNewFirmwareAvailable = (tokens) => {
      newFirmware
        .trigger(this, tokens)
        .catch(this.error);
    };

    const externalIPChanged = this.homey.flow.getDeviceTriggerCard('external-ip-changed');
    this.triggerExternalIPChanged = (device, tokens, state) => {
      externalIPChanged
        .trigger(device, tokens, state)
        .catch(this.error);
    };

    const wanTypeChanged = this.homey.flow.getDeviceTriggerCard('wan-type-changed');
    this.triggerWanTypeChanged = (device, tokens, state) => {
      wanTypeChanged
        .trigger(device, tokens, state)
        .catch(this.error);
    };

    const wanConnectionStatusChanged = this.homey.flow.getDeviceTriggerCard('wan-connection-changed');
    this.triggerWANConnectionStatusChanged = (device, tokens, state) => {
      wanConnectionStatusChanged
        .trigger(device, tokens, state)
        .catch(this.error);
    };

    const deviceConnected = this.homey.flow.getDeviceTriggerCard('device-connected-to-access-point');
    this.triggerDeviceConnected = (tokens) => {
      deviceConnected
        .trigger(this, tokens)
        .catch(this.error);
    };
    const deviceDisconnected = this.homey.flow.getDeviceTriggerCard('device-disconnected-from-access-point');
    this.triggerDeviceDisconnected = (tokens) => {
      deviceDisconnected
        .trigger(this, tokens)
        .catch(this.error);
    };

    const device24GConnected = this.homey.flow.getDeviceTriggerCard('24g-device-connected-to-access-point');
    this.trigger24GDeviceConnected = (tokens) => {
      device24GConnected
        .trigger(this, tokens)
        .catch(this.error);
    };
    const device24GDisconnected = this.homey.flow.getDeviceTriggerCard('24g-device-disconnected-from-access-point');
    this.trigger24GDeviceDisconnected = (tokens) => {
      device24GDisconnected
        .trigger(this, tokens)
        .catch(this.error);
    };

    const device5GConnected = this.homey.flow.getDeviceTriggerCard('5g-device-connected-to-access-point');
    this.trigger5GDeviceConnected = (tokens) => {
      device5GConnected
        .trigger(this, tokens)
        .catch(this.error);
    };
    const device5GDisconnected = this.homey.flow.getDeviceTriggerCard('5g-device-disconnected-from-access-point');
    this.trigger5GDeviceDisconnected = (tokens) => {
      device5GDisconnected
        .trigger(this, tokens)
        .catch(this.error);
    };

    const device6GConnected = this.homey.flow.getDeviceTriggerCard('6g-device-connected-to-access-point');
    this.trigger6GDeviceConnected = (tokens) => {
      device6GConnected
          .trigger(this, tokens)
          .catch(this.error);
    };
    const device6GDisconnected = this.homey.flow.getDeviceTriggerCard('6g-device-disconnected-from-access-point');
    this.trigger6GDeviceDisconnected = (tokens) => {
      device6GDisconnected
          .trigger(this, tokens)
          .catch(this.error);
    };

    const deviceWiredConnected = this.homey.flow.getDeviceTriggerCard('wired-device-connected-to-access-point');
    this.triggerWiredDeviceConnected = (tokens) => {
      deviceWiredConnected
        .trigger(this, tokens)
        .catch(this.error);
    };
    const deviceWiredDisconnected = this.homey.flow.getDeviceTriggerCard('wired-device-disconnected-from-access-point');
    this.triggerWiredDeviceDisconnected = (tokens) => {
      deviceWiredDisconnected
        .trigger(this, tokens)
        .catch(this.error);
    };

    //conditions
    const conditionDeviceIsConnectedToAccessPoint = this.homey.flow.getConditionCard('wan-is-connected');
    conditionDeviceIsConnectedToAccessPoint
      .registerRunListener((args: { device: AsusWRTDevice }, state: any) => {
        if (args.device.hasCapability('alarm_wan_disconnected')) {
          return !args.device.getCapabilityValue('alarm_wan_disconnected');
        } else {
          return false;
        }
      });
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.registerFlowListeners();
    await this.setCapabilities();
    this.deviceIsReady = true;
    this.log('AsusWRTDevice has been initialized');
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    await this.setCapabilities();
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

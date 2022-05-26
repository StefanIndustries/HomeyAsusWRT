import Homey from 'homey';
import { AsusRouterDevice } from './drivers/asus-router/device';

export class AsusWRTApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('AsusWRTApp has been initialized');


    const reboot = this.homey.flow.getActionCard('reboot');
		reboot.registerRunListener(async (args) => {
      const device = <AsusRouterDevice> args.device;
      await device.reboot();
    });
  }
}

module.exports = AsusWRTApp;
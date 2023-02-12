import Homey from 'homey';
import { AsusRouterDevice } from './drivers/asus-router/device';

export class AsusWRTApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    const reboot = this.homey.flow.getActionCard('reboot');
		reboot.registerRunListener(async (args) => {
      const device = <AsusRouterDevice> args.device;
      await device.reboot();
    });

    const turnOnLeds = this.homey.flow.getActionCard('turn-on-leds');
    turnOnLeds.registerRunListener(async (args) => {
      const device = <AsusRouterDevice> args.device;
      await device.setLEDs(1);
    });

    const turnOffLeds = this.homey.flow.getActionCard('turn-off-leds');
    turnOffLeds.registerRunListener(async (args) => {
      const device = <AsusRouterDevice> args.device;
      await device.setLEDs(0);
    });

    this.log('AsusWRTApp has been initialized');
  }
}

module.exports = AsusWRTApp;
import Homey from 'homey';
import { AsusOoklaSpeedtestResult } from "node-asuswrt/lib/models/asus-ookla-speedtest-result";
import { AsusWRTDriver } from "./drivers/asuswrt/driver";

export class AsusWRTApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('AsusWRTApp has been initialized');
  }

  async getLatestSpeedtestResult(): Promise<AsusOoklaSpeedtestResult | null> {
    const driver = <AsusWRTDriver> this.homey.drivers.getDriver('asuswrt');
    if (driver.asusWrt && driver.asusWrt.asusRouter) {
      const history = await driver.asusWrt.asusRouter.getOoklaSpeedtestHistory()
      if (history) {
        const mostRecent = history.reduce((latest: AsusOoklaSpeedtestResult, current: AsusOoklaSpeedtestResult) => current.timestamp > latest.timestamp ? current : latest);
        return mostRecent;
      }
    }
    return null;
  }
}

module.exports = AsusWRTApp;
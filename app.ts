import Homey from 'homey';
import { AsusOoklaSpeedtestResult } from "node-asuswrt/lib/models/asus-ookla-speedtest-result";
import { AsusWRTDriver } from "./drivers/asuswrt/driver";
import { ConnectedClientsSummary, summarizeConnectedClients, TrafficSampler } from "./drivers/asuswrt/network-widgets";

export class AsusWRTApp extends Homey.App {
  private trafficSampler!: TrafficSampler;

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.trafficSampler = new TrafficSampler(async () => {
      const router = this.getDriver().asusWrt?.asusRouter;
      if (!router) {
        throw new Error('Router is unavailable');
      }
      return router.getTotalTrafficData();
    }, {
      setTimeout: (callback, ms) => this.homey.setTimeout(callback, ms),
      clearTimeout: handle => this.homey.clearTimeout(handle),
      now: () => Date.now()
    });
    this.log('AsusWRTApp has been initialized');
  }

  async onUninit() {
    this.trafficSampler?.stop();
  }

  private getDriver(): AsusWRTDriver {
    return <AsusWRTDriver> this.homey.drivers.getDriver('asuswrt');
  }

  /** Network-wide wired/wireless client counts for the connected clients widget. */
  async getConnectedClientsSummary(): Promise<ConnectedClientsSummary | null> {
    const driver = this.getDriver();
    if (!driver.asusWrt) {
      return null;
    }
    return summarizeConnectedClients(driver.getConnectedClients());
  }

  /** Download/upload throughput of the last 30 seconds for the realtime traffic widget. */
  async getRealtimeTraffic() {
    return this.trafficSampler.getSamples();
  }

  async getLatestSpeedtestResult(): Promise<AsusOoklaSpeedtestResult | null> {
    const driver = <AsusWRTDriver> this.homey.drivers.getDriver('asuswrt');
    if (driver.asusWrt && driver.asusWrt.asusRouter) {
      const history = await driver.asusWrt.asusRouter.getOoklaSpeedtestHistory()
      // reduce() without a start value throws on an empty history (no speedtest run yet).
      if (history && history.length > 0) {
        return history.reduce((latest: AsusOoklaSpeedtestResult, current: AsusOoklaSpeedtestResult) => current.timestamp > latest.timestamp ? current : latest);
      }
    }
    return null;
  }
}

module.exports = AsusWRTApp;
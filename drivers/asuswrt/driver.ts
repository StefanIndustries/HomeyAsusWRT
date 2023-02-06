import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import { AsusWRT } from "node-asuswrt"
import { AsusWRTDevice } from './device';

class AsusWRTDriver extends Homey.Driver {

  private asusClient: AsusWRT | undefined;
  private username: string = '';
  private password: string = '';
  private routerIP: string = '';

  private registerFlowListeners() {
    const rebootNetwork = this.homey.flow.getActionCard('reboot-network');
		rebootNetwork.registerRunListener(async () => {
      if (this.asusClient) {
        await this.asusClient.rebootNetwork();
      }
    });

    const turnOnLeds = this.homey.flow.getActionCard('set-leds');
    turnOnLeds.registerRunListener(async (args: {device: AsusWRTDevice, OnOrOff: string}) => {
      if (this.asusClient) {
        await this.asusClient.setLedsEnabled(args.device.getData().mac, args.OnOrOff === 'on' ? true : false);
      }
    });


  }

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.routerIP = this.homey.settings.get('ip');
    this.username = this.homey.settings.get('username');
    this.password = this.homey.settings.get('password');
    if (this.routerIP !== null && this.username !== null && this.password !== null) {
      this.asusClient = new AsusWRT(this.routerIP, this.username, this.password);
    }
    this.registerFlowListeners();
    this.log('AsusWRTDriver has been initialized');
  }

  async onUninit(): Promise<void> {
    if (this.asusClient) {
      this.asusClient.dispose();
    }
  }

  async onPair(session: PairSession) {
    this.log('starting a new pair session');
    let client: AsusWRT;

    session.setHandler('showView', async (view) => {
      if (view === 'prepare_pairing') {
        if (this.asusClient) {
          const routers = await client.getRouters();
          if (routers.length > 0) {
            await session.showView('list_devices');
          } else {
            await session.showView('router_ip');
          }
        } else {
          await session.showView('router_ip');
        }
      }
    });

    session.setHandler('router_ip_confirmed', async (routerIPFromView) => {
      this.log('pair: router_ip_confirmed');
      const ipRegex = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
      if (ipRegex.test(routerIPFromView)) {
        this.routerIP = 'http://' + routerIPFromView;
        return true;
      } else {
        this.log('invalid ip provided');
        return false;
      }
    });

    session.setHandler('login', async (data: {username: string, password: string}) => {
      this.log('pair: login');
      this.username = data.username.trim();
      this.password = data.password;
      this.log('creating client');
      let routers = [];
      try {
        const tempClient = new AsusWRT(this.routerIP, this.username, this.password);
        routers = await client.getRouters();
        tempClient.dispose();
      } catch {
        return false;
      }
      if (routers.length === 0) {
        this.log('failed to login');
        return Promise.reject(Error('Failed to login'));
      } else {
        this.homey.settings.set("ip", this.routerIP);
        this.homey.settings.set("username", this.username);
        this.homey.settings.set("password", this.password);
        return true;
      }
    });

    session.setHandler('list_devices', async () => {
      this.log('pair: list_devices');
      client = new AsusWRT(this.routerIP, this.username, this.password);
      const routerAPDevices = await client.getRouters().catch(error => {
        session.showView('router_ip');
        return;
      });
      const foundDevices = routerAPDevices!.map(device => {
        return {
          name: `${device.productId} ${device.alias}`,
          data: {
            mac: device.mac
          },
          store: {
            operationMode: device.operationMode
          },
          icon: this.getIcon(device.productId)
        }
      });
      return foundDevices;
    });
  }

  async onRepair(session: PairSession, device: any) {
    let newRouterIP = '';
    let newUsername = '';
    let newPassword = '';

    this.log('starting repair');
    session.setHandler('router_ip_confirmed', async (routerIPFromView) => {
      this.log('pair: router_ip_confirmed');
      const ipRegex = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
      if (ipRegex.test(routerIPFromView)) {
        newRouterIP = 'http://' + routerIPFromView;
        return true;
      } else {
        this.log('invalid ip provided');
        return false;
      }
    });

    session.setHandler('login', async (data: {username: string, password: string}) => {
      this.log('pair: login');
      newUsername = data.username.trim();
      newPassword = data.password;
      this.log('creating client');
      try {
        let tempClient = new AsusWRT(newRouterIP, newUsername, newPassword);
        const routers = await tempClient.getRouters();
        tempClient.dispose();
        if (routers.length === 0) {
          this.log('failed to login');
          return Promise.reject(Error('Failed to login'));
        } else {
          this.routerIP = newRouterIP;
          this.username = newUsername;
          this.password = newPassword;
          this.homey.settings.set("ip", this.routerIP);
          this.homey.settings.set("username", this.username);
          this.homey.settings.set("password", this.password);
          if (this.asusClient) {
            this.asusClient.dispose();
            this.asusClient = new AsusWRT(this.routerIP, this.username, this.password);
          }
          return true;
        }
      } catch {
        return Promise.reject(Error('Failed to login'));
      }
    });
  }

  private getIcon(productId: string): string {
    const supportedIcons = [
      'RT-AX89U',
      'RT-AX89X',
      'RT-AC68U',
      'RT-AC86U'
    ];
    if (supportedIcons.indexOf(productId) === -1) {
      return `default.svg`;
    } else {
      return `${productId}.svg`;
    }
  }
}

module.exports = AsusWRTDriver;

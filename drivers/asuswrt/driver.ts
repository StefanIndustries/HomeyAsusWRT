import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import { AsusWRT } from "node-asuswrt"

class AsusWRTDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('AsusWRTDriver has been initialized');
  }

  async onPair(session: PairSession) {
    this.log('starting a new pair session');
    let username = '';
    let password = '';
    let routerIP = '';
    let client: AsusWRT;

    session.setHandler('showView', async (view) => {
      if (view === 'prepare_pairing') {
        routerIP = this.homey.settings.get('ip');
        username = this.homey.settings.get('username');
        password = this.homey.settings.get('password');
        if (routerIP !== null && username !== null && password !== null) {
          client = new AsusWRT(routerIP, username, password);
          const routers = await client.getRouters();
          client.dispose();
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
      routerIP = routerIPFromView;
      this.log(routerIP);
      const ipRegex = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
      if (ipRegex.test(routerIP)) {
        routerIP = 'http://' + routerIP;
        this.log(routerIP);
        return true;
      } else {
        this.log('invalid ip provided');
        return false;
      }
    });

    session.setHandler('login', async (data: {username: string, password: string}) => {
      this.log('pair: login');
      username = data.username.trim();
      password = data.password;
      this.log('creating client');
      let routers = [];
      try {
        client = new AsusWRT(routerIP, username, password);
        routers = await client.getRouters();
      } catch {
        return false;
      }
      client.dispose();
      if (routers.length === 0) {
        this.log('failed to login');
        return Promise.reject(Error('Failed to login'));
      } else {
        this.homey.settings.set("ip", routerIP);
        this.homey.settings.set("username", username);
        this.homey.settings.set("password", password);
        return true;
      }
    });

    session.setHandler('list_devices', async () => {
      this.log('pair: list_devices');
      client = new AsusWRT(this.homey.settings.get('ip'), this.homey.settings.get('username'), this.homey.settings.get('password'));
      const routerAPDevices = await client.getRouters().catch(error => {
        session.showView('router_ip');
        return;
      });
      client.dispose();
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
    this.log('starting repair');
    let routerIP = this.homey.settings.get('ip');
    let username = this.homey.settings.get('username');
    let password = this.homey.settings.get('password');

    session.setHandler('router_ip_confirmed', async (routerIPFromView) => {
      this.log('pair: router_ip_confirmed');
      routerIP = routerIPFromView;
      this.log(routerIP);
      const ipRegex = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
      if (ipRegex.test(routerIP)) {
        routerIP = 'http://' + routerIP;
        this.log(routerIP);
        return true;
      } else {
        this.log('invalid ip provided');
        return false;
      }
    });

    session.setHandler('login', async (data: {username: string, password: string}) => {
      this.log('pair: login');
      username = data.username.trim();
      password = data.password;
      this.log('creating client');
      try {
        let client = new AsusWRT(routerIP, username, password);
        const routers = await client.getRouters();
        client.dispose();
        if (routers.length === 0) {
          this.log('failed to login');
          return Promise.reject(Error('Failed to login'));
        } else {
          this.homey.settings.set("ip", routerIP);
          this.homey.settings.set("username", username);
          this.homey.settings.set("password", password);
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

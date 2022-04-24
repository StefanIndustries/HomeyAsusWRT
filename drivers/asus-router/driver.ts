import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import { AsusWRTClient } from '../../lib/AsusWRTClient';

class AsusRouterDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('AsusRouterDriver has been initialized');
  }

  async onPair(session: PairSession) {
    let username = '';
    let password = '';
    let routerIP = '';
    let client: AsusWRTClient;

    session.setHandler('router_ip_confirmed', async (routerIPFromView) => {
      routerIP = routerIPFromView;
      const ipRegex = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
      if (ipRegex.test(routerIP)) {
        routerIP = 'http://' + routerIP;
        return true;
      } else {
        return false;
      }
    });

    session.setHandler('login', async (data: any) => {
      username = data.username.toLowerCase().trim();
      password = data.password;
      client = new AsusWRTClient(routerIP, username, password);
      await client.login();
      return true;
    });

    session.setHandler('list_devices', async () => {
      const routerData = await client.appGet('nvram_get(productid);nvram_get(firmver);nvram_get(buildno);nvram_get(extendno);');
      return [
        {
          name: routerData.productid,
          data: {
            id: routerData.productid + '-' + routerIP,
            username: username,
            password: password,
            ip: routerIP
          }
        }
      ];
    });
  }
}

module.exports = AsusRouterDriver;

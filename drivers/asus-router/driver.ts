import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import { AsusWRTClient } from '../../lib/AsusWRTClient';
import { CryptoClient } from '../../lib/CryptoClient';

class AsusRouterDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('AsusRouterDriver has been initialized');
  }

  async onPair(session: PairSession) {
    this.log('starting a new pair session');
    let username = '';
    let password = '';
    let routerIP = '';
    let client: AsusWRTClient;

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
      client = new AsusWRTClient(routerIP, username, password);
      const tokenReceived = await client.login().catch(error => {
        this.log('failed to login');
        this.log(error);
        client.dispose();
        return error;
      });
      return tokenReceived && tokenReceived.includes('asus_token') ? true : false;
    });

    session.setHandler('list_devices', async () => {
      this.log('pair: list_devices');
      const routerProductId = await client.getRouterProductId().catch(error => Promise.reject(error));
      const cryptoClient = new CryptoClient(Homey.env.CRYPTO_KEY);
      const devices = [
        {
          name: routerProductId,
          data: {
            id: routerProductId + '-' + routerIP,
            username: cryptoClient.encrypt(username),
            password: cryptoClient.encrypt(password),
            ip: routerIP
          },
          icon: this.getIcon(routerProductId)
        }
      ];
      this.log(devices);
      client.dispose;
      return devices;
    });
  }

  private getIcon(productId: string): string {
    console.log(productId);
    console.log(`${productId}.svg`);
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

module.exports = AsusRouterDriver;

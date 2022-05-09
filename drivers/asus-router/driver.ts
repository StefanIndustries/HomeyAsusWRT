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
      username = data.username.trim();
      password = data.password;
      client = new AsusWRTClient(routerIP, username, password);
      const tokenReceived = await client.login().catch(error => {
        return false;
      });
      return tokenReceived && tokenReceived.includes('asus_token') ? true : false;
    });

    session.setHandler('list_devices', async () => {
      const routerProductId = await client.getRouterProductId();
      const cryptoClient = new CryptoClient(Homey.env.CRYPTO_KEY);
      return [
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

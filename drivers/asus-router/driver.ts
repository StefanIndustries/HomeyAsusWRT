import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import { AsusWRTClient } from '../../lib/AsusWRTClient';
import { CryptoClient } from '../../lib/CryptoClient';
import { AsusWRTOperationMode } from "../../lib/models/AsusWRTOperationMode";
import { URL } from "node:url";

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
    let routerUrl = '';
    let client: AsusWRTClient;

    session.setHandler('router_url_confirmed', async (routerUrlFromView) => {
      this.log('pair: router_url_confirmed');
      routerUrl = routerUrlFromView;
      this.log(routerUrl);
      const urlRegex = /https?:\/\/(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::\d+)?(?:\/\S*)?|https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d+)?(?:\/\S*)?/gi;
      if (urlRegex.test(routerUrl)) {
        this.log(routerUrl);
        return true;
      } else {
        this.log('invalid url provided');
        return false;
      }
    });

    session.setHandler('login', async (data: {username: string, password: string}) => {
      this.log('pair: login');
      username = data.username.trim();
      password = data.password;
      this.log('creating client');
      client = new AsusWRTClient(routerUrl, username, password);
      const tokenReceived = await client.login().catch(error => {
        this.log('failed to login');
        this.log(error);
        client.dispose();
        return Promise.reject(Error('Failed to login'));
      });
      return tokenReceived && tokenReceived.includes('asus_token') ? true : false;
    });

    session.setHandler('list_devices', async () => {
      this.log('pair: list_devices');
      const routerProductId = await client.getRouterProductId().catch(error => Promise.reject(error));
      const cryptoClient = new CryptoClient(Homey.env.CRYPTO_KEY);
      const url = new URL(routerUrl)
      const devices = [
        {
          name: routerProductId,
          data: {
            id: routerProductId + '-' + url.hostname,
            username: cryptoClient.encrypt(username),
            password: cryptoClient.encrypt(password),
            ip: url.hostname,
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

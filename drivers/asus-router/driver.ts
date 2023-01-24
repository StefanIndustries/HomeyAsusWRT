import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import { AsusWRTClient } from '../../lib/AsusWRTClient';
import { CryptoClient } from '../../lib/CryptoClient';
import { AsusWRTOperationMode } from "../../lib/models/AsusWRTOperationMode";

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
        return Promise.reject(Error('Failed to login'));
      });
      return tokenReceived && tokenReceived.includes('asus_token') ? true : false;
    });

    session.setHandler('list_devices', async () => {
      this.log('pair: list_devices');
      const routerAPDevices = await client.getRouterAPDevices().catch(error => Promise.reject(error));
      client.dispose;
      const cryptoClient = new CryptoClient(Homey.env.CRYPTO_KEY);
      const foundDevices = routerAPDevices.map(device => {
        return {
          name: `${device.product_id} ${device.alias}`,
          data: {
            mac: device.mac,
            productId: device.product_id
          },
          settings: {
            ip: `http://${device.ip}`,
            username: '',
            password: ''
          },
          store: {
            mac: device.mac,
            productId: device.product_id,
            username: cryptoClient.encrypt(username),
            password: cryptoClient.encrypt(password)
          },
          icon: this.getIcon(device.product_id)
        }
      });
      const existingDevices = this.getDevices();
      const existingDeviceMacs = existingDevices.map(existingDevice => existingDevice.getData().mac);
      let filteredFoundDevices = foundDevices.filter(foundDevice => !existingDeviceMacs.includes(foundDevice.data.mac));

      //filter on old devices with old data object
      const existingDeviceIds = existingDevices.map(existingDevice => existingDevice.getData().id);
      this.log(existingDeviceIds);
      this.log(filteredFoundDevices);
      filteredFoundDevices = filteredFoundDevices.filter(foundDevice => !existingDeviceIds.includes(`${foundDevice.data.productId}-${foundDevice.settings.ip}`));

      this.log(filteredFoundDevices);
      return filteredFoundDevices;
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

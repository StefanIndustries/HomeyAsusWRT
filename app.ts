import Homey from 'homey';

export class AsusWRTApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('AsusWRTApp has been initialized');
  }
}

module.exports = AsusWRTApp;
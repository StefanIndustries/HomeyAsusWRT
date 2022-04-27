import Homey from 'homey';

export class AsusWRTApp extends Homey.App {
  public triggerDeviceCameOnline!: (device: any, tokens: any, state: any) => void;
  public triggerDeviceWentOffline!: (device: any, tokens: any, state: any) => void;
  public triggerWANConnectionStatusChanged!: (device: any, tokens: any, state: any) => void;
  public triggerExternalIPChanged!: (device: any, tokens: any, state: any) => void;


  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.registerTriggers();
    this.log('AsusWRTApp has been initialized');
  }

  private registerTriggers() {
    const deviceCameOnline = this.homey.flow.getDeviceTriggerCard('device-came-online');
		this.triggerDeviceCameOnline = (device, tokens, state) => {
			deviceCameOnline
				.trigger(device, tokens, state)
				.catch(this.error);
		};

    const deviceWentOffline = this.homey.flow.getDeviceTriggerCard('device-went-offline');
    this.triggerDeviceWentOffline = (device, tokens, state) => {
      deviceWentOffline
        .trigger(device, tokens, state)
        .catch(this.error);
    }

    const wanConnectionStatusChanged = this.homey.flow.getDeviceTriggerCard('wan-connection-status-changed');
    this.triggerWANConnectionStatusChanged = (device, tokens, state) => {
      wanConnectionStatusChanged
        .trigger(device, tokens, state)
        .catch(this.error);
    }

    const externalIPChanged = this.homey.flow.getDeviceTriggerCard('external-ip-changed');
    this.triggerExternalIPChanged = (device, tokens, state) => {
      externalIPChanged
        .trigger(device, tokens, state)
        .catch(this.error);
    }
  }

}

module.exports = AsusWRTApp;
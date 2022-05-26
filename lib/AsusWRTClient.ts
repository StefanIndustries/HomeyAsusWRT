import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import qs from 'qs';
import { AsusWRTApplyResponse } from './models/AsusWRTApplyResponse';
import { AsusWRTConnectedClient } from './models/AsusWRTConnectedClient';
import { AsusWRTTrafficData } from './models/AsusWRTTrafficData';
import { AsusWRTWANStatus } from './models/AsusWRTWANStatus';

export class AsusWRTClient {
    private loginSessionStart: number | null = null;
    private instance: AxiosInstance;
    private controller = new AbortController();

    private isLoggedIn(): boolean {
        return this.loginSessionStart !== null;
    }

    private isLoggedMoreThan10MinutesAgo(): boolean {
        if (!this.loginSessionStart) {
            return true;
        }
        return (Date.now() - this.loginSessionStart) > 10 * 60 * 1000;
    }

    constructor(private baseUrl: string, private username: string, private password: string) {
        this.instance = axios.create({
            baseURL: baseUrl,
            timeout: 1000,
            headers: {'User-Agent': 'asusrouter-Android-DUTUtil-1.0.0.3.58-163'}
        });
        
        this.instance.interceptors.request.use(async (request) => {
            if (request.url !== '/login.cgi' && (!this.isLoggedIn() || this.isLoggedMoreThan10MinutesAgo())) {
                const newToken = await this.login().catch(error => Promise.reject(error));
                const originalRequestConfig = request;
                delete originalRequestConfig.headers!['Cookie'];
                originalRequestConfig.headers!['Cookie'] = newToken;
                return originalRequestConfig;
            }
            return request;
          });
    }

    public dispose() {
        this.controller.abort();
    }

    public async login(): Promise<any> {
        const path = '/login.cgi';
        const result = await this.instance({
            method: 'POST',
            url: path,
            data: qs.stringify({
                login_authorization: Buffer.from(`${this.username}:${this.password}`).toString('base64')
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            signal: this.controller.signal
        });
        if (!result.data.asus_token) {
            return Promise.reject(result.data);
        }
        const asusToken = `asus_token=${result.data.asus_token}`;
        this.instance.defaults.headers.common['Cookie'] = asusToken;
        this.loginSessionStart = Date.now();
        return asusToken;
    }

    private async appGet(payload: string, stripText?: string): Promise<any> {
        const path = '/appGet.cgi';
        const result = await this.instance({
            method: 'POST',
            url: path,
            data: qs.stringify({
                hook: payload
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            signal: this.controller.signal
        });
        if (stripText) {
            return JSON.parse('{' + result.data.substring(stripText.length + 5));
        } else {
            return result.data;
        }
    }

    private async applyapp(payload: any, stripText?: string): Promise<any> {
        const path = '/applyapp.cgi';
        const result = await this.instance({
            method: 'POST',
            url: path,
            data: payload,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            signal: this.controller.signal
        });
        return result.data;
    }

    public async getRouterProductId(): Promise<string> {
        const routerData = await this.appGet('nvram_get(productid);nvram_get(firmver);nvram_get(buildno);nvram_get(extendno);');
        return routerData.productid;
    }

    public async getTotalTrafficData(): Promise<AsusWRTTrafficData> {
        const trafficData = await this.appGet('netdev(appobj)');
        const trafficReceived = (parseInt(trafficData['netdev']['INTERNET_rx'], 16) * 8 / 1024 / 1024) * 0.125;
        const trafficSent = (parseInt(trafficData['netdev']['INTERNET_tx'], 16) * 8 / 1024 / 1024) * 0.125;
        return {
            trafficReceived: trafficReceived,
            trafficSent: trafficSent
        };
    }

    public async getUptime(): Promise<number> {
        const uptimeData = await this.appGet('uptime()');
        let uptimeSeconds = uptimeData.substring(uptimeData.indexOf(':'));
        uptimeSeconds = uptimeSeconds.substring(uptimeSeconds.indexOf("(") + 1);
        uptimeSeconds = uptimeSeconds.substring(0, uptimeSeconds.indexOf(" "));
        return parseInt(uptimeSeconds);
    }

    public async getCPUUsagePercentage(): Promise<number> {
        const cpuData = await this.appGet('cpu_usage()', 'cpu_usage');
        let totalAvailable = 0;
        let totalUsed = 0;
        for (let i = 1; i < 16; i++) {
          totalAvailable += this.addNumberValueIfExists(cpuData, `cpu${i}_total`);
        }
        for (let i = 1; i < 16; i++) {
          totalUsed += this.addNumberValueIfExists(cpuData, `cpu${i}_usage`);
        }
        const percentageUsed = (100 / totalAvailable) * totalUsed;
        return percentageUsed;
    }

    private addNumberValueIfExists(object: any, property: string): number {
        if (object[property]) {
          return parseInt(object[property]);
        }
        return 0;
    }

    public async getMemoryUsagePercentage(): Promise<number> {
        const memData = await this.appGet('memory_usage()', 'memory_usage');
        const totalMemory = parseInt(memData.mem_total);
        const memUsed = parseInt(memData.mem_used);
        const percentageUsed = (100 / totalMemory) * memUsed;
        return percentageUsed;
    }

    public async getOnlineClients(): Promise<AsusWRTConnectedClient[]> {
        let onlineDevices: AsusWRTConnectedClient[] = [];
        const clientListData = await this.appGet('get_clientlist()');
        for (const c in clientListData['get_clientlist']) {
          if (c.length === 17 && "isOnline" in clientListData['get_clientlist'][c] && clientListData['get_clientlist'][c]['isOnline'] == '1') {
            const client = clientListData['get_clientlist'][c];
            onlineDevices.push({
              ip: client.ip,
              mac: client.mac,
              name: client.name,
              nickName: client.nickName
            });
          }
        }
        return onlineDevices;
    }

    public async getWANStatus(): Promise<AsusWRTWANStatus> {
        let status: any = {};
        const wanData = <string> await this.appGet('wanlink()');
        wanData.split('\n').forEach(line => {
            if (line.includes('return') && line.includes('wanlink_')) {
                const key = line.substring(line.indexOf('_') + 1, line.indexOf('('));
                let value = line.substring(line.indexOf('return ') + 7, line.indexOf(';}'));
                if (value.includes(`'`)) {
                    status[key] = value.substring(1, value.length - 1);
                } else {
                    status[key] = parseInt(value);
                }
            }
        });
        return <AsusWRTWANStatus> status;
    }

    public async reboot(): Promise<AsusWRTApplyResponse> {
        const rebootStatus = <AsusWRTApplyResponse> await this.applyapp({"action_mode": "apply", "rc_service": "reboot"});
        return rebootStatus;
    }
}
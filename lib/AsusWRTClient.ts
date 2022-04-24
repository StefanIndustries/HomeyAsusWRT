import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import qs from 'qs';

export class AsusWRTClient {
    private loginSessionStart: number | null = null;

    private isLoggedIn(): boolean {
        return this.loginSessionStart !== null;
    }

    private isLoggedMoreThan60MinutesAgo(): boolean {
        if (!this.loginSessionStart) {
            return true;
        }
        return (Date.now() - this.loginSessionStart) > 59 * 60 * 1000;
    }

    constructor(private baseUrl: string, private username: string, private password: string) {
        axios.defaults.baseURL = baseUrl;
        axios.defaults.headers.common['User-Agent'] = 'asusrouter-Android-DUTUtil-1.0.0.3.58-163';
        
        axios.interceptors.request.use(async (request) => {
            if (request.url !== '/login.cgi' && (!this.isLoggedIn() || this.isLoggedMoreThan60MinutesAgo())) {
                const newToken = await this.login().catch(error => Promise.reject(error));
                const originalRequestConfig = request;
                delete originalRequestConfig.headers!['Cookie'];
                originalRequestConfig.headers!['Cookie'] = newToken;
                return originalRequestConfig;
            }
            return request;
          });

        axios.interceptors.request.use(request => {
            console.log('Request', request.url);
            return request;
        })
        
        axios.interceptors.response.use(response => {
            console.log('Response:', response.status);
            return response
        })
    }

    public async login(): Promise<any> {
        const path = '/login.cgi';
        const result = await axios({
            method: 'POST',
            url: path,
            data: qs.stringify({
                login_authorization: Buffer.from(`${this.username}:${this.password}`).toString('base64')
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        });
        if (!result.data.asus_token) {
            return Promise.reject('no asus token found');
        }
        const asusToken = `asus_token=${result.data.asus_token}`;
        axios.defaults.headers.common['Cookie'] = asusToken;
        this.loginSessionStart = Date.now();
        return asusToken;
    }

    public async appGet(payload: string, stripText?: string): Promise<any> {
        const path = '/appGet.cgi';
        const result = await axios({
            method: 'POST',
            url: path,
            data: qs.stringify({
                hook: payload
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        if (stripText) {
            return JSON.parse('{' + result.data.substring(stripText.length + 5));
        } else {
            return result.data;
        }
    }
}